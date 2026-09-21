import { MfaEnrollmentStore } from './mfa-enrollment.store';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

describe('pending MFA enrollment', () => {
  it('releases its owned Redis connection when the module shuts down', () => {
    const disconnect = jest.fn();
    new MfaEnrollmentStore({ disconnect } as never, 'key').onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  const entries = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string) => { entries.set(key, value); return 'OK'; }),
    getdel: jest.fn(async (key: string) => { const value = entries.get(key) ?? null; entries.delete(key); return value; }),
  };
  const identity = { userId: 'user-1', sessionId: 'session-1', authzVersion: 2 };
  beforeEach(() => { entries.clear(); jest.clearAllMocks(); });
  it.each([null, {}, { ...identity, userId: '' }, { ...identity, sessionId: ' padded ' },
    { ...identity, authzVersion: 0 }, { ...identity, authzVersion: 1.5 }])('rejects malformed identity before storage: %j', async identity => {
    await expect(new MfaEnrollmentStore(redis as never, 'key').save(identity as never)).rejects.toMatchObject({ status: 401 });
    expect(redis.set).not.toHaveBeenCalled();
  });
  it('encrypts a generated secret and binds single-use redemption to the authenticated session', async () => {
    const store = new MfaEnrollmentStore(redis as never, 'test-encryption-key');
    const pending = await store.save(identity);
    expect(pending.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(pending.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...entries.values()].join()).not.toContain(pending.secret);
    expect([...entries.keys()].join()).not.toContain(pending.token);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 300, 'NX');
    expect(await store.consume(pending.token, identity)).toBe(pending.secret);
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
  });
  it.each([{ ...identity, userId: 'other' }, { ...identity, sessionId: 'other' }, { ...identity, authzVersion: 3 }])('rejects mismatched identity %j and consumes the request', async other => {
    const store = new MfaEnrollmentStore(redis as never, 'key');
    const pending = await store.save(identity);
    await expect(store.consume(pending.token, other)).rejects.toMatchObject({ status: 401 });
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
  });
  it('fails closed without encryption and on corrupt ciphertext or unavailable storage', async () => {
    await expect(new MfaEnrollmentStore(redis as never, '').save(identity)).rejects.toMatchObject({ status: 503 });
    expect(entries.size).toBe(0);
    const store = new MfaEnrollmentStore(redis as never, 'key');
    const pending = await store.save(identity);
    entries.set([...entries.keys()][0], 'corrupted');
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
    const failed = { set: async () => { throw Error('sensitive'); }, getdel: async () => { throw Error('sensitive'); } };
    await expect(new MfaEnrollmentStore(failed as never, 'key').save(identity)).rejects.toMatchObject({ status: 503 });
  });
});

(process.env.MFA_REDIS_INTEGRATION === '1' ? describe : describe.skip)('pending enrollment on real Redis', () => {
  it('expires pending secrets and permits one concurrent consumer only', async () => {
    const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, connectTimeout: 1000 });
    const keys: string[] = [];
    const identity = { userId: 'isolated-enrollment', sessionId: 'isolated-session', authzVersion: 1 };
    try {
      const store = new MfaEnrollmentStore(redis, 'integration-only-encryption-key');
      const issue = async () => {
        const pending = await store.save(identity);
        keys.push(`kubenova:mfa:enrollment:${createHash('sha256').update(pending.token).digest('hex')}`);
        return pending;
      };
      const pending = await issue();
      expect(await redis.ttl(keys[0])).toBeGreaterThanOrEqual(299);
      expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(300);
      expect(await redis.get(keys[0])).not.toContain(pending.secret);
      const results = await Promise.allSettled([store.consume(pending.token, identity), store.consume(pending.token, identity)]);
      expect(results.filter(result => result.status === 'fulfilled')).toEqual([{ status: 'fulfilled', value: pending.secret }]);
      expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 401 } }]);
      const expired = await issue();
      await redis.pexpire(keys[1], 1);
      await new Promise(resolve => setTimeout(resolve, 20));
      await expect(store.consume(expired.token, identity)).rejects.toMatchObject({ status: 401 });
    } finally {
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
  });
});
