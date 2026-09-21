const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Explicit local database required');
const db = new PrismaClient();

(async () => {
  const session = await db.session.findFirst({
    where: { user: { email: 'loop-read', isActive: true }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  assert.ok(session, 'loop-read must already be logged in; this test never creates sessions');
  const request = async path => {
    const response = await fetch(`http://127.0.0.1:3000${path}`, {
      headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `${path} status`);
    const body = await response.json();
    return body.data ?? body;
  };
  const clusters = await request('/api/clusters');
  assert.deepEqual(clusters.items.map(item => item.name), ['vke-test'], 'exact authorized cluster visibility');
  const cluster = clusters.items[0];
  const health = await request('/api/cluster-health');
  assert.deepEqual(health.items.map(item => item.clusterId), [cluster.id], 'health visibility must match discoverable grants');
  // Authorization must reject these requests before issuing a stream or opening a shell.
  for (const target of [
    { path: '/api/logs?' + new URLSearchParams({ cluster: cluster.id, ns: 'ai', pod: 'authorization-denial-test' }) },
    { path: '/api/logs/stream', body: { clusterId: cluster.id, namespace: 'ai', pod: 'authorization-denial-test' } },
    { path: '/api/runtime/sessions', body: { type: 'logs', clusterId: cluster.id, namespace: 'ai', pod: 'authorization-denial-test' } },
    { path: '/api/runtime/sessions', body: { type: 'terminal', clusterId: cluster.id, namespace: 'kube-system', pod: 'authorization-denial-test' } },
  ]) {
    const response = await fetch(`http://127.0.0.1:3000${target.path}`, {
      method: target.body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${session.id}`, 'content-type': 'application/json' },
      body: target.body ? JSON.stringify(target.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 403, `${target.path} capability/scope denial`);
  }
  const detail = await request(`/api/clusters/${encodeURIComponent(cluster.id)}`);
  assert.equal(detail.id, cluster.id);
  assert.deepEqual(detail.nodeSummary.items, [], 'namespace grant must not expose nodes');
  const namespaces = await request(`/api/namespaces?clusterId=${encodeURIComponent(cluster.id)}`);
  assert.deepEqual(namespaces.items.map(item => item.namespace), ['ai']);
  const configs = await request('/api/configs?pageSize=200');
  const configCount = await db.configResource.count({ where: { clusterId: cluster.id, namespace: 'ai', kind: 'ConfigMap', state: { not: 'deleted' } } });
  assert.ok(configCount > 0, 'authorized ConfigMap inventory required');
  assert.equal(configs.total, configCount, 'config count must exclude Secrets and foreign namespaces');
  assert.ok(configs.items.every(item => item.clusterId === cluster.id && item.namespace === 'ai' && item.kind === 'ConfigMap'));
  await request(`/api/configs/${encodeURIComponent(configs.items[0].id)}/revisions`);
  const secret = await db.configResource.findFirst({ where: { clusterId: cluster.id, kind: 'Secret', state: { not: 'deleted' } }, select: { id: true } });
  assert.ok(secret, 'real Secret required for denial acceptance');
  for (const suffix of ['', '/revisions', '/diff?from=1&to=2']) {
    const response = await fetch(`http://127.0.0.1:3000/api/configs/${encodeURIComponent(secret.id)}${suffix}`, {
      headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 403, `Secret ${suffix || 'detail'} must be denied`);
  }
  const workloads = await request(`/api/workloads?clusterId=${encodeURIComponent(cluster.id)}&pageSize=100`);
  assert.ok(workloads.items.length, 'expected real authorized workloads for acceptance');
  assert.ok(workloads.items.every(item => item.clusterId === cluster.id && item.namespace === 'ai'), 'workload list must not leak other namespaces');
  const permitted = await request(`/api/workloads/${encodeURIComponent(workloads.items[0].id)}`);
  assert.equal(permitted.namespace, 'ai');
  assert.equal(permitted.clusterId, cluster.id);
  const drawer = await request(`/api/resources/${encodeURIComponent(workloads.items[0].kind)}/${encodeURIComponent(workloads.items[0].id)}/detail`);
  assert.ok(drawer, 'actual resource drawer must be accessible for an authorized workload');
  const dynamicQuery = new URLSearchParams({ clusterId: cluster.id, namespace: 'ai', group: 'apps', version: 'v1', resource: 'replicasets', name: workloads.items.find(item => item.kind === 'ReplicaSet')?.name ?? '' });
  assert.ok(dynamicQuery.get('name'), 'need an authorized ReplicaSet for dynamic detail acceptance');
  const dynamic = await request(`/api/resources/dynamic/detail?${dynamicQuery}`);
  assert.equal(dynamic.namespace, 'ai');
  assert.equal(dynamic.kind, 'ReplicaSet');
  for (const resource of ['nodes', 'secrets']) {
    const query = new URLSearchParams({ clusterId: cluster.id, namespace: 'ai', group: '', version: 'v1', resource, name: 'unauthorized-test-target' });
    const response = await fetch(`http://127.0.0.1:3000/api/resources/dynamic/detail?${query}`, {
      headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 403, `${resource} dynamic detail must be denied before resource read`);
  }
  const yamlQuery = new URLSearchParams({ clusterId: cluster.id, namespace: 'ai', kind: workloads.items[0].kind, name: workloads.items[0].name });
  const yaml = await request(`/api/resources/yaml?${yamlQuery}`);
  assert.equal(typeof yaml.yaml, 'string');
  assert.equal(yaml.namespace, 'ai');
  for (const kind of ['Secret', 'Node']) {
    const query = new URLSearchParams({ clusterId: cluster.id, namespace: 'ai', kind, name: 'unauthorized-test-target' });
    const response = await fetch(`http://127.0.0.1:3000/api/resources/yaml?${query}`, {
      headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 403, `${kind} YAML must be denied before live resource fetch`);
  }
  const all = await request('/api/workloads?pageSize=100');
  assert.ok(all.items.every(item => item.clusterId === cluster.id && item.namespace === 'ai'), 'unfiltered list must preserve grant scope');
  const legacy = await request('/api/v1/workloads/deployments?pageSize=100');
  assert.ok(legacy.items.every(item => item.clusterId === cluster.id && item.namespace === 'ai'), 'legacy kind route must preserve grant scope');
  const forbidden = await db.workloadRecord.findFirst({ where: { clusterId: cluster.id, namespace: { not: 'ai' }, state: { not: 'deleted' } }, select: { id: true } });
  assert.ok(forbidden, 'need a real unauthorized workload to test direct-ID denial');
  const denied = await fetch(`http://127.0.0.1:3000/api/workloads/${encodeURIComponent(forbidden.id)}`, {
    headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
  });
  assert.ok([403, 404].includes(denied.status), 'direct-ID access outside grant must be denied');
  const foreignNamespace = await request(`/api/workloads?clusterId=${encodeURIComponent(cluster.id)}&namespace=kube-system`);
  assert.equal(foreignNamespace.total, 0);
  assert.deepEqual(foreignNamespace.items, []);
  const foreignCluster = await db.clusterRegistry.findFirst({ where: { id: { not: cluster.id }, deletedAt: null, status: { not: 'deleted' } }, select: { id: true } });
  assert.ok(foreignCluster, 'need a second cluster for isolation acceptance');
  const foreign = await request(`/api/workloads?clusterId=${encodeURIComponent(foreignCluster.id)}`);
  assert.equal(foreign.total, 0);
  assert.deepEqual(foreign.items, []);
  console.log('PASS loop-read: cluster discovery, ai namespace, scoped workloads/ConfigMaps and details; foreign scope, Secret versions, logs and out-of-scope terminal denied');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
