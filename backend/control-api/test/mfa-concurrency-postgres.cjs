const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { MfaCredentialRepository } = require('../dist/src/auth/mfa-credential.repository');
const { encryptMfaSecret, hashRecoveryCode, totpCode } = require('../dist/src/auth/mfa-totp');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Explicit loopback DATABASE_URL required');
const schema = `mfa_race_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^mfa_race_[0-9a-f]{32}$/);
const admin = new PrismaClient();
const testUrl = new URL(url);
testUrl.searchParams.set('schema', schema);
testUrl.searchParams.set('connection_limit', '1');
const clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url: testUrl.toString() } } }));
let created = false;

(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    const db = clients[0];
    await Promise.all(clients.map(client => client.$executeRawUnsafe("SET TIME ZONE 'UTC'")));
    for (const table of ['User', 'Session']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // Rehearse from the pre-MFA shape even after the local database is migrated.
    await db.$executeRawUnsafe(`ALTER TABLE "${schema}"."Session" DROP COLUMN IF EXISTS "mfaVersion", DROP COLUMN IF EXISTS "mfaVerifiedAt"`);
    const migration = readFileSync(join(__dirname, '../prisma/migrations/20260918040000_mfa_credentials/migration.sql'), 'utf8');
    await db.$executeRawUnsafe(`DO $mfa_race$ BEGIN\n${migration}\nEND $mfa_race$;`);
    const pids = await Promise.all(clients.map(client => client.$queryRaw`SELECT pg_backend_pid() AS pid`));
    assert.notEqual(pids[0][0].pid, pids[1][0].pid, 'must exercise independent PostgreSQL connections');
    const user = await db.user.create({ data: { email: 'mfa-race@test.invalid', mfaEnabled: true } });
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const key = 'isolated-race-test-key';
    const encrypted = encryptMfaSecret(secret, key);
    const recovery = 'isolated-recovery-code';
    const hash = hashRecoveryCode(recovery);
    await db.$executeRaw`INSERT INTO "MfaCredential" ("userId", "encryptedSecret", "confirmedAt", "updatedAt", "recoveryCodeHashes") VALUES (${user.id}, ${encrypted}, ${new Date()}, ${new Date()}, ARRAY[${hash}])`;
    const challenge = { userId: user.id, authzVersion: user.authzVersion, enrollmentVersion: 1 };
    const preparer = new MfaCredentialRepository(db, new ConfigService());
    assert.deepEqual(await preparer.prepareChallenge(user.id, user.authzVersion), challenge);
    assert.equal(await preparer.prepareChallenge(user.id, user.authzVersion + 1), null);
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal(await preparer.prepareChallenge(user.id, user.authzVersion), null);
    await db.user.update({ where: { id: user.id }, data: { isActive: true } });
    for (const method of ['totp', 'recovery']) {
      const code = method === 'totp' ? totpCode(secret) : recovery;
      let reads = 0;
      let release;
      const bothRead = new Promise(resolve => { release = resolve; });
      const timer = setTimeout(() => release(), 3000);
      let results;
      try {
        results = await Promise.all(clients.map(client => {
          const synchronized = {
            $queryRaw: async (...args) => {
              const rows = await client.$queryRaw(...args);
              if (++reads === 2) release();
              await bothRead;
              assert.equal(reads, 2, 'both readers must observe the credential before either writes');
              return rows;
            },
            $executeRaw: (...args) => client.$executeRaw(...args),
          };
          return new MfaCredentialRepository(synchronized, new ConfigService({ MFA_ENCRYPTION_KEY: key })).redeem(challenge, code, method);
        }));
      } finally { clearTimeout(timer); }
      assert.equal(results.filter(Boolean).length, 1, `${method}: exactly one concurrent redemption must succeed`);
      assert.equal(results.filter(value => value === null).length, 1, `${method}: replay must fail`);
    }
    const sessionCode = 'atomic-session-recovery';
    const sessionHash = hashRecoveryCode(sessionCode);
    await db.$executeRaw`UPDATE "MfaCredential" SET "recoveryCodeHashes" = ARRAY[${sessionHash}] WHERE "userId" = ${user.id}`;
    const input = { refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) };
    const failure = new Error('injected-session-write-failure');
    const failing = { $transaction: fn => db.$transaction(tx => fn(new Proxy(tx, {
      get: (target, name) => name === 'session' ? { create: async () => { throw failure; } } : typeof target[name] === 'function' ? target[name].bind(target) : target[name],
    }))) };
    await assert.rejects(new MfaCredentialRepository(failing, new ConfigService({ MFA_ENCRYPTION_KEY: key })).redeemAndCreateSession(challenge, sessionCode, 'recovery', input), error => error === failure);
    const [afterFailure] = await db.$queryRaw`SELECT "recoveryCodeHashes" FROM "MfaCredential" WHERE "userId" = ${user.id}`;
    assert.deepEqual(afterFailure.recoveryCodeHashes, [sessionHash], 'session failure must roll back recovery consumption');
    const sessions = await Promise.all(clients.map(client => new MfaCredentialRepository(client, new ConfigService({ MFA_ENCRYPTION_KEY: key })).redeemAndCreateSession(challenge, sessionCode, 'recovery', input)));
    assert.equal(sessions.filter(Boolean).length, 1);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
    const [assurance] = await db.$queryRaw`SELECT "mfaVersion", "mfaVerifiedAt" FROM "Session" WHERE "userId" = ${user.id}`;
    assert.equal(assurance.mfaVersion, 1);
    assert.ok(assurance.mfaVerifiedAt instanceof Date);
    const repository = new MfaCredentialRepository(db, new ConfigService({ MFA_ENCRYPTION_KEY: key }));
    const issued = sessions.find(Boolean).session;
    await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Shanghai'");
    const timing = await db.$queryRaw`SELECT s."mfaVerifiedAt", c."confirmedAt", s."expiresAt", NOW() AS now FROM "Session" s JOIN "MfaCredential" c ON c."userId" = s."userId" WHERE s.id = ${issued.id}`;
    assert.equal(await repository.hasSessionAssurance(issued.id, user.id, user.authzVersion), true, JSON.stringify(timing));
    const rotations = await Promise.all(clients.map(client => new MfaCredentialRepository(client, new ConfigService()).rotateSession({
      sessionId: issued.id, userId: user.id, authzVersion: user.authzVersion,
      currentRefreshTokenHash: input.refreshTokenHash, nextRefreshTokenHash: randomUUID(), expiresAt: new Date(input.refreshExpiresAt.getTime() + 60000),
    })));
    assert.equal(rotations.filter(Boolean).length, 1, 'only one MFA refresh can consume the old token');
    const rotated = rotations.find(Boolean);
    assert.ok(rotated.expiresAt <= input.refreshExpiresAt, 'refreshed access must not outlive absolute refresh expiry');
    const [copied] = await db.$queryRaw`SELECT "mfaVersion", "mfaVerifiedAt" FROM "Session" WHERE id = ${rotated.id}`;
    assert.deepEqual(copied, assurance, 'refresh must preserve original MFA assurance');
    await db.$executeRaw`UPDATE "MfaCredential" SET version = 2 WHERE "userId" = ${user.id}`;
    assert.equal(await repository.hasSessionAssurance(rotated.id, user.id, user.authzVersion), false, 'credential reset invalidates assurance');
    await db.$executeRaw`UPDATE "MfaCredential" SET version = 1 WHERE "userId" = ${user.id}`;
    assert.equal(await repository.hasSessionAssurance(rotated.id, user.id, user.authzVersion), true);
    await db.$executeRaw`UPDATE "Session" SET "mfaVerifiedAt" = NOW() + INTERVAL '1 hour' WHERE id = ${rotated.id}`;
    assert.equal(await repository.hasSessionAssurance(rotated.id, user.id, user.authzVersion), false, 'future assurance rejected');
    console.log('PASS atomic MFA session creation, concurrent single issuance and rollback on session write failure');
    console.log('PASS MFA TOTP and recovery concurrent redemption on distinct PostgreSQL connections');
  } finally {
    await Promise.all(clients.map(client => client.$disconnect()));
    if (created) {
      // Only this invocation's generated schema and test-owned tables are removed.
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      const remaining = await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`;
      assert.equal(remaining.length, 0);
      console.log('PASS isolated MFA test schema removed');
    }
    await admin.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
