jest.mock('@kubernetes/client-node', () => ({}));
import { ResourcesController } from './resources.controller';

describe('resource drawer grant scope', () => {
  it.each([true, false])('uses discovered dynamic scope rather than the supplied namespace: namespaced=%s', async namespaced => {
    const resources = { resolveDynamicReadScope: async () => ({ namespace: namespaced ? 'ai' : '', kind: namespaced ? 'Widget' : 'Node' }), getDynamicResourceDetail: jest.fn(async () => ({ name: 'ok' })) };
    const access = { listAccessibleClusterIds: async () => [], assertCanDiscover: jest.fn(), assertCanRead: jest.fn() };
    const controller = new ResourcesController(resources as never, {} as never, {} as never, access as never, { authorize: async () => ({ allowed: true }) } as never, { resolve: async () => 'uid' } as never);
    const result = controller.getDynamicDetail({ user: { user: { id: 'u' } } } as never, 'c', '', 'v1', 'widgets', 'ai', 'name');
    if (namespaced) await expect(result).resolves.toEqual({ name: 'ok' });
    else { await expect(result).rejects.toMatchObject({ status: 403 }); expect(resources.getDynamicResourceDetail).not.toHaveBeenCalled(); }
  });
  it.each(['deployment', 'secret', 'node'])('checks YAML grant scope and sensitive kind %s', async kind => {
    const resources = { isNamespacedKind: () => kind !== 'node', getYaml: jest.fn(async () => ({ yaml: 'safe' })) };
    const access = { listAccessibleClusterIds: async () => [], assertCanRead: jest.fn() };
    const authorize = jest.fn(async (input: any) => ({ allowed: input.capability !== 'secrets' }));
    const controller = new ResourcesController(resources as never, {} as never, {} as never, access as never, { authorize } as never, { resolve: async () => 'uid' } as never);
    const result = controller.getYaml({ user: { user: { id: 'reader', role: 'user' } } } as never, 'c', 'ai', kind, 'name');
    if (kind === 'deployment') {
      await expect(result).resolves.toEqual({ yaml: 'safe' });
      expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c', namespaceUid: 'uid' }));
    } else {
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(resources.getYaml).not.toHaveBeenCalled();
    }
  });
  it.each([true, false])('checks stored namespace UID for grant-only callers: allowed=%s', async allowed => {
    const resources = { resolveDetailClusterScope: async () => ({ clusterId: 'c', scope: 'namespace', namespace: 'ai' }), getDetail: jest.fn(async () => ({ name: 'permitted' })) };
    const access = { listAccessibleClusterIds: async () => [], listDiscoverableClusterIds: async () => ['c'], assertCanRead: jest.fn() };
    const authorize = jest.fn(async () => ({ allowed }));
    const identities = { resolve: jest.fn(async () => 'live-uid') };
    const controller = new ResourcesController(resources as never, {} as never, {} as never, access as never, { authorize } as never, identities as never);
    const result = controller.getDetail({ user: { user: { id: 'reader', role: 'user' } } } as never, 'deployment', 'opaque');
    if (allowed) await expect(result).resolves.toEqual({ name: 'permitted' });
    else { await expect(result).rejects.toMatchObject({ status: 403 }); expect(resources.getDetail).not.toHaveBeenCalled(); }
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ userId: 'reader', clusterId: 'c', namespaceUid: 'live-uid' }));
  });
});
