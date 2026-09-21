const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AlertReceiverService } = require('../dist/src/monitoring/alert-receiver.service');
const { AlertIngestionService } = require('../dist/src/monitoring/alert-ingestion.service');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Loopback DB required');
const db = new PrismaClient();
let cluster;
(async () => {
  try {
    cluster = await db.clusterRegistry.create({ data: { name: `ingest-${randomUUID()}`, apiServer: 'https://invalid.test', status: 'disabled' } });
    const { token } = await new AlertReceiverService(db).rotate({ role: 'admin' }, cluster.id);
    const channel = await db.monitoringNotificationTemplate.create({ data: { clusterId: cluster.id, name: 'test', channel: 'webhook', endpoint: 'https://invalid.test', bodyTemplate: '{}' } });
    const service = new AlertIngestionService(db);
    const event = { fingerprint: 'abc', status: 'firing', startsAt: '2026-09-18T00:00:00Z', labels: { alertname: 'test' }, annotations: {} };
    const input = { alerts: [event] };
    const failure = new Error('INJECTED_OUTBOX_FAILURE');
    const failingDb = new Proxy(db, { get: (target, key) => key === '$transaction'
      ? fn => db.$transaction(tx => fn(new Proxy(tx, { get: (inner, prop) => prop === 'notificationDelivery' ? { createMany: async () => { throw failure; } } : inner[prop] })))
      : target[key] });
    await assert.rejects(new AlertIngestionService(failingDb).ingest(cluster.id, `Bearer ${token}`, input), e => e === failure);
    assert.equal(await db.monitoringAlert.count({ where: { clusterId: cluster.id } }), 0);
    await assert.rejects(service.ingest(cluster.id, 'Bearer invalid', input), e => e.getStatus() === 401);
    await Promise.all([service.ingest(cluster.id, `Bearer ${token}`, input), service.ingest(cluster.id, `Bearer ${token}`, input)]);
    const row = await db.monitoringAlert.findFirst({ where: { clusterId: cluster.id } });
    assert.equal(await db.monitoringAlert.count({ where: { clusterId: cluster.id } }), 1);
    assert.equal(await db.notificationDelivery.count({ where: { alertId: row.id } }), 1);
    const recovery = { alerts: [{ ...event, status: 'resolved', endsAt: '2026-09-18T01:00:00Z' }] };
    await service.ingest(cluster.id, `Bearer ${token}`, recovery);
    await service.ingest(cluster.id, `Bearer ${token}`, recovery);
    await service.ingest(cluster.id, `Bearer ${token}`, input);
    assert.equal((await db.monitoringAlert.findUnique({ where: { id: row.id } })).status, 'resolved');
    assert.deepEqual((await db.notificationDelivery.findMany({ where: { alertId: row.id } })).map(d => d.event).sort(), ['firing', 'resolved']);
    await service.ingest(cluster.id, `Bearer ${token}`, { alerts: [{ ...recovery.alerts[0], fingerprint: 'resolvefirst' }] });
    const resolveFirst = await db.monitoringAlert.findFirst({ where: { clusterId: cluster.id, title: 'test', id: { not: row.id } } });
    assert.equal(await db.notificationDelivery.count({ where: { alertId: resolveFirst.id } }), 0);
    assert.equal((await db.notificationDelivery.findFirst({ where: { alertId: row.id } })).templateId, channel.id);
    console.log('PASS real DB concurrent dedup, firing/recovery outbox, stale replay and resolve-first suppression');
  } finally {
    if (cluster) {
      await db.monitoringAlert.deleteMany({ where: { clusterId: cluster.id } });
      await db.auditLog.deleteMany({ where: { clusterId: cluster.id } });
      await db.clusterRegistry.delete({ where: { id: cluster.id } });
    }
    await db.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
