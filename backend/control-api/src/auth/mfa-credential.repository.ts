import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../platform/database/prisma.service';
import type { MfaChallenge } from './mfa-challenge.store';
import { decryptMfaSecret, encryptMfaSecret, hashRecoveryCode, matchTotpCounter } from './mfa-totp';
import { randomBytes } from 'node:crypto';
import type { User, Prisma } from '@prisma/client';
import type { MfaResetProof } from './mfa-reset.types';

@Injectable()
export class MfaCredentialRepository {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async reset(proof: MfaResetProof): Promise<{ userId: string; mfaEnabled: false } | null> {
    if (!proof || proof.action !== 'mfa-reset'
      || ![proof.actorUserId, proof.actorSessionId, proof.targetUserId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value)
      || ![proof.actorAuthzVersion, proof.targetAuthzVersion, proof.targetMfaVersion].every(value => Number.isSafeInteger(value) && value > 0)
      || !Number.isSafeInteger(proof.expiresAt) || proof.expiresAt <= Date.now() || proof.expiresAt > Date.now() + 300000
      || proof.actorUserId !== this.config.get<string>('superadminUserId')) return null;
    return this.prisma.$transaction(async tx => {
      // A stable lock order serializes self-reset, enrollment and competing resets.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${proof.actorUserId}, ${proof.targetUserId}) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${proof.actorSessionId} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: proof.actorUserId }, include: { mfaCredential: true } });
      const target = await tx.user.findUnique({ where: { id: proof.targetUserId }, include: { mfaCredential: true } });
      const now = new Date();
      if (proof.expiresAt <= now.getTime() || !actor?.isActive || !['admin', 'platform-admin'].includes(actor.role)
        || actor.authzVersion !== proof.actorAuthzVersion || !target?.mfaEnabled || target.authzVersion !== proof.targetAuthzVersion
        || target.mfaCredential?.version !== proof.targetMfaVersion) return null;
      const session = await tx.session.findFirst({ where: { id: proof.actorSessionId, userId: actor.id,
        authzVersion: proof.actorAuthzVersion, revokedAt: null, expiresAt: { gt: now } } });
      if (!session) return null;
      if (actor.mfaEnabled && (!actor.mfaCredential || session.mfaVersion !== actor.mfaCredential.version || !session.mfaVerifiedAt
        || session.mfaVerifiedAt < actor.mfaCredential.confirmedAt || session.mfaVerifiedAt > now)) return null;
      await tx.mfaCredential.delete({ where: { userId: target.id } });
      await tx.user.update({ where: { id: target.id }, data: { mfaEnabled: false, authzVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.authorizationChange.create({ data: { actorUserId: actor.id, affectedUserId: target.id,
        version: target.authzVersion + 1, reason: 'mfa-reset' } });
      return { userId: target.id, mfaEnabled: false };
    });
  }

  async confirmEnrollment(identity: { userId: string; sessionId: string; authzVersion: number }, secret: string, code: string) {
    if (!identity || ![identity.userId, identity.sessionId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id)
      || !Number.isSafeInteger(identity.authzVersion) || identity.authzVersion < 1 || typeof secret !== 'string' || !/^[A-Z2-7]{32}$/.test(secret)
      || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
    const counter = matchTotpCounter(secret, code);
    if (counter === null) return null;
    const key = this.config.get<string>('mfaEncryptionKey') ?? this.config.get<string>('MFA_ENCRYPTION_KEY') ?? '';
    if (!key.trim()) throw new ServiceUnavailableException('MFA enrollment unavailable');
    const encryptedSecret = encryptMfaSecret(secret, key);
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
    return this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${identity.userId}
        AND "isActive" = true AND "mfaEnabled" = false AND "authzVersion" = ${identity.authzVersion} FOR UPDATE`;
      if (!users.length) return null;
      const session = await tx.session.findFirst({ where: { id: identity.sessionId, userId: identity.userId,
        authzVersion: identity.authzVersion, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!session || await tx.mfaCredential.findUnique({ where: { userId: identity.userId } })) return null;
      await tx.mfaCredential.create({ data: { userId: identity.userId, encryptedSecret, confirmedAt: new Date(),
        lastTotpCounter: BigInt(counter), recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) } });
      await tx.user.update({ where: { id: identity.userId }, data: { mfaEnabled: true, authzVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: identity.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authorizationChange.create({ data: { actorUserId: identity.userId, affectedUserId: identity.userId,
        version: identity.authzVersion + 1, reason: 'mfa-enrolled' } });
      return { recoveryCodes };
    });
  }

  async prepareChallenge(userId: string, authzVersion: number): Promise<MfaChallenge | null> {
    if (typeof userId !== 'string' || !userId.trim() || userId !== userId.trim() || !Number.isSafeInteger(authzVersion) || authzVersion < 1) return null;
    const [challenge] = await this.prisma.$queryRaw<MfaChallenge[]>`
      SELECT u.id AS "userId", u."authzVersion", c.version AS "enrollmentVersion"
      FROM "User" u JOIN "MfaCredential" c ON c."userId" = u.id
      WHERE u.id = ${userId} AND u."authzVersion" = ${authzVersion}
        AND u."isActive" = true AND u."mfaEnabled" = true
        AND c."confirmedAt" <= (NOW() AT TIME ZONE 'UTC')`;
    return challenge ?? null;
  }

  async rotateSession(input: { sessionId: string; userId: string; authzVersion: number; currentRefreshTokenHash: string; nextRefreshTokenHash: string; expiresAt: Date }) {
    return this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${input.userId}
        AND "isActive" = true AND "mfaEnabled" = true AND "authzVersion" = ${input.authzVersion} FOR UPDATE`;
      if (!users.length) return null;
      const [old] = await tx.$queryRaw<Array<{ refreshExpiresAt: Date; mfaVersion: number; mfaVerifiedAt: Date }>>`
        UPDATE "Session" s SET "revokedAt" = (NOW() AT TIME ZONE 'UTC') FROM "MfaCredential" c
        WHERE s.id = ${input.sessionId} AND s."userId" = ${input.userId} AND c."userId" = s."userId"
          AND s."authzVersion" = ${input.authzVersion} AND s."refreshTokenHash" = ${input.currentRefreshTokenHash}
          AND s."revokedAt" IS NULL AND s."refreshExpiresAt" > (NOW() AT TIME ZONE 'UTC')
          AND s."mfaVersion" = c.version AND s."mfaVerifiedAt" >= c."confirmedAt"
          AND s."mfaVerifiedAt" <= (NOW() AT TIME ZONE 'UTC')
        RETURNING s."refreshExpiresAt", s."mfaVersion", s."mfaVerifiedAt"`;
      if (!old) return null;
      const session = await tx.session.create({ data: { userId: input.userId, authzVersion: input.authzVersion,
        refreshTokenHash: input.nextRefreshTokenHash, expiresAt: new Date(Math.min(input.expiresAt.getTime(), old.refreshExpiresAt.getTime())), refreshExpiresAt: old.refreshExpiresAt } });
      await tx.$executeRaw`UPDATE "Session" SET "mfaVersion" = ${old.mfaVersion},
        "mfaVerifiedAt" = (SELECT "mfaVerifiedAt" FROM "Session" WHERE id = ${input.sessionId}) WHERE id = ${session.id}`;
      return session;
    });
  }

  async hasSessionAssurance(sessionId: string, userId: string, authzVersion: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id FROM "Session" s JOIN "User" u ON u.id = s."userId"
      JOIN "MfaCredential" c ON c."userId" = u.id
      WHERE s.id = ${sessionId} AND u.id = ${userId} AND u."isActive" = true AND u."mfaEnabled" = true
        AND u."authzVersion" = ${authzVersion} AND s."authzVersion" = u."authzVersion"
        AND s."revokedAt" IS NULL AND s."expiresAt" > (NOW() AT TIME ZONE 'UTC')
        AND s."mfaVersion" = c.version AND s."mfaVerifiedAt" IS NOT NULL
        AND s."mfaVerifiedAt" >= c."confirmedAt" AND s."mfaVerifiedAt" <= (NOW() AT TIME ZONE 'UTC')`;
    return rows.length === 1;
  }

  private validInput(challenge: MfaChallenge, code: string, method: string): boolean {
    return Boolean(challenge && typeof challenge.userId === 'string' && challenge.userId.trim() &&
      challenge.userId === challenge.userId.trim() &&
      Number.isSafeInteger(challenge.authzVersion) && challenge.authzVersion > 0 &&
      Number.isSafeInteger(challenge.enrollmentVersion) && challenge.enrollmentVersion > 0 &&
      typeof code === 'string' && code.length > 0 && code.length <= 128 && ['totp', 'recovery'].includes(method));
  }

  async redeemAndCreateSession(challenge: MfaChallenge, code: string, method: 'totp' | 'recovery', input: {
    refreshTokenHash: string; expiresAt: Date; refreshExpiresAt: Date;
  }) {
    if (!this.validInput(challenge, code, method) || !input || typeof input.refreshTokenHash !== 'string' || !input.refreshTokenHash ||
        !(input.expiresAt instanceof Date) || !(input.refreshExpiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()) ||
        !Number.isFinite(input.refreshExpiresAt?.getTime()) || input.expiresAt <= new Date() ||
        input.refreshExpiresAt < input.expiresAt) return null;
    return this.prisma.$transaction(async tx => {
      // Serialize account reset/disable against redemption and session issuance.
      const [user] = await tx.$queryRaw<User[]>`SELECT * FROM "User" WHERE id = ${challenge.userId}
        AND "isActive" = true AND "mfaEnabled" = true AND "authzVersion" = ${challenge.authzVersion} FOR UPDATE`;
      if (!user) return null;
      const assurance = await this.redeem(challenge, code, method, tx);
      if (!assurance) return null;
      const session = await tx.session.create({ data: { ...input, userId: user.id, authzVersion: user.authzVersion } });
      const [persisted] = await tx.$queryRaw<Array<{ mfaVerifiedAt: Date }>>`UPDATE "Session" SET "mfaVersion" = ${assurance.mfaVersion},
        "mfaVerifiedAt" = date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') WHERE id = ${session.id} RETURNING "mfaVerifiedAt"`;
      return { session: { ...session, ...assurance, mfaVerifiedAt: persisted.mfaVerifiedAt }, user };
    });
  }

  async redeem(challenge: MfaChallenge, code: string, method: 'totp' | 'recovery', db: Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'> = this.prisma): Promise<{ mfaVersion: number; mfaVerifiedAt: Date } | null> {
    if (!this.validInput(challenge, code, method)) return null;
    const [credential] = await db.$queryRaw<Array<{ encryptedSecret: string; version: number }>>`
      SELECT c."encryptedSecret", c."version" FROM "MfaCredential" c JOIN "User" u ON u.id = c."userId"
      WHERE c."userId" = ${challenge.userId} AND c."version" = ${challenge.enrollmentVersion}
        AND u."isActive" = true AND u."mfaEnabled" = true AND u."authzVersion" = ${challenge.authzVersion}`;
    if (!credential) return null;
    let changed: number;
    if (method === 'totp') {
      let counter: number | null;
      try {
        counter = matchTotpCounter(decryptMfaSecret(credential.encryptedSecret, this.config.get<string>('mfaEncryptionKey') ?? this.config.get<string>('MFA_ENCRYPTION_KEY') ?? ''), code);
      } catch {
        throw new ServiceUnavailableException('MFA verification unavailable');
      }
      if (counter === null) return null;
      changed = await db.$executeRaw`
        UPDATE "MfaCredential" c SET "lastTotpCounter" = ${BigInt(counter)}, "updatedAt" = NOW()
        WHERE c."userId" = ${challenge.userId} AND c."version" = ${challenge.enrollmentVersion}
          AND (c."lastTotpCounter" IS NULL OR c."lastTotpCounter" < ${BigInt(counter)})
          AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = c."userId" AND u."isActive" = true
            AND u."mfaEnabled" = true AND u."authzVersion" = ${challenge.authzVersion})`;
    } else {
      const hash = hashRecoveryCode(code);
      changed = await db.$executeRaw`
        UPDATE "MfaCredential" c SET "recoveryCodeHashes" = array_remove(c."recoveryCodeHashes", ${hash}), "updatedAt" = NOW()
        WHERE c."userId" = ${challenge.userId} AND c."version" = ${challenge.enrollmentVersion}
          AND ${hash} = ANY(c."recoveryCodeHashes")
          AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = c."userId" AND u."isActive" = true
            AND u."mfaEnabled" = true AND u."authzVersion" = ${challenge.authzVersion})`;
    }
    return changed === 1 ? { mfaVersion: credential.version, mfaVerifiedAt: new Date() } : null;
  }
}
