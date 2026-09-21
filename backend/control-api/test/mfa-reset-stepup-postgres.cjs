const assert = require('node:assert/strict');
const { randomUUID, scryptSync } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { ConfigService } = require('@nestjs/config');
const { AuthService } = require('../dist/src/auth/auth.service');
const { AuthRepository } = require('../dist/src/auth/auth.repository');
const { MfaCredentialRepository } = require('../dist/src/auth/mfa-credential.repository');
const { MfaResetStore } = require('../dist/src/auth/mfa-reset.store');
const { LoginAttemptLimiter } = require('../dist/src/auth/login-attempt-limiter');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { TokenService } = require('../dist/src/auth/token.service');
const { MfaResetController } = require('../dist/src/auth/mfa-reset.controller');
const { OidcProviderService } = require('../dist/src/auth/oidc-provider.service');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Explicit local DB required');
const schema = `reset_stepup_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^reset_stepup_[a-f0-9]{32}$/);
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const prefix = `reset-stepup-test:${randomUUID()}:`;
const redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: prefix, maxRetriesPerRequest: 0, retryStrategy: () => null });
redis.on('error', () => {});
let created = false;
let app;
const originalOrigins = process.env.CORS_ORIGINS;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const table of ['User', 'Session', 'MfaCredential', 'AuthorizationChange']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const password = randomUUID();
    const owner = await db.user.create({ data: { email: 'owner@test.invalid', role: 'admin', passwordHash: `salt:${scryptSync(password, 'salt', 64).toString('hex')}` } });
    const target = await db.user.create({ data: { email: 'target@test.invalid', mfaEnabled: true } });
    const sessionData = { authzVersion: 1, expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) };
    const session = await db.session.create({ data: { ...sessionData, userId: owner.id, refreshTokenHash: randomUUID() } });
    await db.session.create({ data: { ...sessionData, userId: target.id, refreshTokenHash: randomUUID() } });
    await db.mfaCredential.create({ data: { userId: target.id, encryptedSecret: 'fixture-only', recoveryCodeHashes: [], confirmedAt: new Date() } });
    const config = new ConfigService({ superadminUserId: owner.id });
    const limiter = new LoginAttemptLimiter(redis);
    const service = new AuthService(new AuthRepository(db), new TokenService(config), undefined, limiter, undefined,
      new MfaCredentialRepository(db, config), undefined, config, new MfaResetStore(redis));
    process.env.CORS_ORIGINS = 'http://127.0.0.1:3000';
    const module = await Test.createTestingModule({ controllers: [MfaResetController], providers: [
      { provide: AuthService, useValue: service }, { provide: LoginAttemptLimiter, useValue: limiter },
      { provide: ConfigService, useValue: config }, { provide: OidcProviderService, useValue: new OidcProviderService(undefined, undefined) },
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
    const post = (action, token = session.id, origin = 'http://127.0.0.1:3000') => request(app.getHttpServer())
      .post(`/api/auth/mfa/reset/${action}`).set('Authorization', `Bearer ${token}`).set('Origin', origin);
    const actor = { token: session.id, user: { id: owner.id }, authzVersion: 1 };
    await assert.rejects(service.prepareMfaReset(actor, target.id, 'wrong'), e => e.getStatus() === 401);
    assert.equal(await db.mfaCredential.count({ where: { userId: target.id } }), 1);
    await post('prepare', 'invalid').send({ targetUserId: target.id, password }).expect(401);
    await post('prepare', session.id, 'https://attacker.invalid').send({ targetUserId: target.id, password }).expect(401);
    await post('prepare').send({ targetUserId: target.id, password, actorUserId: target.id }).expect(400);
    const ordinary = await db.user.create({ data: { email: 'ordinary@test.invalid', role: 'admin' } });
    const ordinarySession = await db.session.create({ data: { ...sessionData, userId: ordinary.id, refreshTokenHash: randomUUID() } });
    await post('prepare', ordinarySession.id).send({ targetUserId: target.id, password }).expect(401);
    const { body: proof } = await post('prepare').send({ targetUserId: target.id, password }).expect(200).expect('Cache-Control', 'no-store');
    assert.match(proof.token, /^[A-Za-z0-9_-]{43}$/);
    const confirmed = await post('confirm').send({ targetUserId: target.id, token: proof.token }).expect(200);
    assert.deepEqual(confirmed.body, { userId: target.id, mfaEnabled: false });
    assert.equal(await db.session.count({ where: { userId: target.id, revokedAt: null } }), 0);
    assert.equal(await db.mfaCredential.count({ where: { userId: target.id } }), 0);
    assert.equal(await db.authorizationChange.count({ where: { affectedUserId: target.id, reason: 'mfa-reset' } }), 1);
    await assert.rejects(service.confirmMfaReset(actor, target.id, proof.token));
    await post('confirm').send({ targetUserId: target.id, token: proof.token }).expect(401);
    console.log('PASS real HTTP guard, password step-up, Redis proof, PostgreSQL reset, session revocation, ordinary-admin denial and replay denial');
  } finally {
    if (originalOrigins === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = originalOrigins;
    // Only this random test prefix is removed; never flush shared Redis.
    const keys = await redis.keys(`${prefix}*`);
    const cleanup = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: 0, retryStrategy: () => null });
    try { if (keys.length) await cleanup.del(...keys); } finally { cleanup.disconnect(); redis.disconnect(); }
    await app?.close();
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
