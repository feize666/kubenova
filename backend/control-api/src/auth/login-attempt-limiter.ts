import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';

const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 300) end
return {count, redis.call('TTL', KEYS[1])}
`;

export class LoginAttemptLimiter {
  constructor(private readonly redis: Pick<Redis, 'eval'>) {}

  consumeAccount(id: string): Promise<void> {
    return this.consume('account', id, 10);
  }

  consumeIp(address: string): Promise<void> {
    return this.consume('ip', address, 100);
  }

  private async consume(scope: string, identifier: string, limit: number): Promise<void> {
    if (typeof identifier !== 'string' || !identifier.trim() || Buffer.byteLength(identifier) > 1024) {
      throw new BadRequestException('Invalid login identifier');
    }
    const key = `kubenova:login:${scope}:${createHash('sha256').update(identifier).digest('hex')}`;
    let result: unknown;
    try {
      result = await this.redis.eval(CONSUME, 1, key);
    } catch {
      throw new ServiceUnavailableException('Login temporarily unavailable');
    }
    if (!Array.isArray(result) || result.length !== 2 ||
      !Number.isSafeInteger(result[0]) || result[0] < 1 ||
      !Number.isSafeInteger(result[1]) || result[1] < 0 || result[1] > 300) {
      throw new ServiceUnavailableException('Login temporarily unavailable');
    }
    if (result[0] > limit) {
      throw new HttpException({ statusCode: 429, message: 'Too many login attempts',
        retryAfterSeconds: Math.max(1, result[1]) }, 429);
    }
  }
}
