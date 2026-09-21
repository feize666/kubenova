const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const load = path => require(`../dist/src/${path}`);
const { NetworkService } = load('network/network.service');
const { NetworkRepository } = load('network/network.repository');
const { StorageService } = load('storage/storage.service');
const { StorageRepository } = load('storage/storage.repository');
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
  const realClusters = new ClustersService(db, clients);
  const authorization = new AuthorizationService(db);
  const access = new ClusterAccessService(db, authorization);
  const identity = new NamespaceIdentityService(realClusters, clients);
  const grants = await authorization.listEffectiveGrants(actor.id);
  assert.equal(grants.length, 1);
  const clusterId = grants[0].clusterId;
  assert.deepEqual(grants[0].namespaces.map(scope => scope.namespaceName), ['ai']);
  // Inventory/authorization use real PostgreSQL and live UID. Disable automatic
  // sync only, so acceptance cannot mutate inventory or Kubernetes resources.
  const health = {
    assertClusterOnlineForRead: async () => {},
    listReadableClusterIdsForResourceRead: async () => (await db.clusterRegistry.findMany({ where: { deletedAt: null, status: { not: 'deleted' } }, select: { id: true } })).map(row => row.id),
  };
  const noSyncClusters = { getKubeconfig: async () => null };
  const noSync = { syncCluster: async () => { throw Error('Acceptance must not sync'); } };
  const events = { consumeClusterDirty: () => false };
  const network = new NetworkService(new NetworkRepository(db), health, noSyncClusters, noSync, events, clients, access, authorization, identity);
  const storage = new StorageService(new StorageRepository(db), noSyncClusters, clients, noSync, health, events, access, authorization, identity);
  for (const [service, model, extra] of [[network, db.networkResource, {}], [storage, db.storageResource, { kind: 'PVC' }]]) {
    const expected = await model.count({ where: { clusterId, namespace: 'ai', state: { not: 'deleted' }, ...extra } });
    const result = await service.list({ pageSize: '200', sync: 'false', scopes: [{ clusterId: 'forged' }], clusterIds: ['forged'] }, actor);
    assert.equal(result.total, expected);
    assert.ok(result.items.every(row => row.clusterId === clusterId && row.namespace === 'ai'));
    if (result.items[0]) await service.getById(result.items[0].id, actor);
    await assert.rejects(service.list({ clusterId, namespace: 'kube-system', sync: 'false' }, actor), error => error.getStatus?.() === 403);
    const foreign = await model.findFirst({ where: { clusterId, namespace: { not: 'ai' }, state: { not: 'deleted' } }, select: { id: true } });
    if (foreign) await assert.rejects(service.getById(foreign.id, actor), error => error.getStatus?.() === 403);
  }
  for (const kind of ['PV', 'SC']) {
    await assert.rejects(storage.list({ clusterId, kind, sync: 'false' }, actor), error => error.getStatus?.() === 403);
  }
  console.log('PASS real scoped network/storage DB reads and live namespace UID; foreign scope and PV/SC denied; no login/session/write performed');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
