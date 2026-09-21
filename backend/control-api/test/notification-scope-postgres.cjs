const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ObservabilityService } = require('../dist/src/monitoring/observability.service');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Explicit loopback DATABASE_URL required');
}
const db = new PrismaClient();
const rollback = new Error('EXPECTED_ROLLBACK');
const prefix = `notification-scope-${randomUUID()}`;
const admin = { role: 'admin' };
const input = { name: prefix, channel: 'webhook', endpoint: 'https://notify.invalid', bodyTemplate: '{}', enabled: false };

(async () => {
  try {
    await assert.rejects(db.$transaction(async tx => {
      const a = await tx.clusterRegistry.create({ data: { name: `${prefix}-a`, apiServer: 'https://invalid.test' } });
      const b = await tx.clusterRegistry.create({ data: { name: `${prefix}-b`, apiServer: 'https://invalid.test' } });
      const service = new ObservabilityService(tx);
      const global = await service.createNotificationTemplate(admin, input);
      const owned = await service.createNotificationTemplate(admin, { ...input, clusterId: a.id });
      const other = await service.createNotificationTemplate(admin, { ...input, clusterId: b.id });
      assert.deepEqual((await service.listNotificationTemplates(admin, a.id)).items.map(row => row.id), [owned.id]);
      assert.deepEqual((await service.listNotificationTemplates(admin, b.id)).items.map(row => row.id), [other.id]);
      const platform = (await service.listNotificationTemplates(admin)).items;
      assert.ok(platform.some(row => row.id === global.id));
      assert.ok(platform.every(row => row.clusterId === null));
      await assert.rejects(service.listNotificationTemplates({ role: 'user' }, a.id), error => error.getStatus() === 403);
      await assert.rejects(service.updateNotificationTemplate(admin, owned.id, { name: 'changed' }, b.id), error => error.getStatus() === 404);
      await assert.rejects(service.deleteNotificationTemplate(admin, owned.id), error => error.getStatus() === 404);
      await assert.rejects(service.testNotificationTemplate(admin, owned.id, b.id), error => error.getStatus() === 404);
      await assert.rejects(service.updateNotificationTemplate(admin, owned.id, { clusterId: b.id }, a.id), error => error.getStatus() === 400);
      assert.equal((await tx.monitoringNotificationTemplate.findUnique({ where: { id: owned.id } })).version, 1);
      const updated = await service.updateNotificationTemplate(admin, owned.id, { name: `${prefix}-updated` }, a.id);
      assert.equal(updated.version, 2);
      assert.equal(updated.clusterId, a.id);
      await tx.clusterRegistry.delete({ where: { id: a.id } });
      assert.equal(await tx.monitoringNotificationTemplate.count({ where: { id: owned.id } }), 0);
      assert.equal(await tx.monitoringNotificationTemplate.count({ where: { id: { in: [global.id, other.id] } } }), 2);
      throw rollback;
    }, { timeout: 15000 }), error => error === rollback);
    assert.equal(await db.monitoringNotificationTemplate.count({ where: { name: { startsWith: prefix } } }), 0);
    assert.equal(await db.clusterRegistry.count({ where: { name: { startsWith: prefix } } }), 0);
    console.log('PASS real PostgreSQL notification ownership, scope denial, versioning, cascade and fixture rollback');
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
