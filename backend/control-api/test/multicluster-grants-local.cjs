const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const load = name => require(`../dist/src/${name}`);
const { MultiClusterService } = load('multicluster/multicluster.service');
const { AuthorizationService } = load('common/authorization.service');
const { ClusterAccessService } = load('common/cluster-access.service');
const { NamespaceIdentityService } = load('common/namespace-identity.service');
const { ClustersService } = load('clusters/clusters.service');
const { K8sClientService } = load('clusters/k8s-client.service');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local DB required');
const db = new PrismaClient();
(async () => {
  const actor = await db.user.findFirst({ where: { email: 'loop-read', isActive: true }, select: { id: true, role: true } });
  assert.ok(actor);
  const authorization = new AuthorizationService(db);
  const access = new ClusterAccessService(db, authorization);
  const clients = new K8sClientService();
  const clusters = new ClustersService(db, clients);
  const identity = new NamespaceIdentityService(clusters, clients);
  const grants = await authorization.listEffectiveGrants(actor.id);
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].namespaces.map(row => row.namespaceName), ['ai']);
  const clusterId = grants[0].clusterId;
  const service = new MultiClusterService(clusters, db, access, authorization, identity);
  for (const [domain, model, kind] of [['workload', 'workloadRecord'], ['network', 'networkResource'], ['config', 'configResource', 'ConfigMap'], ['storage', 'storageResource', 'PVC']]) {
    const expected = await db[model].count({ where: { clusterId, namespace: 'ai', state: { not: 'deleted' }, ...(kind ? { kind } : {}) } });
    const result = await service.query({ clusterIds: [clusterId], domain, limitPerCluster: 1000 }, actor);
    assert.deepEqual(result.partialErrors, []);
    assert.equal(result.total, expected, `${domain} scoped count`);
    assert.ok(result.items.every(row => row.namespace === 'ai' && (!kind || row.kind === kind)));
  }
  for (const query of [{ namespace: 'kube-system' }, { domain: 'config', kind: 'Secret' }, { domain: 'storage', kind: 'PV' }, { clusterIds: ['unauthorized-cluster'] }]) {
    await assert.rejects(service.query({ clusterIds: [clusterId], ...query }, actor), error => error.getStatus?.() === 403);
  }
  console.log('PASS real DB/grants/live UID multi-cluster domain counts and denied foreign scope/Secret/PV; no mutations or sessions');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
