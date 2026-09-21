const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local database required');
const db = new PrismaClient();

(async () => {
  const session = await db.session.findFirst({
    where: { user: { email: 'loop-read', isActive: true }, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  assert.ok(session, 'Existing loop-read login required; no sessions are created');
  const get = async (path, expected = 200) => {
    const response = await fetch(`http://127.0.0.1:3000${path}`, {
      headers: { authorization: `Bearer ${session.id}` }, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, expected, path);
    const body = await response.json();
    return body.data ?? body;
  };
  const clusters = await get('/api/clusters');
  assert.deepEqual(clusters.items.map(row => row.name), ['vke-test']);
  const clusterId = clusters.items[0].id;
  const summary = await get(`/api/topology/summary/namespaces?clusterId=${clusterId}`);
  assert.deepEqual(summary.items.map(row => row.namespace), ['ai'], 'summary must not reveal unauthorized namespaces');
  for (const version of ['graph', 'graph/v2']) {
    for (const namespace of ['', '&namespace=ai']) {
      const graph = await get(`/api/topology/${version}?clusterId=${clusterId}${namespace}`);
      assert.ok(graph.resources.length > 0, 'authorized inventory must remain visible');
      assert.ok(graph.resources.every(row => row.namespace === 'ai' && row.kind !== 'Secret'), 'graph must preserve namespace and Secret boundaries');
    }
    await get(`/api/topology/${version}?clusterId=${clusterId}&namespace=kube-system`, 403);
  }
  console.log('PASS existing loop-read session: scoped topology summary/v1/v2 and forbidden namespace; no credentials or resource data printed');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
