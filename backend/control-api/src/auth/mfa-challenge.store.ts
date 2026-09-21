import { OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';

export interface MfaChallenge {
  userId: string;
  authzVersion: number;
  enrollmentVersion: number;
}

export class MfaChallengeStore implements OnModuleDestroy {
  constructor(private readonly redis: Pick<Redis, 'set' | 'getdel'> & Partial<Pick<Redis, 'disconnect'>>) {}

  onModuleDestroy(): void { this.redis.disconnect?.(); }

  private key(token: string): string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }
    return `kubenova:mfa:challenge:${createHash('sha256').update(token).digest('hex')}`;
  }

  private validate(value: unknown): MfaChallenge {
    const challenge = value as MfaChallenge | null;
    if (!challenge || typeof challenge.userId !== 'string' || !challenge.userId ||
      challenge.userId.trim() !== challenge.userId ||
      !Number.isSafeInteger(challenge.authzVersion) || challenge.authzVersion <= 0 ||
      !Number.isSafeInteger(challenge.enrollmentVersion) || challenge.enrollmentVersion <= 0) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }
    return { userId: challenge.userId, authzVersion: challenge.authzVersion, enrollmentVersion: challenge.enrollmentVersion };
  }

  async save(challenge: MfaChallenge): Promise<string> {
    const payload = this.validate(challenge);
    const token = randomBytes(32).toString('base64url');
    try {
      const result = await this.redis.set(this.key(token), JSON.stringify(payload), 'EX', 300, 'NX');
      if (result !== 'OK') throw new Error('Collision');
    } catch {
      throw new ServiceUnavailableException('MFA challenge storage unavailable');
    }
    return token;
  }

  async consume(token: string): Promise<MfaChallenge> {
    const key = this.key(token);
    let value: string | null;
    try {
      // Consume before verification: a failed code requires password authentication again.
      value = await this.redis.getdel(key);
    } catch {
      throw new ServiceUnavailableException('MFA challenge storage unavailable');
    }
    if (!value) throw new UnauthorizedException('Invalid MFA challenge');
    try {
      const decoded: unknown = JSON.parse(value);
      const payload = this.validate(decoded);
      if (Object.keys(decoded as object).length !== 3) throw new Error('Invalid fields');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid MFA challenge');
    }
  }
}
