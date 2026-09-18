import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { MfaChallengeStore } from './mfa-challenge.store';

describe('MfaChallengeStore', () => {
  const payload = { userId: 'user-1', authzVersion: 1, enrollmentVersion: 2 };
  const entries = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string) => { entries.set(key, value); return 'OK'; }),
    getdel: jest.fn(async (key: string) => { const value = entries.get(key) ?? null; entries.delete(key); return value; }),
  };
  beforeEach(() => { entries.clear(); jest.clearAllMocks(); });

  it('issues a random hashed-key challenge that can be consumed only once', async () => {
    const store = new MfaChallengeStore(redis as any);
    const token = await store.save(payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const key = `kubenova:mfa:challenge:${createHash('sha256').update(token).digest('hex')}`;
    expect(entries.get(key)).toBe(JSON.stringify(payload));
    expect(redis.set).toHaveBeenCalledWith(key, JSON.stringify(payload), 'EX', 300, 'NX');
    expect(await store.consume(token)).toEqual(payload);
    await expect(store.consume(token)).rejects.toMatchObject({ status: 401 });
    expect(await store.save(payload)).not.toBe(token);
  });

  it.each([null, {}, { ...payload, userId: '' }, { ...payload, userId: ' user' },
    { ...payload, authzVersion: 0 }, { ...payload, enrollmentVersion: -1 },
    { ...payload, authzVersion: 1.2 }, { ...payload, enrollmentVersion: '2' },
    { ...payload, authzVersion: Number.MAX_SAFE_INTEGER + 1 }])('rejects invalid challenge payload %j', async input => {
    await expect(new MfaChallengeStore(redis as any).save(input as any)).rejects.toMatchObject({ status: 401 });
    expect(entries.size).toBe(0);
  });

  it('stores only the three identity/version fields', async () => {
    const store = new MfaChallengeStore(redis as any);
    const token = await store.save({ ...payload, secret: 'not-for-storage' } as any);
    expect([...entries.values()]).toEqual([JSON.stringify(payload)]);
    expect(await store.consume(token)).toEqual(payload);
  });

  it.each([null, '', 'x'.repeat(42), 'x'.repeat(44), '!'.repeat(43), []])('rejects malformed token %j', async token => {
    await expect(new MfaChallengeStore(redis as any).consume(token as any)).rejects.toMatchObject({ status: 401 });
    expect(redis.getdel).not.toHaveBeenCalled();
  });

  it.each(['{', 'null', '{}', JSON.stringify({ ...payload, enrollmentVersion: 0 }),
    JSON.stringify({ ...payload, extra: 'forbidden' })])('rejects corrupted stored payload %s', async value => {
    const store = new MfaChallengeStore(redis as any);
    const token = await store.save(payload);
    entries.set([...entries.keys()][0], value);
    await expect(store.consume(token)).rejects.toMatchObject({ status: 401 });
    expect(entries.size).toBe(0);
  });

  it('returns generic unavailable errors on Redis failure or failed NX', async () => {
    const failed = { set: async () => { throw Error('sensitive'); }, getdel: async () => { throw Error('sensitive'); } };
    const store = new MfaChallengeStore(failed as any);
    for (const action of [() => store.save(payload), () => store.consume('x'.repeat(43)),
      () => new MfaChallengeStore({ ...failed, set: async () => null } as any).save(payload)]) {
      await expect(action()).rejects.toMatchObject({ status: 503, message: 'MFA challenge storage unavailable' });
    }
  });
});

(process.env.MFA_REDIS_INTEGRATION === '1' ? describe : describe.skip)('MFA loopback Redis integration', () => {
  it('expires challenges and permits exactly one concurrent consumer', async () => {
    const redis = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, connectTimeout: 1000 });
    const keys: string[] = [];
    try {
      const store = new MfaChallengeStore(redis);
      const payload = { userId: 'mfa-store-integration', authzVersion: 1, enrollmentVersion: 1 };
      const issue = async () => {
        const token = await store.save(payload);
        keys.push(`kubenova:mfa:challenge:${createHash('sha256').update(token).digest('hex')}`);
        return token;
      };
      const token = await issue();
      expect(await redis.ttl(keys[0])).toBeGreaterThanOrEqual(299);
      expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(300);
      expect(JSON.parse((await redis.get(keys[0]))!)).toEqual(payload);
      const results = await Promise.allSettled([store.consume(token), store.consume(token)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 401 } }]);
      const expired = await issue();
      await redis.pexpire(keys[1], 1);
      await new Promise(resolve => setTimeout(resolve, 20));
      await expect(store.consume(expired)).rejects.toMatchObject({ status: 401 });
    } finally {
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
  });
});
