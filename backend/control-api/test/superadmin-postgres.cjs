const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { UsersService } = require('../dist/src/users/users.service');

assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env.DATABASE_URL || 'postgresql://invalid').hostname), 'Explicit local database required');
const db = new PrismaClient();
const suffix = `${randomUUID()}@superadmin-test.invalid`;
const rollback = new Error('Expected rollback');
(async () => {
  await assert.rejects(db.$transaction(async tx => {
    const owner = await tx.user.create({ data: { email: `owner-${suffix}`, role: 'admin' } });
    const admin = await tx.user.create({ data: { email: `admin-${suffix}`, role: 'admin' } });
    const service = new UsersService(tx, undefined, new ConfigService({ superadminUserId: owner.id }));
    const actor = { id: admin.id, role: 'platform-admin', username: 'admin' };
    for (const action of [
      () => service.updateUser(actor, owner.id, { password: 'test-only-password' }),
      () => service.updateUser(actor, owner.id, { username: 'replacement' }),
      () => service.deleteUser(actor, owner.id),
      () => service.setState(actor, owner.id, false),
      () => service.setUserState(actor, owner.id, 'disabled'),
      () => service.bindExternalIdentity(actor, owner.id, { issuer: 'https://id.example.invalid', subject: 'foreign' }),
      () => service.unbindExternalIdentity(actor, owner.id, 'foreign'),
      () => service.setMfaEnabled(actor, owner.id, false),
    ]) await assert.rejects(action(), error => error.getStatus?.() === 403);
    assert.deepEqual(await tx.user.findUnique({ where: { id: owner.id } }), owner);
    assert.equal(await tx.externalIdentity.count({ where: { userId: owner.id } }), 0);

    const designatedActor = { id: owner.id, role: 'platform-admin' };
    for (const action of [
      () => service.deleteUser(designatedActor, owner.id),
      () => service.setState(designatedActor, owner.id, false),
      () => service.setUserState(designatedActor, owner.id, 'disabled'),
    ]) await assert.rejects(action(), error => error.getStatus?.() === 403 || error.getStatus?.() === 400);
    assert.deepEqual(await tx.user.findUnique({ where: { id: owner.id } }), owner);
    await assert.rejects(service.setMfaEnabled(designatedActor, admin.id, false), error => error.getStatus?.() === 503);
    await tx.user.update({ where: { id: owner.id }, data: { isActive: false } });
    await assert.rejects(service.setMfaEnabled(designatedActor, admin.id, false), error => error.getStatus?.() === 403);
    await tx.user.update({ where: { id: owner.id }, data: { isActive: true, role: 'user' } });
    await assert.rejects(service.setMfaEnabled(designatedActor, admin.id, false), error => error.getStatus?.() === 403);
    assert.equal((await tx.user.findUnique({ where: { id: admin.id } })).mfaEnabled, false);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email: { endsWith: suffix } } }), 0);
  console.log('PASS real database explicit superadmin identity, protected-account mutations, fresh disabled/demoted denial; all fixtures rolled back');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
