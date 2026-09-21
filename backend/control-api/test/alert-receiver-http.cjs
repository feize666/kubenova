const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AlertReceiverService } = require('../dist/src/monitoring/alert-receiver.service');

const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) throw new Error('Explicit loopback DATABASE_URL required');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3000';
let cluster;
let session;

(async () => {
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }) });
    assert.equal(login.status, 200, 'local admin login failed');
    session = (await login.json()).data;
    assert.ok(session.accessToken);
    cluster = await db.clusterRegistry.create({ data: { name: `receiver-http-${randomUUID()}`, apiServer: 'https://invalid.test', status: 'disabled' } });
    const route = `${base}/api/monitoring/clusters/${cluster.id}/receiver`;
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const unconfigured = await fetch(route, { headers });
    assert.equal(unconfigured.status, 200);
    assert.equal(unconfigured.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await unconfigured.json()).data, { clusterId: cluster.id, configured: false, enabled: false, updatedAt: null });
    assert.equal((await fetch(route)).status, 401);
    assert.equal((await fetch(`${route}/rotate`, { method: 'POST' })).status, 401);
    const firstResponse = await fetch(`${route}/rotate`, { method: 'POST', headers });
    assert.equal(firstResponse.status, 201);
    assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
    const first = (await firstResponse.json()).data;
    const configured = (await (await fetch(route, { headers })).json()).data;
    assert.equal(configured.configured, true);
    assert.equal(configured.enabled, true);
    assert.deepEqual(Object.keys(configured).sort(), ['clusterId', 'configured', 'enabled', 'updatedAt']);
    const verify = new AlertReceiverService(db);
    assert.equal(await verify.authenticate(cluster.id, `Bearer ${first.token}`), cluster.id);
    const nextResponse = await fetch(`${route}/rotate`, { method: 'POST', headers });
    assert.equal(nextResponse.status, 201);
    const next = (await nextResponse.json()).data;
    assert.notEqual(first.token, next.token);
    await assert.rejects(verify.authenticate(cluster.id, `Bearer ${first.token}`), e => e.getStatus() === 401);
    assert.equal(await verify.authenticate(cluster.id, `Bearer ${next.token}`), cluster.id);
    await db.monitoringNotificationTemplate.create({ data: { clusterId: cluster.id, name: 'HTTP test', channel: 'webhook', endpoint: 'https://invalid.test', bodyTemplate: '{}' } });
    const event = { fingerprint: 'http-test', status: 'firing', startsAt: '2026-09-18T00:00:00Z', labels: { alertname: 'HTTP test' }, annotations: {} };
    const send = (token, alerts) => fetch(`${route}/alerts`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ alerts }) });
    assert.equal((await send(first.token, [event])).status, 401);
    assert.equal((await send(next.token, [{ ...event, status: 'invalid' }])).status, 400);
    for (const expected of [1, 0]) {
      const response = await send(next.token, [event]);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.changed, expected);
    }
    const recovery = await send(next.token, [{ ...event, status: 'resolved', endsAt: '2026-09-18T01:00:00Z' }]);
    assert.equal(recovery.status, 200);
    assert.equal((await recovery.json()).data.changed, 1);
    assert.equal((await send(next.token, [event])).status, 200);
    const alert = await db.monitoringAlert.findFirst({ where: { clusterId: cluster.id } });
    assert.equal(alert.status, 'resolved');
    const deliveries = await db.notificationDelivery.findMany({ where: { alertId: alert.id } });
    assert.deepEqual(deliveries.map(row => row.event).sort(), ['firing', 'resolved']);
    assert.ok(deliveries.every(row => row.status === 'pending'));
    const historyRoute = `${base}/api/monitoring/clusters/${cluster.id}/deliveries`;
    assert.equal((await fetch(historyRoute)).status, 401);
    assert.equal((await fetch(`${historyRoute}?take=101`, { headers })).status, 400);
    const historyResponse = await fetch(`${historyRoute}?take=1`, { headers });
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json()).data;
    assert.equal(history.items.length, 1);
    assert.ok(history.nextCursor);
    const secondPage = (await (await fetch(`${historyRoute}?take=1&cursor=${history.nextCursor}`, { headers })).json()).data;
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0].id, history.items[0].id);
    assert.equal(secondPage.nextCursor, null);
    assert.ok(!JSON.stringify(history).includes('https://invalid.test'));
    assert.equal((await fetch(route, { method: 'DELETE', headers })).status, 200);
    assert.equal((await (await fetch(route, { headers })).json()).data.enabled, false);
    await assert.rejects(verify.authenticate(cluster.id, `Bearer ${next.token}`), e => e.getStatus() === 401);
    assert.equal((await send(next.token, [event])).status, 401);
    const audits = await db.auditLog.findMany({ where: { resourceType: 'alert-receiver', resourceId: cluster.id } });
    assert.deepEqual(audits.map(row => row.action).sort(), ['disable', 'rotate', 'rotate']);
    assert.ok(audits.every(row => row.actorUserId === session.user.id));
    assert.ok(!JSON.stringify(audits).includes(first.token));
    assert.ok(!JSON.stringify(audits).includes(next.token));
    console.log('PASS port-3000 receiver lifecycle, authenticated ingest, dedup, recovery, pending outbox and actor audit');
  } finally {
    if (cluster) {
      await db.monitoringAlert.deleteMany({ where: { clusterId: cluster.id } });
      await db.auditLog.deleteMany({ where: { resourceType: 'alert-receiver', resourceId: cluster.id } });
      await db.clusterRegistry.delete({ where: { id: cluster.id } });
    }
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
