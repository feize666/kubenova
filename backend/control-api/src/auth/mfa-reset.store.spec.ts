import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { MfaResetStore } from './mfa-reset.store';

const identity = { actorUserId: 'actor', actorSessionId: 'session', actorAuthzVersion: 2,
  targetUserId: 'target', targetAuthzVersion: 3, targetMfaVersion: 4 };
const key = (token: string) => `kubenova:mfa:reset:${createHash('sha256').update(token).digest('hex')}`;

describe('one-use MFA reset proof', () => {
  const entries = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number, _nx: string) => {
      if (entries.has(key)) return null;
      entries.set(key, value); return 'OK';
    }),
    getdel: jest.fn(async (key: string) => { const value = entries.get(key) ?? null; entries.delete(key); return value; }),
  };
  const store = new MfaResetStore(redis as never);
  beforeEach(() => { entries.clear(); jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(1700000000000); });
  afterEach(() => jest.restoreAllMocks());

  it('stamps purpose/expiry, hashes the opaque token and permits one consumption', async () => {
    const pending = await store.save({ ...identity, action: 'login', expiresAt: 0 } as never);
    expect(pending).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresIn: 300 });
    expect(redis.set).toHaveBeenCalledWith(key(pending.token), expect.any(String), 'EX', 300, 'NX');
    expect(await store.consume(pending.token, identity)).toEqual({ ...identity, action: 'mfa-reset', expiresAt: 1700000300000 });
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
  });
  it.each(Object.entries(identity))('binds %s and burns mismatched proofs', async (field, value) => {
    const pending = await store.save(identity);
    await expect(store.consume(pending.token, { ...identity, [field]: typeof value === 'number' ? value + 1 : 'other' })).rejects.toMatchObject({ status: 401 });
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
  });
  it.each([null, {}, ...['actorUserId', 'actorSessionId', 'targetUserId'].flatMap(field =>
    ['', ' padded ', 'x'.repeat(257), 1].map(value => ({ ...identity, [field]: value }))),
  ...['actorAuthzVersion', 'targetAuthzVersion', 'targetMfaVersion'].flatMap(field =>
    [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '2'].map(value => ({ ...identity, [field]: value })))])('rejects invalid identities %j', async invalid => {
    await expect(store.save(invalid as never)).rejects.toMatchObject({ status: 401 });
    await expect(store.consume('a'.repeat(43), invalid as never)).rejects.toMatchObject({ status: 401 });
    expect(redis.set).not.toHaveBeenCalled(); expect(redis.getdel).not.toHaveBeenCalled();
  });
  it.each(['', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43), null])('rejects malformed tokens %j', async token => {
    await expect(store.consume(token as never, identity)).rejects.toMatchObject({ status: 401 });
    expect(redis.getdel).not.toHaveBeenCalled();
  });
  it.each(['bad json', 'null', '[]', '{}', ...[
    { action: 'mfa-enrollment' }, { expiresAt: 1700000000000 }, { expiresAt: 1699999999999 },
    { expiresAt: 1700000300001 }, { expiresAt: 1700000000000.5 }, { expiresAt: '1700000300000' },
    { expiresAt: null }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 }, { targetMfaVersion: 0 },
  ].map(patch => JSON.stringify({ ...identity, action: 'mfa-reset', expiresAt: 1700000300000, ...patch }))])('rejects corrupt, stale or unbounded payload %s', async raw => {
    const pending = await store.save(identity); entries.set(key(pending.token), raw);
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
    await expect(store.consume(pending.token, identity)).rejects.toMatchObject({ status: 401 });
  });
  it('fails closed on Redis failures and failed NX writes', async () => {
    const failed = new MfaResetStore({ set: async () => { throw Error('private'); }, getdel: async () => { throw Error('private'); } } as never);
    await expect(failed.save(identity)).rejects.toMatchObject({ status: 503 });
    await expect(failed.consume('a'.repeat(43), identity)).rejects.toMatchObject({ status: 503 });
    await expect(new MfaResetStore({ set: async () => null } as never).save(identity)).rejects.toMatchObject({ status: 503 });
  });
});

(process.env.MFA_REDIS_INTEGRATION === '1' ? describe : describe.skip)('MFA reset with isolated real Redis', () => {
  it('enforces TTL and one concurrent consumer without touching real users', async () => {
    const redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `mfa-reset-test:${randomUUID()}:`, maxRetriesPerRequest: 0, connectTimeout: 1000 });
    const keys: string[] = [];
    try {
      const store = new MfaResetStore(redis);
      const first = await store.save(identity); keys.push(key(first.token));
      expect(await redis.ttl(keys[0])).toBeGreaterThanOrEqual(299);
      expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(300);
      const results = await Promise.allSettled([store.consume(first.token, identity), store.consume(first.token, identity)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 401 } }]);
      const second = await store.save(identity); keys.push(key(second.token));
      await redis.pexpire(keys[1], 1);
      await new Promise(resolve => setTimeout(resolve, 20));
      await expect(store.consume(second.token, identity)).rejects.toMatchObject({ status: 401 });
    } finally { try { if (keys.length) await redis.del(...keys); } finally { redis.disconnect(); } }
  });
});
