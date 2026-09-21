import { RuntimeSessionService, type RuntimeTokenPayload } from './runtime-session.service';
jest.mock('@kubernetes/client-node', () => ({}));

describe('runtime token persisted identity boundary', () => {
  const payload: RuntimeTokenPayload = {
    sessionId: 's', userId: 'u', type: 'logs', clusterId: 'c', namespace: 'ns',
    pod: 'pod', container: 'app', path: '/ws/logs', exp: Math.floor(Date.now() / 1000) + 600,
  };
  async function validate(change: Record<string, unknown> = {}) {
    const row = { id: 's', userId: 'u', type: 'logs', clusterId: 'c', namespace: 'ns', pod: 'pod', container: 'app', closedAt: null, expiresAt: new Date(payload.exp * 1000), ...change };
    const service = new RuntimeSessionService({ findSessionById: async () => row } as never, { assertCanRead: async () => {} } as never, {} as never, {} as never);
    return service.validateSessionTokenDetailed({ sessionId: 's', runtimeToken: service.createRuntimeToken(payload), expectedPath: '/ws/logs' });
  }
  it('accepts an exact persisted identity', async () => {
    expect((await validate()).payload).toEqual(payload);
  });
  it.each(['userId', 'type', 'clusterId', 'namespace', 'pod', 'container'])('rejects a mismatched %s', async key => {
    expect(await validate({ [key]: 'other' })).toMatchObject({ payload: null, code: 'RUNTIME_TOKEN_SESSION_MISMATCH' });
  });
  it('rejects an ownerless persisted session', async () => {
    expect((await validate({ userId: null })).payload).toBeNull();
  });
});
