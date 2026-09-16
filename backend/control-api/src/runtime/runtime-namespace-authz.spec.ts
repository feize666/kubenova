jest.mock('@kubernetes/client-node', () => ({}));
import { RuntimeController } from './runtime.controller';
import { AuthorizationService } from '../common/authorization.service';

describe('runtime namespace authorization', () => {
  const previous = process.env.KUBENOVA_AUTHZ_ENFORCE;
  beforeEach(() => { process.env.KUBENOVA_AUTHZ_ENFORCE = 'true'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.KUBENOVA_AUTHZ_ENFORCE;
    else process.env.KUBENOVA_AUTHZ_ENFORCE = previous;
  });
  it.each(['logs', 'exec'])('limits %s to the live namespace UID', async type => {
    const authorization = new AuthorizationService({
      groupMembership: { findMany: async () => [] },
      accessGrant: { findMany: async () => [{ id: 'g', userId: 'u', groupId: null, clusterId: 'c', role: 'operator', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'original-uid' }], capabilities: [{ capability: type }] }] },
    } as never);
    let uid = 'original-uid';
    const runtime = { createSession: jest.fn().mockResolvedValue({ sessionId: 's' }) };
    const Controller = RuntimeController as unknown as new (...args: any[]) => RuntimeController;
    const controller = new Controller(runtime, { assertCanRead: async () => {}, assertCanMutate: async () => {} }, authorization, { resolve: async () => uid });
    const request = { user: { user: { id: 'u' } }, headers: {} } as never;
    const input = { type, clusterId: 'c', namespace: 'apps', pod: 'p' } as never;
    await expect(controller.createSession(input, request)).resolves.toEqual({ sessionId: 's' });
    uid = 'recreated-uid';
    await expect(controller.createSession(input, request)).rejects.toThrow();
    expect(runtime.createSession).toHaveBeenCalledTimes(1);
  });
});
