import { Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { MfaEnrollmentStore } from './mfa-enrollment.store';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { User } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { MfaChallengeStore } from './mfa-challenge.store';
import { MfaCredentialRepository } from './mfa-credential.repository';
import type { OidcReauthentication } from './oidc-transaction.store';
import { ConfigService } from '@nestjs/config';
import { MfaResetStore } from './mfa-reset.store';
import type { MfaResetIdentity } from './mfa-reset.types';
import { OidcProviderService } from './oidc-provider.service';
import type { OidcConfig } from './oidc-config';

type ResetFactor = { code: string; method: 'totp' | 'recovery' };

const scryptAsync = promisify(scrypt);

type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
};

export type AuthSession = {
  token: string;
  refreshToken: string;
  user: AuthUser;
  expiresAt: string;
};
export type AuthLoginResult = AuthSession | { mfaRequired: true; challengeToken: string; expiresIn: number };

export type ValidatedSession = {
  authzVersion: number;
  token: string;
  user: AuthUser;
  expiresAt: string;
};

type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'isActive' | 'authzVersion'> & { mfaEnabled?: boolean };

function mapUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    username: user.email,
    displayName: user.name ?? user.email,
    role: user.role,
  };
}

/**
 * 验证密码，兼容 scrypt（salt:derivedKey）格式。
 * UsersService 和 AppService 均使用该格式存储密码哈希。
 */
async function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (!passwordHash) return false;

  // scrypt 格式：<salt_hex>:<derived_key_hex>
  const parts = passwordHash.split(':');
  if (parts.length === 2) {
    const [salt, storedHex] = parts;
    try {
      const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
      const storedBuffer = Buffer.from(storedHex, 'hex');
      if (derivedKey.length !== storedBuffer.length) return false;
      return timingSafeEqual(derivedKey, storedBuffer);
    } catch {
      return false;
    }
  }

  return false;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    @Optional() private readonly externalIdentities?: OidcIdentityRepository,
    @Optional() private readonly loginLimiter?: LoginAttemptLimiter,
    @Optional() private readonly mfaChallenges?: MfaChallengeStore,
    @Optional() private readonly mfaCredentials?: MfaCredentialRepository,
    @Optional() private readonly mfaEnrollments?: MfaEnrollmentStore,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly mfaResets?: MfaResetStore,
    @Optional() private readonly oidcProvider?: OidcProviderService,
  ) {}

  private async resetContext(actor: ValidatedSession, targetUserId: string) {
    if (!this.mfaResets || !this.loginLimiter || !this.mfaCredentials) throw new ServiceUnavailableException('MFA reset unavailable');
    if (!actor || !actor.user || !this.config?.get<string>('superadminUserId')
      || actor.user.id !== this.config.get<string>('superadminUserId')
      || !Number.isSafeInteger(actor.authzVersion) || actor.authzVersion < 1
      || typeof targetUserId !== 'string' || !targetUserId || targetUserId.length > 256 || targetUserId.trim() !== targetUserId) throw new UnauthorizedException('MFA reset unavailable');
    const session = await this.authRepository.findValidSessionById(actor.token);
    if (!session || session.userId !== actor.user.id || !session.user.isActive
      || session.authzVersion !== actor.authzVersion || session.user.authzVersion !== actor.authzVersion
      || !['admin', 'platform-admin'].includes(session.user.role)) throw new UnauthorizedException('Invalid session');
    const target = await this.authRepository.findMfaResetTarget(targetUserId);
    if (!target?.mfaEnabled || !target.mfaCredential
      || ![target.authzVersion, target.mfaCredential.version].every(v => Number.isSafeInteger(v) && v > 0)) throw new UnauthorizedException('MFA reset unavailable');
    const identity: MfaResetIdentity = { actorUserId: session.userId, actorSessionId: session.id,
      actorAuthzVersion: session.authzVersion, targetUserId: target.id,
      targetAuthzVersion: target.authzVersion, targetMfaVersion: target.mfaCredential.version };
    return { identity, session };
  }

  private async finishResetStepUp(actor: ValidatedSession, original: Awaited<ReturnType<AuthService['resetContext']>>, factor?: ResetFactor) {
    if (original.session.user.mfaEnabled) {
      if (!factor || !['totp', 'recovery'].includes(factor.method) || typeof factor.code !== 'string' || !factor.code || factor.code.length > 128) throw new UnauthorizedException('Fresh MFA verification required');
      const challenge = await this.mfaCredentials!.prepareChallenge(original.identity.actorUserId, original.identity.actorAuthzVersion);
      if (!challenge || !await this.mfaCredentials!.redeem(challenge, factor.code, factor.method)) throw new UnauthorizedException('Fresh MFA verification failed');
    }
    const current = await this.resetContext(actor, original.identity.targetUserId);
    if ((Object.keys(original.identity) as Array<keyof MfaResetIdentity>).some(key => current.identity[key] !== original.identity[key])
      || current.session.user.mfaEnabled !== original.session.user.mfaEnabled
      || current.session.user.passwordHash !== original.session.user.passwordHash) throw new UnauthorizedException('Reset identity changed');
    return this.mfaResets!.save(current.identity);
  }

  async prepareMfaReset(actor: ValidatedSession, targetUserId: string, password: string, factor?: ResetFactor) {
    const context = await this.resetContext(actor, targetUserId);
    await this.loginLimiter!.consumeAccount(`user:${context.identity.actorUserId}`);
    if (typeof password !== 'string' || !password || password.length > 1024 || !await verifyPassword(password, context.session.user.passwordHash)) throw new UnauthorizedException('Reauthentication failed');
    return this.finishResetStepUp(actor, context, factor);
  }

  async oidcMfaResetContext(actor: ValidatedSession, targetUserId: string, issuer: string, starting = false) {
    if (!this.externalIdentities || !this.oidcProvider) throw new ServiceUnavailableException('OIDC reset unavailable');
    const context = await this.resetContext(actor, targetUserId);
    if (starting) await this.loginLimiter!.consumeAccount(`user:${context.identity.actorUserId}`);
    const subject = await this.externalIdentities.subjectForUser(issuer, context.identity.actorUserId);
    return { userId: context.identity.actorUserId, sessionId: context.identity.actorSessionId,
      authzVersion: context.identity.actorAuthzVersion, subject, purpose: 'mfa-reset' as const,
      targetUserId: context.identity.targetUserId, targetAuthzVersion: context.identity.targetAuthzVersion,
      targetMfaVersion: context.identity.targetMfaVersion };
  }

  // Provider exchange happens here; a caller-supplied identity assertion is never proof.
  async finishOidcMfaReset(actor: ValidatedSession, targetUserId: string, config: OidcConfig, clientSecret: string, callback: URL, binding: string, factor?: ResetFactor) {
    const original = await this.resetContext(actor, targetUserId);
    const context = await this.oidcMfaResetContext(actor, targetUserId, config.issuer, true);
    const verified = await this.oidcProvider!.completeReauthentication(config, clientSecret, callback, binding, context);
    if (verified.issuer !== config.issuer || verified.subject !== context.subject) throw new UnauthorizedException('OIDC identity changed');
    const current = await this.oidcMfaResetContext(actor, targetUserId, config.issuer);
    if ((Object.keys(context) as Array<keyof typeof context>).some(key => current[key] !== context[key])) throw new UnauthorizedException('OIDC identity changed');
    return this.finishResetStepUp(actor, original, factor);
  }

  async confirmMfaReset(actor: ValidatedSession, targetUserId: string, token: string) {
    const current = await this.resetContext(actor, targetUserId);
    const proof = await this.mfaResets!.consume(token, current.identity);
    const result = await this.mfaCredentials!.reset(proof);
    if (!result) throw new UnauthorizedException('MFA reset failed; start again');
    return result;
  }

  private async enrollmentIdentity(actor: ValidatedSession) {
    const session = await this.authRepository.findValidSessionById(actor.token);
    if (!session || session.userId !== actor.user.id || session.user.mfaEnabled || session.authzVersion !== actor.authzVersion
      || session.user.authzVersion !== actor.authzVersion) throw new UnauthorizedException('MFA enrollment unavailable for this session');
    return { userId: session.userId, sessionId: session.id, authzVersion: session.authzVersion };
  }

  async mfaStatus(actor: ValidatedSession) {
    const session = await this.authRepository.findValidSessionById(actor.token);
    if (!session || session.userId !== actor.user.id || session.authzVersion !== actor.authzVersion
      || session.user.authzVersion !== actor.authzVersion) throw new UnauthorizedException('Invalid session');
    return { enabled: session.user.mfaEnabled, passwordReauthenticationAvailable: Boolean(session.user.passwordHash),
      canManageMfa: Boolean(this.config?.get<string>('superadminUserId') === session.userId
        && session.user.isActive && ['admin', 'platform-admin'].includes(session.user.role)
        && this.mfaResets && this.mfaCredentials && this.loginLimiter) };
  }

  async oidcEnrollmentContext(actor: ValidatedSession, issuer: string, starting = false) {
    if (!this.externalIdentities || !this.mfaEnrollments || !this.loginLimiter) throw new ServiceUnavailableException('MFA enrollment unavailable');
    const identity = await this.enrollmentIdentity(actor);
    if (starting) await this.loginLimiter.consumeAccount(`user:${identity.userId}`);
    const subject = await this.externalIdentities.subjectForUser(issuer, identity.userId);
    return { ...identity, subject };
  }

  async finishOidcEnrollment(actor: ValidatedSession, issuer: string, original: Omit<OidcReauthentication, 'requestedAt'>) {
    const current = await this.oidcEnrollmentContext(actor, issuer);
    if ((['userId', 'sessionId', 'authzVersion', 'subject'] as const).some(key => current[key] !== original[key])) throw new UnauthorizedException('OIDC identity changed');
    return { ...await this.mfaEnrollments!.save(current), expiresIn: 300 };
  }

  async beginMfaEnrollment(actor: ValidatedSession, password: string) {
    if (!this.mfaEnrollments || !this.loginLimiter) throw new ServiceUnavailableException('MFA enrollment unavailable');
    const identity = await this.enrollmentIdentity(actor);
    await this.loginLimiter.consumeAccount(`user:${identity.userId}`);
    const session = await this.authRepository.findValidSessionById(identity.sessionId);
    if (!session || session.userId !== identity.userId || session.user.authzVersion !== identity.authzVersion
      || typeof password !== 'string' || !password.length || password.length > 1024
      || !await verifyPassword(password, session.user.passwordHash)) {
      throw new UnauthorizedException('重新验证身份失败');
    }
    return { ...await this.mfaEnrollments.save(identity), expiresIn: 300 };
  }

  async confirmMfaEnrollment(actor: ValidatedSession, token: string, code: string) {
    if (!this.mfaEnrollments || !this.mfaCredentials) throw new ServiceUnavailableException('MFA enrollment unavailable');
    const identity = await this.enrollmentIdentity(actor);
    const secret = await this.mfaEnrollments.consume(token, identity);
    const result = await this.mfaCredentials.confirmEnrollment(identity, secret, code);
    if (!result) throw new UnauthorizedException('MFA enrollment failed; start again');
    return result;
  }

  async completeMfa(challengeToken: string, code: string, method: 'totp' | 'recovery'): Promise<AuthSession | null> {
    if (!this.mfaChallenges || !this.mfaCredentials) throw new ServiceUnavailableException('MFA verification unavailable');
    const challenge = await this.mfaChallenges.consume(challengeToken);
    const refreshToken = this.tokenService.createRefreshToken();
    const result = await this.mfaCredentials.redeemAndCreateSession(challenge, code, method, {
      refreshTokenHash: this.tokenService.hashToken(refreshToken),
      expiresAt: this.tokenService.resolveAccessTokenExpiry(),
      refreshExpiresAt: this.tokenService.resolveRefreshTokenExpiry(),
    });
    if (!result) return null;
    return {
      token: this.tokenService.createAccessToken(result.session.id), refreshToken,
      expiresAt: result.session.expiresAt.toISOString(), user: mapUser(result.user),
    };
  }

  async login(username: string, password: string): Promise<AuthLoginResult | null> {
    if (!this.loginLimiter) throw new ServiceUnavailableException('Login temporarily unavailable');
    const userRecord =
      await this.authRepository.findActiveUserByUsername(username);
    await this.loginLimiter.consumeAccount(userRecord ? `user:${userRecord.id}` : `name:${username.trim()}`);
    if (
      !userRecord ||
      !(await verifyPassword(password, userRecord.passwordHash))
    ) {
      return null;
    }

    return this.issueSession(userRecord);
  }

  // The caller must validate the provider token before passing its issuer/subject.
  async loginExternal(issuer: string, subject: string): Promise<AuthLoginResult | null> {
    if (!this.externalIdentities) throw new ServiceUnavailableException('OIDC identity store unavailable');
    return this.issueSession(await this.externalIdentities.resolve(issuer, subject));
  }

  private async issueSession(userRecord: SessionUser): Promise<AuthLoginResult | null> {
    if (!userRecord.isActive || !Number.isSafeInteger(userRecord.authzVersion) || userRecord.authzVersion < 1) return null;
    if (userRecord.mfaEnabled) {
      if (!this.mfaCredentials || !this.mfaChallenges) return null;
      const challenge = await this.mfaCredentials.prepareChallenge(userRecord.id, userRecord.authzVersion);
      if (!challenge) return null;
      return { mfaRequired: true, challengeToken: await this.mfaChallenges.save(challenge), expiresIn: 300 };
    }
    const refreshToken = this.tokenService.createRefreshToken();
    const refreshTokenHash = this.tokenService.hashToken(refreshToken);
    const expiresAt = this.tokenService.resolveAccessTokenExpiry();
    const refreshExpiresAt = this.tokenService.resolveRefreshTokenExpiry();

    const session = await this.authRepository.createSession({
      authzVersion: userRecord.authzVersion,
      userId: userRecord.id,
      refreshTokenHash,
      expiresAt,
      refreshExpiresAt,
    });

    return {
      token: this.tokenService.createAccessToken(session.id),
      refreshToken,
      expiresAt: session.expiresAt.toISOString(),
      user: mapUser(userRecord),
    };
  }

  async refresh(refreshToken: string): Promise<AuthSession | null> {
    const refreshTokenHash = this.tokenService.hashToken(refreshToken);
    const currentSession =
      await this.authRepository.findValidSessionByRefreshTokenHash(
        refreshTokenHash,
      );

    if (!currentSession || (currentSession.user.mfaEnabled && !this.mfaCredentials)) {
      return null;
    }
    if (!Number.isSafeInteger(currentSession.authzVersion) || currentSession.authzVersion < 1 || currentSession.authzVersion !== currentSession.user.authzVersion) return null;

    const nextRefreshToken = this.tokenService.createRefreshToken();
    const nextRefreshTokenHash = this.tokenService.hashToken(nextRefreshToken);
    const expiresAt = this.tokenService.resolveAccessTokenExpiry();

    const rotation = {
      authzVersion: currentSession.authzVersion,
      sessionId: currentSession.id,
      userId: currentSession.userId,
      currentRefreshTokenHash: refreshTokenHash,
      nextRefreshTokenHash,
      expiresAt,
      refreshExpiresAt: currentSession.refreshExpiresAt,
    };
    const nextSession = currentSession.user.mfaEnabled
      ? await this.mfaCredentials!.rotateSession(rotation)
      : await this.authRepository.rotateSession(rotation);
    if (!nextSession) {
      return null;
    }

    return {
      token: this.tokenService.createAccessToken(nextSession.id),
      refreshToken: nextRefreshToken,
      expiresAt: nextSession.expiresAt.toISOString(),
      user: mapUser(currentSession.user),
    };
  }

  async validate(accessToken: string): Promise<ValidatedSession | null> {
    const sessionId = this.tokenService.resolveSessionId(accessToken);
    if (!sessionId) {
      return null;
    }

    const session = await this.authRepository.findValidSessionById(sessionId);
    if (!session) {
      return null;
    }
    if (session.user.mfaEnabled && !(await this.mfaCredentials?.hasSessionAssurance(session.id, session.user.id, session.authzVersion))) return null;
    if (!Number.isSafeInteger(session.authzVersion) || session.authzVersion < 1 || session.authzVersion !== session.user.authzVersion) {
      return null;
    }

    return {
      token: accessToken,
      authzVersion: session.authzVersion,
      user: mapUser(session.user),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(accessToken: string): Promise<void> {
    const sessionId = this.tokenService.resolveSessionId(accessToken);
    if (!sessionId) {
      return;
    }

    await this.authRepository.revokeSessionById(sessionId);
  }
}
