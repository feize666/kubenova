const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { MfaCredentialRepository } = require('../dist/src/auth/mfa-credential.repository');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local database required');
const schema = `mfa_reset_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^mfa_reset_[0-9a-f]{32}$/);
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
url.searchParams.set('connection_limit', '1');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const other = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let created = false;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const table of ['User', 'Session', 'MfaCredential', 'AuthorizationChange']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    async function fixture() {
      const actor = await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, role: 'admin' } });
      const target = await db.user.create({ data: { email: `${randomUUID()}@test.invalid`, mfaEnabled: true } });
      const sessionData = () => ({ refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000), refreshExpiresAt: new Date(Date.now() + 1200000) });
      const actorSession = await db.session.create({ data: { ...sessionData(), userId: actor.id, authzVersion: actor.authzVersion } });
      await db.session.create({ data: { ...sessionData(), userId: target.id, authzVersion: target.authzVersion } });
      await db.mfaCredential.create({ data: { userId: target.id, encryptedSecret: 'test-only', confirmedAt: new Date(), recoveryCodeHashes: ['test-only-hash'] } });
      const proof = { action: 'mfa-reset', expiresAt: Date.now() + 300000, actorUserId: actor.id, actorSessionId: actorSession.id,
        actorAuthzVersion: actor.authzVersion, targetUserId: target.id, targetAuthzVersion: target.authzVersion, targetMfaVersion: 1 };
      return { actor, target, actorSession, proof, repo: new MfaCredentialRepository(db, new ConfigService({ superadminUserId: actor.id })) };
    }
    const first = await fixture();
    assert.deepEqual(await first.repo.reset?.(first.proof), { userId: first.target.id, mfaEnabled: false });
    assert.equal(await db.mfaCredential.count({ where: { userId: first.target.id } }), 0);
    const target = await db.user.findUnique({ where: { id: first.target.id } });
    assert.equal(target.mfaEnabled, false);
    assert.equal(target.authzVersion, first.target.authzVersion + 1);
    assert.equal(await db.session.count({ where: { userId: target.id, revokedAt: null } }), 0);
    assert.equal(await db.session.count({ where: { userId: first.actor.id, revokedAt: null } }), 1);
    assert.equal(await db.authorizationChange.count({ where: { actorUserId: first.actor.id, affectedUserId: target.id, reason: 'mfa-reset' } }), 1);
    assert.equal(await first.repo.reset(first.proof), null, 'stale reset cannot be repeated');

    for (const failure of ['expired-proof', 'wrong-action', 'stale-target', 'new-credential', 'revoked-session', 'expired-session', 'disabled-actor', 'demoted-actor', 'missing-designation', 'unassured-mfa']) {
      const f = await fixture();
      if (failure === 'expired-proof') f.proof.expiresAt = Date.now() - 1;
      if (failure === 'wrong-action') f.proof.action = 'enrollment';
      if (failure === 'stale-target') f.proof.targetAuthzVersion++;
      if (failure === 'new-credential') await db.mfaCredential.update({ where: { userId: f.target.id }, data: { version: 2 } });
      if (failure === 'revoked-session') await db.session.update({ where: { id: f.actorSession.id }, data: { revokedAt: new Date() } });
      if (failure === 'expired-session') await db.session.update({ where: { id: f.actorSession.id }, data: { expiresAt: new Date(0) } });
      if (failure === 'disabled-actor') await db.user.update({ where: { id: f.actor.id }, data: { isActive: false } });
      if (failure === 'demoted-actor') await db.user.update({ where: { id: f.actor.id }, data: { role: 'user' } });
      if (failure === 'unassured-mfa') await db.user.update({ where: { id: f.actor.id }, data: { mfaEnabled: true } });
      if (failure === 'missing-designation') f.repo = new MfaCredentialRepository(db, new ConfigService());
      assert.equal(await f.repo.reset(f.proof), null, failure);
      assert.equal((await db.user.findUnique({ where: { id: f.target.id } })).mfaEnabled, true, failure);
      assert.equal(await db.authorizationChange.count({ where: { affectedUserId: f.target.id } }), 0, failure);
    }

    const rollback = await fixture();
    const failingDb = { $transaction: fn => db.$transaction(tx => fn(new Proxy(tx, {
      get: (object, property) => property === 'authorizationChange' ? { create: () => { throw new Error('audit unavailable'); } } : object[property],
    }))) };
    await assert.rejects(new MfaCredentialRepository(failingDb, new ConfigService({ superadminUserId: rollback.actor.id })).reset(rollback.proof), /audit unavailable/);
    assert.equal((await db.user.findUnique({ where: { id: rollback.target.id } })).mfaEnabled, true);
    assert.equal(await db.mfaCredential.count({ where: { userId: rollback.target.id } }), 1);
    assert.equal(await db.session.count({ where: { userId: rollback.target.id, revokedAt: null } }), 1);

    const self = await fixture();
    await db.user.update({ where: { id: self.actor.id }, data: { mfaEnabled: true } });
    await db.mfaCredential.create({ data: { userId: self.actor.id, encryptedSecret: 'test-only', confirmedAt: new Date(Date.now() - 1000), recoveryCodeHashes: [] } });
    await db.session.update({ where: { id: self.actorSession.id }, data: { mfaVersion: 1, mfaVerifiedAt: new Date() } });
    const selfProof = { ...self.proof, targetUserId: self.actor.id, targetAuthzVersion: self.actor.authzVersion };
    assert.deepEqual(await self.repo.reset(selfProof), { userId: self.actor.id, mfaEnabled: false });
    assert.equal(await db.session.count({ where: { userId: self.actor.id, revokedAt: null } }), 0);
    assert.equal((await db.user.findUnique({ where: { id: self.actor.id } })).isActive, true);

    const race = await fixture();
    const pids = new Set();
    let ready = 0;
    let release;
    const bothReady = new Promise(resolve => { release = resolve; });
    const timer = setTimeout(() => release(), 3000);
    try {
      const results = await Promise.all([db, other].map(client => {
        const synchronized = { $transaction: fn => client.$transaction(async tx => {
          pids.add((await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid);
          if (++ready === 2) release();
          await bothReady;
          assert.equal(ready, 2, 'both independent transactions must start');
          return fn(tx);
        }) };
        return new MfaCredentialRepository(synchronized, new ConfigService({ superadminUserId: race.actor.id })).reset(race.proof);
      }));
      assert.equal(pids.size, 2);
      assert.equal(results.filter(Boolean).length, 1, 'one competing reset wins');
      assert.equal(await db.authorizationChange.count({ where: { affectedUserId: race.target.id } }), 1);
    } finally { clearTimeout(timer); }
    console.log('PASS real PostgreSQL reset, self-reset, concurrent single winner, session revocation, invalid identity rejection and audit rollback');
  } finally {
    await db.$disconnect();
    await other.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    assert.equal((await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`).length, 0);
    await admin.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
