import { OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret } from './mfa-totp';

type EnrollmentIdentity = { userId: string; sessionId: string; authzVersion: number };

export class MfaEnrollmentStore implements OnModuleDestroy {
  constructor(private readonly redis: Pick<Redis, 'set' | 'getdel'> & Partial<Pick<Redis, 'disconnect'>>, private readonly encryptionKey: string) {}

  onModuleDestroy(): void { this.redis.disconnect?.(); }

  private validIdentity(value: EnrollmentIdentity): boolean {
    return Boolean(value && [value.userId, value.sessionId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256 && id.trim() === id)
      && Number.isSafeInteger(value.authzVersion) && value.authzVersion > 0);
  }

  private key(token: string): string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Invalid MFA enrollment');
    return `kubenova:mfa:enrollment:${createHash('sha256').update(token).digest('hex')}`;
  }

  async save(identity: EnrollmentIdentity): Promise<{ token: string; secret: string }> {
    if (!this.validIdentity(identity)) throw new UnauthorizedException('Invalid MFA enrollment');
    if (!this.encryptionKey.trim()) throw new ServiceUnavailableException('MFA enrollment unavailable');
    const token = randomBytes(32).toString('base64url');
    const secret = generateTotpSecret();
    const payload = { userId: identity.userId, sessionId: identity.sessionId, authzVersion: identity.authzVersion,
      encryptedSecret: encryptMfaSecret(secret, this.encryptionKey) };
    try {
      if (await this.redis.set(this.key(token), JSON.stringify(payload), 'EX', 300, 'NX') !== 'OK') throw new Error('Collision');
    } catch { throw new ServiceUnavailableException('MFA enrollment unavailable'); }
    return { token, secret };
  }

  async consume(token: string, identity: EnrollmentIdentity): Promise<string> {
    if (!this.validIdentity(identity)) throw new UnauthorizedException('Invalid MFA enrollment');
    const key = this.key(token);
    let raw: string | null;
    try { raw = await this.redis.getdel(key); }
    catch { throw new ServiceUnavailableException('MFA enrollment unavailable'); }
    try {
      if (!raw) throw new Error('Expired');
      const payload = JSON.parse(raw);
      if (!payload || payload.userId !== identity.userId || payload.sessionId !== identity.sessionId || payload.authzVersion !== identity.authzVersion) throw new Error('Identity mismatch');
      return decryptMfaSecret(payload.encryptedSecret, this.encryptionKey);
    } catch { throw new UnauthorizedException('Invalid MFA enrollment'); }
  }
}
