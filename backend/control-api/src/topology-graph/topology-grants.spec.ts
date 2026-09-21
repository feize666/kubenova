jest.mock('@kubernetes/client-node', () => ({}));

import { TopologyGraphService } from './topology-graph.service';
import { TopologySummaryService } from '../topology-summary/topology-summary.service';
import { AuthorizationService } from '../common/authorization.service';
import { ClusterAccessService } from '../common/cluster-access.service';

const actor = { id: 'reader', role: 'read-only' };
const now = new Date();
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (value === undefined) return true;
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === 'OR') return value.some((v: any) => matches(row, v));
    if (key === 'cluster') return true;
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}
function build() {
  const grants: any[] = [{ id: 'g1', userId: 'reader', groupId: null, clusterId: 'c1', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid-ai' }], capabilities: [] }];
  const row = (id: string, clusterId: string, namespace: string | null, kind: string) => ({ id, name: id, clusterId, namespace, kind, state: 'active', updatedAt: now, spec: {}, statusJson: {}, labels: {}, dataKeys: [] });
  const rows = [row('allowed', 'c1', 'ai', 'Pod'), row('other-ns', 'c1', 'other', 'Pod'), row('other-cluster', 'c2', 'ai', 'Pod')];
  const table = (items: any[]) => ({ findMany: jest.fn(async ({ where }: any) => items.filter(r => matches(r, where))), aggregate: jest.fn(async ({ where }: any) => ({ _count: { _all: items.filter(r => matches(r, where)).length }, _max: { updatedAt: now } })) });
  const prisma: any = {
    workloadRecord: table(rows), networkResource: table([row('global-gateway', 'c1', null, 'GatewayClass')]),
    storageResource: table([row('pv', 'c1', null, 'PV')]), configResource: table([row('cm', 'c1', 'ai', 'ConfigMap'), row('secret', 'c1', 'ai', 'Secret')]),
    namespaceRecord: table([{ clusterId: 'c1', name: 'ai', state: 'active', updatedAt: now }, { clusterId: 'c1', name: 'other', state: 'active', updatedAt: now }]),
    monitoringAlert: table([{ clusterId: 'c1', namespace: 'other', status: 'firing', severity: 'critical', updatedAt: now }]),
    groupMembership: { findMany: async () => [] }, accessGrant: { findMany: async () => grants }, clusterRoleBinding: { findMany: async () => [] },
  };
  const access = new ClusterAccessService(prisma);
  const auth = new AuthorizationService(prisma);
  const identity = { resolve: jest.fn(async () => 'uid-ai') };
  const health: any = { listReadableClusterIdsForResourceRead: async () => ['c1', 'c2'], assertClusterOnlineForRead: async () => undefined, getLatestSnapshot: async () => ({ ok: true, checkedAt: now.toISOString() }) };
  const values = new Map();
  const cache: any = { get: jest.fn(async key => values.get(key)), set: jest.fn(async (key, value) => { values.set(key, value); }) };
  const graph = new (TopologyGraphService as any)(prisma, health, cache, access, auth, identity) as TopologyGraphService;
  const summary = new (TopologySummaryService as any)(prisma, health, access, auth, identity) as TopologySummaryService;
  return { graph, summary, grants, identity, prisma, cache, rows };
}

describe('topology grant isolation', () => {
  it('requires an actor on v1 and summary (only the internal v2 caller is trusted)', async () => {
    const { graph, summary } = build();
    await expect(graph.getGraph()).rejects.toThrow();
    await expect(summary.listNamespaceSummaries()).rejects.toThrow();
    await expect(graph.getGraphV2({ clusterId: 'c1' })).resolves.toBeDefined();
  });
  it.each(['getGraph', 'getGraphV2'] as const)('%s returns only authorized namespaced resources', async method => {
    const { graph } = build();
    const result = await (graph[method] as any)({ clusterId: 'c1' }, actor);
    expect(result.resources.map((r: any) => r.name).sort()).toEqual(['allowed', 'cm']);
  });
  it('scopes namespace summary before aggregating counts', async () => {
    const { summary } = build();
    const result = await (summary.listNamespaceSummaries as any)({}, actor);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].namespace).toBe('ai');
    expect(result.items[0].resourceCounts).toEqual({ Pod: 1, ConfigMap: 1 });
  });
  it('unfiltered v1 uses exact cluster/namespace pairs rather than a cross product', async () => {
    const { graph, grants, identity, rows } = build();
    grants.push({ ...grants[0], id: 'g2', clusterId: 'c2', namespaces: [{ namespaceName: 'other', namespaceUid: 'uid-other' }] });
    identity.resolve.mockImplementation(async (_cluster?: string, namespace?: string) => namespace === 'other' ? 'uid-other' : 'uid-ai');
    rows.push({ ...rows[0], id: 'allowed-c2', name: 'allowed-c2', clusterId: 'c2', namespace: 'other' });
    const result = await graph.getGraph({}, actor);
    expect(result.resources.map(r => r.name).sort()).toEqual(['allowed', 'allowed-c2', 'cm']);
  });
  it('honors effective group grants and fails closed when live namespace identity cannot be read', async () => {
    const { graph, grants, identity, prisma } = build();
    grants[0].userId = null;
    grants[0].groupId = 'team';
    prisma.groupMembership.findMany = async () => [{ groupId: 'team' }];
    expect((await graph.getGraph({}, actor)).resources.map(r => r.name).sort()).toEqual(['allowed', 'cm']);
    identity.resolve.mockRejectedValue(new Error('offline'));
    await expect(graph.getGraphV2({ clusterId: 'c1' }, actor)).rejects.toThrow();
  });
  it('legacy cluster bindings allow global resources but do not confer Secret metadata capability', async () => {
    const { graph, prisma } = build();
    prisma.clusterRoleBinding.findMany = async () => [{ clusterId: 'c1' }];
    const result = await graph.getGraphV2({ clusterId: 'c1' }, actor);
    expect(result.resources.map(r => r.name).sort()).toEqual(['allowed', 'cm', 'global-gateway', 'other-ns', 'pv']);
  });
  it('returns an empty unfiltered graph and summary after all grants are removed', async () => {
    const { graph, summary, grants, prisma } = build();
    grants.length = 0;
    expect((await graph.getGraph({}, actor)).resources).toEqual([]);
    expect((await summary.listNamespaceSummaries({}, actor)).items).toEqual([]);
    expect(prisma.configResource.findMany).not.toHaveBeenCalled();
  });
  it.each([{}, { id: 'reader', role: 'unknown' }])('rejects invalid HTTP identity %j', async invalid => {
    const { graph, summary } = build();
    await expect((graph.getGraphV2 as any)({ clusterId: 'c1' }, invalid)).rejects.toThrow();
    await expect((graph.getGraph as any)({}, invalid)).rejects.toThrow();
    await expect((summary.listNamespaceSummaries as any)({}, invalid)).rejects.toThrow();
  });
  it.each([{ clusterId: 'c2' }, { clusterId: 'c1', namespace: 'other' }])('rejects explicit foreign scope %j before reads', async query => {
    const { graph, prisma } = build();
    await expect((graph.getGraphV2 as any)(query, actor)).rejects.toThrow();
    expect(prisma.workloadRecord.aggregate).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'expired', 'recreated'])('rechecks %s grants before cache reuse', async reason => {
    const { graph, grants, identity } = build();
    await (graph.getGraphV2 as any)({ clusterId: 'c1' }, actor);
    if (reason === 'revoked') grants[0].revokedAt = now;
    if (reason === 'expired') grants[0].expiresAt = new Date(0);
    if (reason === 'recreated') identity.resolve.mockResolvedValue('new-uid');
    await expect((graph.getGraphV2 as any)({ clusterId: 'c1' }, actor)).rejects.toThrow();
  });
  it('separates admin and scoped cached graphs and secrets capability changes', async () => {
    const { graph, grants } = build();
    const admin = await (graph.getGraphV2 as any)({ clusterId: 'c1' }, { id: 'admin', role: 'admin' });
    expect(admin.resources.some((r: any) => r.name === 'secret')).toBe(true);
    const scoped = await (graph.getGraphV2 as any)({ clusterId: 'c1' }, actor);
    expect(scoped.resources.map((r: any) => r.name).sort()).toEqual(['allowed', 'cm']);
    grants[0].capabilities.push({ capability: 'secrets' });
    const withSecrets = await (graph.getGraphV2 as any)({ clusterId: 'c1' }, actor);
    expect(withSecrets.resources.map((r: any) => r.name).sort()).toEqual(['allowed', 'cm', 'secret']);
  });
  it('does not count Secret alerts or load their metadata without the capability in that namespace', async () => {
    const { graph, prisma, grants } = build();
    grants.push({ ...grants[0], id: 'g2', namespaces: [{ namespaceName: 'other', namespaceUid: 'uid-other' }], capabilities: [{ capability: 'secrets' }] });
    const alerts = [
      { clusterId: 'c1', namespace: 'ai', resourceType: 'Secret', resourceName: 'hidden', status: 'firing', severity: 'critical' },
      { clusterId: 'c1', namespace: 'ai', resourceType: null, resourceName: null, status: 'firing', severity: 'critical' },
    ];
    prisma.monitoringAlert.findMany.mockImplementation(async ({ where }: any) => alerts.filter(row => matches(row, where)));
    const result = await (graph.getGraphV2 as any)({ clusterId: 'c1', namespace: 'ai' }, actor);
    expect(result.coverage.warningRecords).toBe(1);
    expect(result.resources.some((row: any) => row.kind === 'Secret')).toBe(false);
    const select = prisma.configResource.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('data');
    expect(select).not.toHaveProperty('spec');
  });
});
