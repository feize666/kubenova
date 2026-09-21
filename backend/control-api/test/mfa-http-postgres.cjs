const assert = require('node:assert/strict');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { ValidationPipe } = require('@nestjs/common');
const request = require('supertest');
const { AuthController } = require('../dist/src/auth/auth.controller');
const { OidcController } = require('../dist/src/auth/oidc.controller');
const { OidcProviderService } = require('../dist/src/auth/oidc-provider.service');
const { OidcIdentityRepository } = require('../dist/src/auth/oidc-identity.repository');
const { AuthService } = require('../dist/src/auth/auth.service');
const { AuthRepository } = require('../dist/src/auth/auth.repository');
const { TokenService } = require('../dist/src/auth/token.service');
const { PrismaService } = require('../dist/src/platform/database/prisma.service');
const { MfaCredentialRepository } = require('../dist/src/auth/mfa-credential.repository');
const { MfaChallengeStore } = require('../dist/src/auth/mfa-challenge.store');
const { MfaEnrollmentStore } = require('../dist/src/auth/mfa-enrollment.store');
const { LoginAttemptLimiter } = require('../dist/src/auth/login-attempt-limiter');
const { encryptMfaSecret, totpCode, hashRecoveryCode } = require('../dist/src/auth/mfa-totp');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'explicit local DB required');
const schema = `mfa_http_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^mfa_http_[0-9a-f]{32}$/);
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `${schema}:`, maxRetriesPerRequest: 0, connectTimeout: 1000 });
let app;
let created = false;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const table of ['User', 'Session', 'MfaCredential', 'AuthorizationChange', 'ExternalIdentity']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const password = randomBytes(24).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const user = await db.user.create({ data: { email: 'mfa-http@test.invalid', mfaEnabled: true,
      passwordHash: `${salt}:${scryptSync(password, salt, 64).toString('hex')}` } });
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const encryptionKey = randomBytes(32).toString('hex');
    await db.mfaCredential.create({ data: { userId: user.id, encryptedSecret: encryptMfaSecret(secret, encryptionKey),
      confirmedAt: new Date(), recoveryCodeHashes: [hashRecoveryCode('isolated-recovery')] } });
    const oidcBindings = new Map();
    let beforeOidcComplete = async () => {};
    // Provider cryptography is independently covered by oidc-provider.cjs;
    // this double isolates HTTP guards and real session/enrollment persistence.
    const oidcProvider = {
      startReauthentication: async (_config, _secret, binding, identity) => {
        oidcBindings.set(binding, identity);
        return { url: 'https://issuer.test/authorize' };
      },
      completeReauthentication: async (_config, _secret, _callback, binding, identity) => {
        const original = oidcBindings.get(binding);
        oidcBindings.delete(binding);
        assert.ok(original, 'one-use provider transaction required');
        for (const key of ['userId', 'sessionId', 'authzVersion', 'subject']) assert.equal(identity[key], original[key]);
        await beforeOidcComplete();
        return { issuer: 'https://issuer.test', subject: identity.subject };
      },
    };
    const module = await Test.createTestingModule({ controllers: [AuthController, OidcController], providers: [
      AuthService, AuthRepository, TokenService, MfaCredentialRepository, OidcIdentityRepository,
      { provide: OidcProviderService, useValue: oidcProvider },
      { provide: PrismaService, useValue: db },
      { provide: ConfigService, useValue: new ConfigService({ MFA_ENCRYPTION_KEY: encryptionKey, oidcEnabled: true, oidcIssuer: 'https://issuer.test', oidcClientId: 'console', oidcRedirectUri: 'https://console.test/login/oidc' }) },
      { provide: MfaChallengeStore, useValue: new MfaChallengeStore(redis) },
      { provide: MfaEnrollmentStore, useValue: new MfaEnrollmentStore(redis, encryptionKey) },
      { provide: LoginAttemptLimiter, useValue: new LoginAttemptLimiter(redis) },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    const http = request(app.getHttpServer());
    const login = () => http.post('/api/v1/auth/login').send({ username: user.email, password }).expect(200);
    const verify = (token, code, method = 'totp') => http.post('/api/v1/auth/mfa/verify').send({ challengeToken: token, code, method });
    const challenge = (await login()).body;
    assert.equal(challenge.mfaRequired, true);
    assert.equal(challenge.accessToken, undefined);
    assert.equal(challenge.refreshToken, undefined);
    assert.equal(await db.session.count(), 0, 'password alone must not issue session');
    await verify(challenge.challengeToken, 'not-a-code').expect(401);
    await verify(challenge.challengeToken, totpCode(secret)).expect(401);
    const fresh = await login();
    assert.equal(fresh.headers['cache-control'], 'no-store');
    const authenticated = await verify(fresh.body.challengeToken, totpCode(secret)).expect(200);
    assert.equal(authenticated.headers['cache-control'], 'no-store');
    const session = authenticated.body;
    const enabledStatus = await http.get('/api/v1/auth/mfa/status').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    assert.deepEqual(enabledStatus.body, { enabled: true, passwordReauthenticationAvailable: true, canManageMfa: false });
    assert.ok(session.accessToken && session.refreshToken);
    assert.equal(session.challengeToken, undefined);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    const refreshResponse = await http.post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(200);
    assert.equal(refreshResponse.headers['cache-control'], 'no-store');
    const rotated = refreshResponse.body;
    await http.post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${rotated.accessToken}`).expect(200);
    await db.mfaCredential.update({ where: { userId: user.id }, data: { version: { increment: 1 } } });
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${rotated.accessToken}`).expect(401);
    await http.post('/api/v1/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
    const recovery = await login();
    await verify(recovery.body.challengeToken, 'isolated-recovery', 'recovery').expect(200);
    const replay = await login();
    await verify(replay.body.challengeToken, 'isolated-recovery', 'recovery').expect(401);
    await http.post('/api/v1/auth/mfa/verify').send({ challengeToken: 'bad', code: '123456', method: 'totp', role: 'admin' }).expect(400);
    const plain = await db.user.create({ data: { email: 'plain-http@test.invalid', passwordHash: user.passwordHash } });
    const loginResponse = await http.post('/api/v1/auth/login').send({ username: plain.email, password }).expect(200);
    assert.equal(loginResponse.headers['cache-control'], 'no-store');
    const ordinary = loginResponse.body;
    assert.equal(ordinary.mfaRequired, undefined);
    assert.ok(ordinary.accessToken);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${ordinary.accessToken}`).expect(200);
    await http.post('/api/v1/auth/logout').set('Authorization', `Bearer ${ordinary.accessToken}`).expect(200);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${ordinary.accessToken}`).expect(401);
    const enrollSession = (await http.post('/api/v1/auth/login').send({ username: plain.email, password }).expect(200)).body;
    const repository = app.get(MfaCredentialRepository);
    const identity = { userId: plain.id, sessionId: enrollSession.accessToken, authzVersion: plain.authzVersion };
    assert.equal(await repository.confirmEnrollment(identity, secret, 'invalid'), null);
    assert.equal(await repository.confirmEnrollment({ ...identity, authzVersion: plain.authzVersion + 1 }, secret, totpCode(secret)), null);
    assert.equal(await repository.confirmEnrollment({ ...identity, sessionId: ordinary.accessToken }, secret, totpCode(secret)), null, 'revoked session denied');
    const activeSession = await db.session.findUnique({ where: { id: identity.sessionId } });
    await db.session.update({ where: { id: identity.sessionId }, data: { expiresAt: new Date(0) } });
    assert.equal(await repository.confirmEnrollment(identity, secret, totpCode(secret)), null, 'expired session denied');
    await db.session.update({ where: { id: identity.sessionId }, data: { expiresAt: activeSession.expiresAt } });
    await db.user.update({ where: { id: plain.id }, data: { isActive: false } });
    assert.equal(await repository.confirmEnrollment(identity, secret, totpCode(secret)), null, 'disabled account denied');
    await db.user.update({ where: { id: plain.id }, data: { isActive: true } });
    // Fail the final audit write using a constraint only in this run's isolated schema.
    await db.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuthorizationChange" ADD CONSTRAINT reject_test_enrollment CHECK (reason <> 'mfa-enrolled')`);
    try {
      await assert.rejects(repository.confirmEnrollment(identity, secret, totpCode(secret)));
      assert.equal(await db.mfaCredential.count({ where: { userId: plain.id } }), 0);
      const unchanged = await db.user.findUnique({ where: { id: plain.id } });
      assert.equal(unchanged.mfaEnabled, false);
      assert.equal(unchanged.authzVersion, plain.authzVersion);
      assert.equal((await db.session.findUnique({ where: { id: identity.sessionId } })).revokedAt, null);
      assert.equal(await db.authorizationChange.count({ where: { affectedUserId: plain.id } }), 0);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuthorizationChange" DROP CONSTRAINT reject_test_enrollment`);
    }
    console.log('PASS enrollment denies stale/revoked/expired/disabled identity and rolls back all state on audit failure');
    const confirmations = await Promise.all([repository.confirmEnrollment(identity, secret, totpCode(secret)), repository.confirmEnrollment(identity, secret, totpCode(secret))]);
    const enrolled = confirmations.find(Boolean);
    assert.equal(confirmations.filter(Boolean).length, 1);
    assert.equal(new Set(enrolled.recoveryCodes).size, 10);
    const credential = await db.mfaCredential.findUnique({ where: { userId: plain.id } });
    assert.ok(!credential.encryptedSecret.includes(secret));
    assert.deepEqual(credential.recoveryCodeHashes, enrolled.recoveryCodes.map(hashRecoveryCode));
    assert.equal((await db.user.findUnique({ where: { id: plain.id } })).authzVersion, plain.authzVersion + 1);
    assert.equal(await db.session.count({ where: { userId: plain.id, revokedAt: null } }), 0);
    assert.equal(await db.authorizationChange.count({ where: { affectedUserId: plain.id, reason: 'mfa-enrolled' } }), 1);
    await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${enrollSession.accessToken}`).expect(401);
    console.log('PASS atomic enrollment: one concurrent winner, hashed recovery codes, auth version and session revocation');
    console.log('PASS real HTTP + PostgreSQL + Redis: pending login, one-use challenges, TOTP/recovery, refresh rotation, version invalidation and DTO rejection');
    console.log('PASS ordinary non-MFA password login and logout remain functional');
    const revokedUser = await db.user.create({ data: { email: 'revoked-enroll@test.invalid', passwordHash: user.passwordHash } });
    const revokedSession = (await http.post('/api/v1/auth/login').send({ username: revokedUser.email, password }).expect(200)).body;
    const revokedBearer = `Bearer ${revokedSession.accessToken}`;
    const revokedPending = (await http.post('/api/v1/auth/mfa/enrollment').set('Authorization', revokedBearer).send({ password }).expect(200)).body;
    await http.post('/api/v1/auth/logout').set('Authorization', revokedBearer).expect(200);
    await http.post('/api/v1/auth/mfa/enrollment/confirm').set('Authorization', revokedBearer)
      .send({ token: revokedPending.token, code: totpCode(revokedPending.secret) }).expect(401);
    assert.equal(await db.mfaCredential.findUnique({ where: { userId: revokedUser.id } }), null);
    assert.equal((await db.user.findUnique({ where: { id: revokedUser.id } })).mfaEnabled, false);
    console.log('PASS logout between MFA start and confirmation prevents credential creation');
    const self = await db.user.create({ data: { email: 'self-enroll@test.invalid', passwordHash: user.passwordHash } });
    const selfSession = (await http.post('/api/v1/auth/login').send({ username: self.email, password }).expect(200)).body;
    const bearer = `Bearer ${selfSession.accessToken}`;
    await http.get('/api/v1/auth/mfa/status').expect(401);
    const selfStatus = await http.get('/api/v1/auth/mfa/status').set('Authorization', bearer).expect(200);
    assert.equal(selfStatus.headers['cache-control'], 'no-store');
    assert.deepEqual(selfStatus.body, { enabled: false, passwordReauthenticationAvailable: true, canManageMfa: false });
    await db.user.update({ where: { id: self.id }, data: { passwordHash: null } });
    const externalOnly = await http.get('/api/v1/auth/mfa/status').set('Authorization', bearer).expect(200);
    assert.deepEqual(externalOnly.body, { enabled: false, passwordReauthenticationAvailable: false, canManageMfa: false });
    await http.post('/api/v1/auth/mfa/enrollment').set('Authorization', bearer).send({ password }).expect(401);
    await db.user.update({ where: { id: self.id }, data: { passwordHash: user.passwordHash } });
    await http.post('/api/v1/auth/mfa/enrollment').send({}).expect(401);
    await http.post('/api/v1/auth/mfa/enrollment').set('Authorization', bearer).send({ userId: plain.id }).expect(400);
    await http.post('/api/v1/auth/mfa/enrollment').set('Authorization', bearer).send({ password: 'wrong' }).expect(401);
    const pending = await http.post('/api/v1/auth/mfa/enrollment').set('Authorization', bearer).send({ password }).expect(200);
    assert.equal(pending.headers['cache-control'], 'no-store');
    assert.match(pending.body.secret, /^[A-Z2-7]{32}$/);
    const confirmed = await http.post('/api/v1/auth/mfa/enrollment/confirm').set('Authorization', bearer)
      .send({ token: pending.body.token, code: totpCode(pending.body.secret) }).expect(200);
    assert.equal(confirmed.headers['cache-control'], 'no-store');
    assert.equal(confirmed.body.recoveryCodes.length, 10);
    await http.get('/api/v1/auth/mfa/status').set('Authorization', bearer).expect(401);
    await http.get('/api/v1/auth/me').set('Authorization', bearer).expect(401);
    console.log('PASS authenticated self-enrollment HTTP flow with strict principal boundary and session invalidation');
    const external = await db.user.create({ data: { email: 'oidc-enroll@test.invalid', passwordHash: user.passwordHash } });
    await db.externalIdentity.create({ data: { userId: external.id, issuer: 'https://issuer.test', subject: 'subject-enroll' } });
    const extSession = (await http.post('/api/v1/auth/login').send({ username: external.email, password }).expect(200)).body;
    await db.user.update({ where: { id: external.id }, data: { passwordHash: null } });
    const extBearer = `Bearer ${extSession.accessToken}`;
    const prepare = () => http.post('/api/v1/auth/oidc/enrollment/prepare').set('Authorization', extBearer).set('Origin', 'https://console.test');
    await http.post('/api/v1/auth/oidc/enrollment/prepare').set('Origin', 'https://console.test').expect(401);
    await http.post('/api/v1/auth/oidc/enrollment/prepare').set('Authorization', extBearer).set('Origin', 'https://evil.test').expect(401);
    const prepared = await prepare().expect(200);
    assert.equal(prepared.headers['cache-control'], 'no-store');
    const binding = prepared.headers['set-cookie'][0];
    for (const attribute of ['kn_oidc_enrollment_binding=', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(binding.includes(attribute));
    const exchange = cookie => http.post('/api/v1/auth/oidc/enrollment/exchange').set('Authorization', extBearer).set('Origin', 'https://console.test').set('Cookie', cookie.split(';')[0]).send({ callbackUrl: 'https://console.test/login/oidc?state=test&code=test' });
    const beforeSessions = await db.session.count();
    const enrolledPending = await exchange(binding).expect(200);
    assert.equal(enrolledPending.headers['cache-control'], 'no-store');
    assert.equal(enrolledPending.body.accessToken, undefined);
    assert.match(enrolledPending.body.secret, /^[A-Z2-7]{32}$/);
    assert.equal(await db.session.count(), beforeSessions, 'reauthentication must not issue login');
    const race = await prepare().expect(200);
    beforeOidcComplete = async () => { await db.session.update({ where: { id: extSession.accessToken }, data: { revokedAt: new Date() } }); };
    await exchange(race.headers['set-cookie'][0]).expect(401);
    assert.equal(await db.mfaCredential.findUnique({ where: { userId: external.id } }), null);
    console.log('PASS OIDC enrollment HTTP guard/origin/cookie/pending handoff and mid-exchange revocation (provider doubled; real DB/Redis)');
  } finally {
    // Remove only this run's Redis namespace; never flush shared storage.
    const cleanup = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0 });
    try {
      let cursor = '0';
      do {
        const result = await cleanup.scan(cursor, 'MATCH', `${schema}:*`, 'COUNT', 100);
        cursor = result[0];
        if (result[1].length) await cleanup.del(...result[1]);
      } while (cursor !== '0');
    } finally { cleanup.disconnect(); }
    if (app) await app.close();
    redis.disconnect();
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    const remaining = await admin.$queryRaw`SELECT 1 FROM pg_namespace WHERE nspname = ${schema}`;
    assert.equal(remaining.length, 0);
    await admin.$disconnect();
    console.log('PASS isolated HTTP fixtures removed; real accounts unchanged');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
