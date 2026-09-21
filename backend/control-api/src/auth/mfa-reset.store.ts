import { OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import type { MfaResetIdentity, MfaResetProof } from './mfa-reset.types';

export class MfaResetStore implements OnModuleDestroy {
  constructor(private readonly redis: Pick<Redis, 'set' | 'getdel'> & Partial<Pick<Redis, 'disconnect'>>) {}
  onModuleDestroy(): void { this.redis.disconnect?.(); }

  private validIdentity(value: MfaResetIdentity): boolean {
    return Boolean(value && [value.actorUserId, value.actorSessionId, value.targetUserId].every(id =>
      typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id)
      && [value.actorAuthzVersion, value.targetAuthzVersion, value.targetMfaVersion].every(version =>
        Number.isSafeInteger(version) && version > 0));
  }

  private key(token: string): string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Invalid MFA reset');
    return `kubenova:mfa:reset:${createHash('sha256').update(token).digest('hex')}`;
  }

  async save(identity: MfaResetIdentity): Promise<{ token: string; expiresIn: 300 }> {
    if (!this.validIdentity(identity)) throw new UnauthorizedException('Invalid MFA reset');
    const token = randomBytes(32).toString('base64url');
    const payload: MfaResetProof = {
      actorUserId: identity.actorUserId, actorSessionId: identity.actorSessionId, actorAuthzVersion: identity.actorAuthzVersion,
      targetUserId: identity.targetUserId, targetAuthzVersion: identity.targetAuthzVersion, targetMfaVersion: identity.targetMfaVersion,
      action: 'mfa-reset', expiresAt: Date.now() + 300000,
    };
    try {
      if (await this.redis.set(this.key(token), JSON.stringify(payload), 'EX', 300, 'NX') !== 'OK') throw new Error('Collision');
    } catch { throw new ServiceUnavailableException('MFA reset unavailable'); }
    return { token, expiresIn: 300 };
  }

  async consume(token: string, identity: MfaResetIdentity): Promise<MfaResetProof> {
    if (!this.validIdentity(identity)) throw new UnauthorizedException('Invalid MFA reset');
    const key = this.key(token);
    let raw: string | null;
    try { raw = await this.redis.getdel(key); }
    catch { throw new ServiceUnavailableException('MFA reset unavailable'); }
    try {
      if (!raw) throw new Error('Missing proof');
      const payload = JSON.parse(raw) as MfaResetProof;
      const now = Date.now();
      if (!this.validIdentity(payload) || payload.action !== 'mfa-reset'
        || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now || payload.expiresAt > now + 300000
        || payload.actorUserId !== identity.actorUserId || payload.actorSessionId !== identity.actorSessionId
        || payload.actorAuthzVersion !== identity.actorAuthzVersion || payload.targetUserId !== identity.targetUserId
        || payload.targetAuthzVersion !== identity.targetAuthzVersion || payload.targetMfaVersion !== identity.targetMfaVersion) {
        throw new Error('Invalid proof');
      }
      return payload;
    } catch { throw new UnauthorizedException('Invalid MFA reset'); }
  }
}
