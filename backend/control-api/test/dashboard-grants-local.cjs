const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { DashboardController } = require('../dist/src/dashboard/dashboard.controller');
const { DashboardService } = require('../dist/src/dashboard/dashboard.service');
const { AuthorizationService } = require('../dist/src/common/authorization.service');
const { ClusterAccessService } = require('../dist/src/common/cluster-access.service');
const { NamespaceIdentityService } = require('../dist/src/common/namespace-identity.service');
const { ClustersService } = require('../dist/src/clusters/clusters.service');
const { K8sClientService } = require('../dist/src/clusters/k8s-client.service');
const { LiveMetricsService } = require('../dist/src/metrics/live-metrics.service');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Explicit local database required');
const db = new PrismaClient();

(async () => {
  // Read-only service acceptance, not a fabricated login or HTTP-session test.
  const user = await db.user.findFirst({ where: { email: 'loop-read', isActive: true }, select: { id: true, role: true } });
  assert.ok(user, 'Existing loop-read account required');
  const client = new K8sClientService();
  const clusters = new ClustersService(db, client);
  const authorization = new AuthorizationService(db);
  const access = new ClusterAccessService(db, authorization);
  const identity = new NamespaceIdentityService(clusters, client);
  const service = new DashboardService(db, clusters, new LiveMetricsService(client));
  const controller = new DashboardController(service, access, authorization, identity);
  const grants = await authorization.listEffectiveGrants(user.id);
  assert.equal(grants.length, 1, 'Acceptance expects the existing single scoped grant');
  const grant = grants[0];
  assert.deepEqual(grant.namespaces.map(scope => scope.namespaceName), ['ai']);
  const liveUid = await identity.resolve(grant.clusterId, 'ai');
  assert.equal(liveUid, grant.namespaces[0].namespaceUid);
  const expected = await db.workloadRecord.count({ where: { clusterId: grant.clusterId, namespace: 'ai', state: 'active' } });
  assert.ok(expected > 0, 'Real scoped workload inventory required');
  for (const clusterId of [undefined, grant.clusterId]) {
    const stats = await controller.getStats({ user: { user } }, clusterId);
    assert.equal(stats.clusters.total, 1);
    assert.equal(stats.namespaces, 1);
    assert.equal(stats.workloads.total, expected);
    assert.equal(stats.metrics.alerts.freshness, 'unavailable');
    assert.equal(stats.metrics.healthScore.freshness, 'unavailable');
    assert.equal(stats.resourceUsage.cpu.value, null);
    assert.equal(stats.resourceUsage.liveSnapshot, undefined);
    assert.deepEqual(stats.recentOperations, []);
    assert.deepEqual(stats.recentEvents, []);
    assert.ok(stats.serviceImpact.impactedServices.every(item => item.clusterId === grant.clusterId && item.namespace === 'ai'));
  }
  await assert.rejects(controller.getStats({ user: { user } }, 'ungranted-cluster'), error => error.getStatus?.() === 403);
  console.log('PASS real loop-read grant + live namespace UID + PostgreSQL scoped dashboard; no sessions or records created');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
