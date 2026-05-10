import { Injectable } from '@nestjs/common';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { User } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';

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

export type ValidatedSession = {
  token: string;
  user: AuthUser;
  expiresAt: string;
};

function mapUser(user: User): AuthUser {
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
  ) {}

  async login(username: string, password: string): Promise<AuthSession | null> {
    const userRecord =
      await this.authRepository.findActiveUserByUsername(username);
    if (
      !userRecord ||
      !(await verifyPassword(password, userRecord.passwordHash))
    ) {
      return null;
    }

    const refreshToken = this.tokenService.createRefreshToken();
    const refreshTokenHash = this.tokenService.hashToken(refreshToken);
    const expiresAt = this.tokenService.resolveAccessTokenExpiry();

    const session = await this.authRepository.createSession({
      userId: userRecord.id,
      refreshTokenHash,
      expiresAt,
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

    if (!currentSession) {
      return null;
    }

    await this.authRepository.revokeSessionById(currentSession.id);

    const nextRefreshToken = this.tokenService.createRefreshToken();
    const nextRefreshTokenHash = this.tokenService.hashToken(nextRefreshToken);
    const expiresAt = this.tokenService.resolveAccessTokenExpiry();

    const nextSession = await this.authRepository.createSession({
      userId: currentSession.userId,
      refreshTokenHash: nextRefreshTokenHash,
      expiresAt,
    });

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

    return {
      token: accessToken,
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
