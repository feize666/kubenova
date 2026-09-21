const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { NotificationSchedulerService } = require('../dist/src/monitoring/notification-scheduler.service');
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Loopback DB required');
const db = new PrismaClient();
const ids = [];
(async () => {
  try {
    const prefix = `000-scheduler-${randomUUID()}`;
    for (let i = 0; i < 24; i++) {
      const id = `${prefix}-${String(i).padStart(2, '0')}`;
      await db.clusterRegistry.create({ data: { id, name: id, apiServer: 'https://invalid.test' } });
      ids.push(id);
      const alert = await db.monitoringAlert.create({ data: { clusterId: id, severity: 'warning', title: 'Scheduler test', message: 'Test' } });
      await db.notificationDelivery.create({ data: {
        alertId: alert.id, templateId: 'test-no-transport', event: 'firing',
        expiresAt: new Date(Date.now() + 60000),
        status: i === 23 ? 'sending' : 'pending',
        leaseUntil: i === 23 ? new Date(0) : null,
        nextAttemptAt: i === 22 ? new Date(Date.now() + 60000) : new Date(0),
      } });
    }
    const calls = [];
    // Only selection uses the real database; never dispatch user notifications.
    const scheduler = new NotificationSchedulerService(db, { runOnce: async id => { calls.push(id); return true; } });
    await scheduler.runCycle();
    assert.equal(calls.length, 20);
    assert.equal(new Set(calls).size, 20);
    assert.deepEqual(calls, ids.slice(0, 20));
    calls.length = 0;
    await scheduler.runCycle();
    assert.ok(calls.length <= 20);
    assert.deepEqual(calls.slice(0, 3), [ids[20], ids[21], ids[23]]);
    assert.ok(!calls.includes(ids[22]), 'future delivery must not be selected');
    await scheduler.onModuleDestroy();
    console.log('PASS PostgreSQL scheduler limit, distinct clusters, cursor fairness, future exclusion and expired lease selection');
  } finally {
    await db.monitoringAlert.deleteMany({ where: { clusterId: { in: ids } } });
    await db.clusterRegistry.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
