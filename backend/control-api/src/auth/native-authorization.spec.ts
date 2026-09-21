import { authorizeNativeRequest } from './native-authorization';

describe('native scoped authorization', () => {
  const actor = { userId: 'reader', expiresAt: new Date(Date.now() + 60000), authzVersion: 1 };
  const grant = { id: 'grant', clusterId: 'cluster', role: 'viewer', namespaces: [{ namespaceUid: 'uid' }], capabilities: [{ capability: 'kubeconfig' }], expiresAt: null };
  const identity = { resolve: jest.fn(async () => 'uid') };
  const auth = { listEffectiveGrants: jest.fn(async () => [grant]) };
  const run = (target = '/api/v1/namespaces/apps/pods') => authorizeNativeRequest(actor, 'cluster', 'GET', target, auth as any, identity as any);
  beforeEach(() => { auth.listEffectiveGrants.mockResolvedValue([grant]); identity.resolve.mockResolvedValue('uid'); });
  it('binds permitted reads to live UID and contributing grant', async () => {
    expect(await run()).toMatchObject({ namespaceUid: 'uid', grantIds: ['grant'], expiresAt: actor.expiresAt });
  });
  it('denies namespace recreation and missing native capability', async () => {
    identity.resolve.mockResolvedValue('new-uid');
    await expect(run()).rejects.toThrow();
    identity.resolve.mockResolvedValue('uid');
    auth.listEffectiveGrants.mockResolvedValue([{ ...grant, capabilities: [] }]);
    await expect(run()).rejects.toThrow();
  });
  it('does not combine independent native and logs grants', async () => {
    auth.listEffectiveGrants.mockResolvedValue([grant, { ...grant, id: 'logs-only', capabilities: [{ capability: 'logs' }] }]);
    await expect(run('/api/v1/namespaces/apps/pods/web/log')).rejects.toThrow();
    auth.listEffectiveGrants.mockResolvedValue([{ ...grant, capabilities: [{ capability: 'kubeconfig' }, { capability: 'logs' }] }]);
    await expect(run('/api/v1/namespaces/apps/pods/web/log')).resolves.toMatchObject({ grantIds: ['grant'] });
  });
  it('denies expired tokens and ends access at the earliest grant expiry', async () => {
    await expect(authorizeNativeRequest({ ...actor, expiresAt: new Date(0) }, 'cluster', 'GET', '/api/v1/namespaces/apps/pods', auth as any, identity as any)).rejects.toThrow();
    const expiresAt = new Date(Date.now() + 10000);
    auth.listEffectiveGrants.mockResolvedValue([{ ...grant, expiresAt } as any]);
    expect((await run()).expiresAt).toEqual(expiresAt);
  });
});
