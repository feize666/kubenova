const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const load = name => require(`../dist/src/${name}`);
const { TopologySummaryService } = load('topology-summary/topology-summary.service');
const { TopologyGraphService } = load('topology-graph/topology-graph.service');
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
  assert.ok(actor);
  const authorization = new AuthorizationService(db);
  const access = new ClusterAccessService(db, authorization);
  const clients = new K8sClientService();
  const identity = new NamespaceIdentityService(new ClustersService(db, clients), clients);
  const grants = await authorization.listEffectiveGrants(actor.id);
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].namespaces.map(row => row.namespaceName), ['ai']);
  const clusterId = grants[0].clusterId;
  const health = { assertClusterOnlineForRead: async () => {}, listReadableClusterIdsForResourceRead: async () => [clusterId], getLatestSnapshot: async () => null };
  const summary = new TopologySummaryService(db, health, access, authorization, identity);
  const result = await summary.listNamespaceSummaries({ clusterId }, actor);
  assert.deepEqual(result.items.map(row => row.namespace), ['ai'], 'summary must only contain granted namespace');
  const cache = new Map();
  const graph = new TopologyGraphService(db, health, { get: async key => cache.get(key), set: async (key, value) => cache.set(key, value) }, access, authorization, identity);
  for (const method of ['getGraph', 'getGraphV2']) {
    for (const namespace of [undefined, 'ai']) {
      const data = await graph[method]({ clusterId, namespace }, actor);
      assert.ok(data.resources.length > 0);
      assert.ok(data.resources.every(row => row.namespace === 'ai' && row.kind !== 'Secret'), 'no foreign namespace or Secret resources');
    }
    await assert.rejects(graph[method]({ clusterId, namespace: 'kube-system' }, actor), error => error.getStatus?.() === 403);
  }
  console.log('PASS real grant/DB/live UID topology summary and graph scopes; no sessions, writes or resource values printed');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
