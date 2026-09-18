jest.mock('@kubernetes/client-node', () => ({}));
import { NamespacesService } from './namespaces.service';

describe('namespace grant list isolation', () => {
  const actor = { id: 'reader', role: 'user' };
  function build() {
    const rows = [['c1', 'ai'], ['c1', 'private'], ['c2', 'ai']].map(([clusterId, name]) => ({
      id: `${clusterId}/${name}`, clusterId, name, state: 'active', labels: {},
      createdAt: new Date(), updatedAt: new Date(), cluster: { name: clusterId },
    }));
    const grants = [{ clusterId: 'c1', namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid-ai' }] }];
    const access = { isPlatformAdmin: (a: any) => a?.role === 'platform-admin', listAccessibleClusterIds: async () => [] };
    const identity = { resolve: jest.fn(async () => 'uid-ai') };
    const service = new (NamespacesService as any)(
      { namespaceRecord: { findMany: async () => rows } },
      { listReadableClusterIdsForResourceRead: async () => ['c1', 'c2'], assertClusterOnlineForRead: async () => {} },
      {}, {}, {}, access, { listEffectiveGrants: async () => grants }, identity,
    );
    return { service, identity, access, grants };
  }
  it('filters before count and pagination without leaking same-name namespaces in other clusters', async () => {
    const { service } = build();
    const result = await service.list({ pageSize: '1' }, actor);
    expect(result.total).toBe(1);
    expect(result.items.map((i: any) => i.id)).toEqual(['c1/ai']);
    expect((await service.list({ page: '2', pageSize: '1' }, actor)).items).toEqual([]);
  });
  it('does not inherit grants after namespace recreation', async () => {
    const { service, identity } = build();
    identity.resolve.mockResolvedValue('replacement-uid');
    expect((await service.list({}, actor)).total).toBe(0);
  });
  it('returns no namespaces for an explicitly unauthorized cluster', async () => {
    const { service } = build();
    expect((await service.list({ clusterId: 'c2' }, actor)).items).toEqual([]);
  });
  it('does not expose a namespace with a matching name but an unrelated UID', async () => {
    const { service, grants } = build();
    grants[0].namespaces[0].namespaceUid = 'old-uid';
    expect((await service.list({ clusterId: 'c1' }, actor)).items).toEqual([]);
  });
  it('omits namespaces when live identity cannot be resolved', async () => {
    const { service, identity } = build();
    identity.resolve.mockRejectedValue(new Error('offline'));
    expect((await service.list({}, actor)).total).toBe(0);
  });
  it('retains legacy whole-cluster access without widening the namespaced grant', async () => {
    const { service, access } = build();
    access.listAccessibleClusterIds = async () => ['c2'] as never[];
    expect((await service.list({}, actor)).items.map((i: any) => i.id)).toEqual(['c1/ai', 'c2/ai']);
  });
  it('keeps platform admin lists unchanged and fails closed without an identity', async () => {
    const { service } = build();
    expect((await service.list({}, { role: 'platform-admin' })).total).toBe(3);
    expect((await service.list({})).total).toBe(0);
  });
});
