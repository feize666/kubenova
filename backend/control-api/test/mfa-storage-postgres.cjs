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
const db = new PrismaClient();
const rollback = new Error('EXPECTED_ROLLBACK');
const email = `mfa-storage-${randomUUID()}@test.invalid`;

(async () => {
  await assert.rejects(db.$transaction(async tx => {
    if (process.env.MFA_SCHEMA_REHEARSAL === '1') {
      const migration = readFileSync(join(__dirname, '../prisma/migrations/20260918040000_mfa_credentials/migration.sql'), 'utf8');
      // Rehearse trusted repository DDL inside the same rollback transaction.
      await tx.$executeRawUnsafe(`DO $mfa_rehearsal$ BEGIN\n${migration}\nEND $mfa_rehearsal$;`);
    }
    const user = await tx.user.create({ data: { email } });
    await tx.$executeRaw`INSERT INTO "MfaCredential" ("userId", "encryptedSecret", "confirmedAt", "updatedAt") VALUES (${user.id}, 'encrypted-test-only', NOW(), NOW())`;
    const [credential] = await tx.$queryRaw`SELECT * FROM "MfaCredential" WHERE "userId" = ${user.id}`;
    assert.equal(credential.version, 1);
    assert.equal(credential.lastTotpCounter, null);
    assert.deepEqual(credential.recoveryCodeHashes, []);
    const consume = () => tx.$executeRaw`UPDATE "MfaCredential" SET "lastTotpCounter" = 123 WHERE "userId" = ${user.id} AND ("lastTotpCounter" IS NULL OR "lastTotpCounter" < 123)`;
    assert.equal(await consume(), 1);
    assert.equal(await consume(), 0);
    const session = await tx.session.create({ data: { userId: user.id, refreshTokenHash: 'test-only', expiresAt: new Date(), refreshExpiresAt: new Date() } });
    const [assurance] = await tx.$queryRaw`SELECT "mfaVersion", "mfaVerifiedAt" FROM "Session" WHERE id = ${session.id}`;
    assert.deepEqual(assurance, { mfaVersion: null, mfaVerifiedAt: null });
    const rejectsConstraint = async operation => {
      await tx.$executeRawUnsafe('SAVEPOINT mfa_constraint');
      try {
        await assert.rejects(operation, error => error.code === 'P2010' && error.meta?.code === '23514');
      } finally {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mfa_constraint');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT mfa_constraint');
      }
    };
    await rejectsConstraint(() => tx.$executeRaw`UPDATE "Session" SET "mfaVersion" = 1 WHERE id = ${session.id}`);
    await rejectsConstraint(() => tx.$executeRaw`UPDATE "Session" SET "mfaVerifiedAt" = NOW() WHERE id = ${session.id}`);
    await rejectsConstraint(() => tx.$executeRaw`UPDATE "MfaCredential" SET "version" = 0 WHERE "userId" = ${user.id}`);
    await rejectsConstraint(() => tx.$executeRaw`UPDATE "MfaCredential" SET "lastTotpCounter" = -1 WHERE "userId" = ${user.id}`);
    await tx.$executeRaw`UPDATE "Session" SET "mfaVersion" = 1, "mfaVerifiedAt" = NOW() WHERE id = ${session.id}`;
    const [verified] = await tx.$queryRaw`SELECT "mfaVersion", "mfaVerifiedAt" FROM "Session" WHERE id = ${session.id}`;
    assert.equal(verified.mfaVersion, 1);
    assert.ok(verified.mfaVerifiedAt instanceof Date);
    const key = 'database-rehearsal-only';
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const encrypted = encryptMfaSecret(secret, key);
    const recoveryHash = hashRecoveryCode('test-recovery-code');
    await tx.$executeRaw`UPDATE "MfaCredential" SET "encryptedSecret" = ${encrypted}, "lastTotpCounter" = NULL, "recoveryCodeHashes" = ARRAY[${recoveryHash}] WHERE "userId" = ${user.id}`;
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    const repository = new MfaCredentialRepository(tx, new ConfigService({ MFA_ENCRYPTION_KEY: key }));
    const challenge = { userId: user.id, authzVersion: user.authzVersion, enrollmentVersion: 1 };
    const otp = totpCode(secret);
    assert.equal((await repository.redeem(challenge, otp, 'totp')).mfaVersion, 1);
    assert.equal(await repository.redeem(challenge, otp, 'totp'), null, 'TOTP replay rejected');
    assert.equal(await repository.redeem({ ...challenge, enrollmentVersion: 2 }, 'test-recovery-code', 'recovery'), null);
    assert.equal(await repository.redeem({ ...challenge, authzVersion: challenge.authzVersion + 1 }, 'test-recovery-code', 'recovery'), null);
    await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal(await repository.redeem(challenge, 'test-recovery-code', 'recovery'), null);
    await tx.user.update({ where: { id: user.id }, data: { isActive: true } });
    assert.equal((await repository.redeem(challenge, 'test-recovery-code', 'recovery')).mfaVersion, 1);
    assert.equal(await repository.redeem(challenge, 'test-recovery-code', 'recovery'), null, 'recovery code replay rejected');
    await tx.session.delete({ where: { id: session.id } });
    await tx.user.delete({ where: { id: user.id } });
    const [count] = await tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "MfaCredential" WHERE "userId" = ${user.id}`;
    assert.equal(count.count, 0);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.user.count({ where: { email } }), 0);
  console.log('PASS MFA storage, counter compare-and-set, invalid assurance/counter/version rejection and cascade; fixtures and rehearsed schema rolled back');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
