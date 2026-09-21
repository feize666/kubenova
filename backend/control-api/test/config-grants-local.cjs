const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const load = path => require(`../dist/src/${path}`);
const { ConfigsService } = load('configs/configs.service');
const { ConfigsRepository } = load('configs/configs.repository');
const { AuthorizationService } = load('common/authorization.service');
const { ClusterAccessService } = load('common/cluster-access.service');
const { NamespaceIdentityService } = load('common/namespace-identity.service');
const { ClustersService } = load('clusters/clusters.service');
const { K8sClientService } = load('clusters/k8s-client.service');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local database required');
const db = new PrismaClient();

(async () => {
  const actor = await db.user.findFirst({ where: { email: 'loop-read', isActive: true }, select: { id: true, role: true } });
  assert.ok(actor, 'Existing loop-read required');
  const clients = new K8sClientService();
  const authorization = new AuthorizationService(db);
  const access = new ClusterAccessService(db, authorization);
  const identity = new NamespaceIdentityService(new ClustersService(db, clients), clients);
  const grants = await authorization.listEffectiveGrants(actor.id);
  assert.equal(grants.length, 1);
  const clusterId = grants[0].clusterId;
  assert.deepEqual(grants[0].namespaces.map(scope => scope.namespaceName), ['ai']);
  assert.ok(!grants[0].capabilities.some(item => item.capability === 'secrets'));
  // Only suppress inventory synchronization; authorization, live UID resolution
  // and scoped SQL use real implementations. No login or mutation is performed.
  const health = {
    assertClusterOnlineForRead: async () => {},
    listReadableClusterIdsForResourceRead: async () => (await db.clusterRegistry.findMany({ where: { deletedAt: null, status: { not: 'deleted' } }, select: { id: true } })).map(row => row.id),
  };
  const service = new ConfigsService(new ConfigsRepository(db), health, { getKubeconfig: async () => null }, {}, { consumeClusterDirty: () => false }, clients, access, authorization, identity);
  const expected = await db.configResource.count({ where: { clusterId, namespace: 'ai', kind: 'ConfigMap', state: { not: 'deleted' } } });
  assert.ok(expected > 0, 'Existing authorized ConfigMaps required');
  for (const query of [{}, { clusterId }, { clusterId, namespace: 'ai' }]) {
    const result = await service.list({ ...query, pageSize: '200', clusterIds: ['forged'], scopes: [{ clusterId: 'forged' }] }, actor);
    assert.equal(result.total, expected, 'Only authorized ConfigMaps may be counted');
    assert.ok(result.items.every(row => row.clusterId === clusterId && row.namespace === 'ai' && row.kind === 'ConfigMap'));
  }
  const permitted = await db.configResource.findFirst({ where: { clusterId, namespace: 'ai', kind: 'ConfigMap', state: { not: 'deleted' } }, select: { id: true } });
  assert.equal((await service.getById(permitted.id, actor)).id, permitted.id);
  await service.getRevisions(permitted.id, actor);
  const forbidden = await db.configResource.findMany({ where: { clusterId, OR: [{ namespace: { not: 'ai' } }, { kind: 'Secret' }], state: { not: 'deleted' } }, select: { id: true, kind: true }, take: 200 });
  assert.ok(forbidden.some(row => row.kind === 'Secret'), 'Existing secret denial target required');
  for (const row of forbidden.slice(0, 5).concat(forbidden.filter(row => row.kind === 'Secret').slice(0, 1))) {
    await assert.rejects(service.getById(row.id, actor), error => error.getStatus?.() === 403);
    await assert.rejects(service.getRevisions(row.id, actor), error => error.getStatus?.() === 403);
    await assert.rejects(service.getRevisionDiff(row.id, 1, 2, actor), error => error.getStatus?.() === 403);
  }
  console.log('PASS scoped ConfigMaps and denied foreign/Secret detail, revisions and diff with real grants/DB/live UID; no data values printed or records changed');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
