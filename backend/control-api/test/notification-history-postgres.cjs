const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { NotificationHistoryService } = require('../dist/src/monitoring/notification-history.service');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Loopback DB required');
const db = new PrismaClient();
const ids = [];
(async () => {
  try {
    const service = new NotificationHistoryService(db);
    const admin = { role: 'admin' };
    for (let i = 0; i < 2; i++) {
      const cluster = await db.clusterRegistry.create({ data: { name: `history-${randomUUID()}`, apiServer: 'https://invalid.test' } });
      ids.push(cluster.id);
      const alert = await db.monitoringAlert.create({ data: { clusterId: cluster.id, severity: 'warning', title: `Alert-${i}`, message: 'private-message' } });
      for (let n = 0; n < 3; n++) await db.notificationDelivery.create({ data: { alertId: alert.id, templateId: `channel-${n}`, event: n === 2 ? 'resolved' : 'firing', status: n === 2 ? 'failed' : 'sent', expiresAt: new Date(), createdAt: new Date('2026-01-01'), lastError: 'secret-endpoint-token' } });
    }
    const first = await service.list(admin, ids[0], { take: '2' });
    const next = await service.list(admin, ids[0], { take: '2', cursor: first.nextCursor });
    assert.equal(first.items.length, 2);
    assert.equal(next.items.length, 1);
    assert.equal(next.nextCursor, null);
    assert.equal(new Set([...first.items, ...next.items].map(row => row.id)).size, 3);
    assert.ok([...first.items, ...next.items].every(row => row.alertTitle === 'Alert-0'));
    assert.ok(!JSON.stringify(first).includes('secret-endpoint-token'));
    assert.ok(!JSON.stringify(first).includes('private-message'));
    assert.equal((await service.list(admin, ids[0], { status: 'failed', event: 'resolved' })).items.length, 1);
    await assert.rejects(service.list(admin, ids[1], { cursor: first.nextCursor }), error => error.getStatus() === 400);
    await assert.rejects(service.list({ role: 'user' }, ids[0]), error => error.getStatus() === 403);
    for (const query of [{ take: '101' }, { take: '0' }, { take: '1.5' }, { status: 'oops' }, { event: 'oops' }, { cursor: '' }]) await assert.rejects(service.list(admin, ids[0], query), error => error.getStatus() === 400);
    await db.clusterRegistry.update({ where: { id: ids[0] }, data: { deletedAt: new Date() } });
    await assert.rejects(service.list(admin, ids[0]), error => error.getStatus() === 404);
    console.log('PASS delivery history PostgreSQL scope, same-time pagination, filtering, role checks and redaction');
  } finally {
    await db.monitoringAlert.deleteMany({ where: { clusterId: { in: ids } } });
    await db.clusterRegistry.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
