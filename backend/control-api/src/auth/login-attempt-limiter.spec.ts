import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { LoginAttemptLimiter } from './login-attempt-limiter';

describe('LoginAttemptLimiter boundaries', () => {
  it.each(['', ' ', 'x'.repeat(1025), null, undefined])('rejects invalid identifiers %j', async value => {
    const limiter = new LoginAttemptLimiter({ eval: async () => { throw Error('must not reach storage'); } } as any);
    await expect(limiter.consumeAccount(value as any)).rejects.toMatchObject({ status: 400 });
    await expect(limiter.consumeIp(value as any)).rejects.toMatchObject({ status: 400 });
  });

  it.each([new Error('redis://secret'), null, [], [1, -1], [1, 301], ['1', 300], [0, 300]])('fails closed on unavailable or malformed storage %j', async result => {
    const limiter = new LoginAttemptLimiter({ eval: async () => {
      if (result instanceof Error) throw result;
      return result;
    } } as any);
    await expect(limiter.consumeAccount('user')).rejects.toMatchObject({ status: 503, message: 'Login temporarily unavailable' });
  });

  it('returns the remaining window with generic throttling errors', async () => {
    const limiter = new LoginAttemptLimiter({ eval: async () => [11, 42] } as any);
    await expect(limiter.consumeAccount('user')).rejects.toMatchObject({ status: 429,
      response: { statusCode: 429, message: 'Too many login attempts', retryAfterSeconds: 42 } });
  });
});

(process.env.LOGIN_REDIS_INTEGRATION === '1' ? describe : describe.skip)('Login limiter loopback Redis', () => {
  it('enforces concurrent limits, separate hashed scopes, fixed TTL and expiration', async () => {
    const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, connectTimeout: 1000, retryStrategy: () => null });
    redis.on('error', () => undefined);
    const id = `login-limiter-test-${randomUUID()}`;
    const digest = createHash('sha256').update(id).digest('hex');
    const keys = [`kubenova:login:account:${digest}`, `kubenova:login:ip:${digest}`];
    try {
      const limiter = new LoginAttemptLimiter(redis);
      const account = await Promise.allSettled(Array.from({ length: 20 }, () => limiter.consumeAccount(id)));
      expect(account.filter(r => r.status === 'fulfilled')).toHaveLength(10);
      expect(account.filter(r => r.status === 'rejected')).toHaveLength(10);
      for (const result of account) if (result.status === 'rejected') expect(result.reason.status).toBe(429);
      expect(await redis.get(keys[0])).toBe('20');
      expect(await redis.ttl(keys[0])).toBeGreaterThanOrEqual(299);
      expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(300);
      const ip = await Promise.allSettled(Array.from({ length: 110 }, () => limiter.consumeIp(id)));
      expect(ip.filter(r => r.status === 'fulfilled')).toHaveLength(100);
      expect(ip.filter(r => r.status === 'rejected')).toHaveLength(10);
      expect(await redis.get(keys[1])).toBe('110');
      await redis.expire(keys[0], 40);
      await expect(limiter.consumeAccount(id)).rejects.toMatchObject({ status: 429 });
      expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(40);
      await redis.pexpire(keys[0], 1);
      await new Promise(resolve => setTimeout(resolve, 25));
      await expect(limiter.consumeAccount(id)).resolves.toBeUndefined();
      expect(await redis.get(keys[0])).toBe('1');
      expect(await redis.ttl(keys[0])).toBeGreaterThanOrEqual(299);
    } finally {
      await redis.del(...keys);
      redis.disconnect();
    }
  });
});
