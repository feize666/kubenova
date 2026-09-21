const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { AlertReceiverService } = require('../dist/src/monitoring/alert-receiver.service');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Explicit loopback DATABASE_URL required');
const db = new PrismaClient();
const rollback = new Error('EXPECTED_ROLLBACK');
const prefix = `receiver-${randomUUID()}`;

(async () => {
  try {
    await assert.rejects(db.$transaction(async tx => {
      const a = await tx.clusterRegistry.create({ data: { name: `${prefix}-a`, apiServer: 'https://invalid.test' } });
      const b = await tx.clusterRegistry.create({ data: { name: `${prefix}-b`, apiServer: 'https://invalid.test' } });
      const bound = new Proxy(tx, { get: (target, key) => key === '$transaction' ? async fn => fn(tx) : target[key] });
      const service = new AlertReceiverService(bound);
      const actor = { role: 'admin' };
      await assert.rejects(service.rotate({ role: 'user' }, a.id), e => e.getStatus() === 403);
      assert.equal(await tx.alertReceiverCredential.count({ where: { clusterId: a.id } }), 0);
      const first = await service.rotate(actor, a.id);
      const stored = await tx.alertReceiverCredential.findUnique({ where: { clusterId: a.id } });
      assert.equal(stored.tokenHash.length, 64);
      assert.ok(!JSON.stringify(stored).includes(first.token));
      assert.equal(await service.authenticate(a.id, `Bearer ${first.token}`), a.id);
      await assert.rejects(service.authenticate(b.id, `Bearer ${first.token}`), e => e.getStatus() === 401);
      const next = await service.rotate(actor, a.id);
      await assert.rejects(service.authenticate(a.id, `Bearer ${first.token}`), e => e.getStatus() === 401);
      assert.equal(await service.authenticate(a.id, `Bearer ${next.token}`), a.id);
      assert.equal(await tx.alertReceiverCredential.count({ where: { clusterId: a.id } }), 1);
      await service.disable(actor, a.id);
      await assert.rejects(service.authenticate(a.id, `Bearer ${next.token}`), e => e.getStatus() === 401);
      const reenabled = await service.rotate(actor, a.id);
      assert.deepEqual((await tx.auditLog.findMany({ where: { resourceType: 'alert-receiver', resourceId: a.id }, orderBy: { createdAt: 'asc' } })).map(row => row.action).sort(), ['disable', 'rotate', 'rotate', 'rotate']);
      await tx.clusterRegistry.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
      await assert.rejects(service.authenticate(a.id, `Bearer ${reenabled.token}`), e => e.getStatus() === 401);
      await tx.clusterRegistry.delete({ where: { id: a.id } });
      assert.equal(await tx.alertReceiverCredential.count({ where: { clusterId: a.id } }), 0);
      throw rollback;
    }), e => e === rollback);
    assert.equal(await db.clusterRegistry.count({ where: { name: { startsWith: prefix } } }), 0);
    const cluster = await db.clusterRegistry.create({ data: { name: `${prefix}-rollback`, apiServer: 'https://invalid.test' } });
    try {
      const failure = new Error('INJECTED_AUDIT_FAILURE');
      const failingDb = new Proxy(db, { get: (target, key) => key === '$transaction'
        ? fn => db.$transaction(tx => fn(new Proxy(tx, { get: (inner, prop) => prop === 'auditLog' ? { create: async () => { throw failure; } } : inner[prop] })))
        : target[key] });
      const failing = new AlertReceiverService(failingDb);
      await assert.rejects(failing.rotate({ role: 'admin' }, cluster.id), e => e === failure);
      assert.equal(await db.alertReceiverCredential.count({ where: { clusterId: cluster.id } }), 0);
      const working = new AlertReceiverService(db);
      const original = await working.rotate({ role: 'admin' }, cluster.id);
      await assert.rejects(failing.rotate({ role: 'admin' }, cluster.id), e => e === failure);
      assert.equal(await working.authenticate(cluster.id, `Bearer ${original.token}`), cluster.id);
      await assert.rejects(failing.disable({ role: 'admin' }, cluster.id), e => e === failure);
      assert.equal(await working.authenticate(cluster.id, `Bearer ${original.token}`), cluster.id);
    } finally {
      await db.auditLog.deleteMany({ where: { resourceType: 'alert-receiver', resourceId: cluster.id } });
      await db.clusterRegistry.delete({ where: { id: cluster.id } });
    }
    console.log('PASS audit failure rolls back creation, rotation and disable without invalidating original token');
    console.log('PASS real PostgreSQL receiver rotation, disable, isolation, deleted-cluster denial, cascade and rollback');
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
