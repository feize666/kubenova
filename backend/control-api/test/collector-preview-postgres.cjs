const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { AuthService } = require('../dist/src/auth/auth.service');
const { AuthRepository } = require('../dist/src/auth/auth.repository');
const { TokenService } = require('../dist/src/auth/token.service');
const { ClusterAccessService } = require('../dist/src/common/cluster-access.service');
const { LogCenterService } = require('../dist/src/log-center/log-center.service');
const { LogCenterController } = require('../dist/src/log-center/log-center.controller');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
const schema = `collector_preview_${randomUUID().replaceAll('-', '')}`;
const admin = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let created = false;
let app;
(async () => {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    for (const table of ['User', 'Session', 'ClusterRegistry', 'MonitoringDataSource']) {
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const sessions = {};
    for (const role of ['admin', 'read-only']) {
      const user = await db.user.create({ data: { email: `${role}@fixture.invalid`, role } });
      sessions[role] = await db.session.create({ data: { userId: user.id, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000), refreshExpiresAt: new Date(Date.now() + 120000) } });
    }
    const cluster = await db.clusterRegistry.create({ data: { name: 'fixture', apiServer: 'https://cluster.invalid' } });
    const source = await db.monitoringDataSource.create({ data: { clusterId: cluster.id, name: 'fixture', kind: 'elasticsearch', endpoint: 'https://es.invalid', secretRef: 'NEVER_RETURN_THIS_SECRET' } });
    const auth = new AuthService(new AuthRepository(db), new TokenService(new ConfigService()));
    const module = await Test.createTestingModule({ controllers: [LogCenterController], providers: [
      { provide: AuthService, useValue: auth },
      { provide: LogCenterService, useValue: new LogCenterService(db, new ClusterAccessService(db)) },
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
    const input = { clusterId: cluster.id, dataSourceId: source.id, retentionDays: 30 };
    const post = (token, body = input) => request(app.getHttpServer()).post('/api/log-center/collection/preview').set('Authorization', `Bearer ${token}`).send(body);
    await post('invalid').expect(401);
    await post(sessions['read-only'].id).expect(403);
    const result = await post(sessions.admin.id).expect(200).expect('Cache-Control', 'no-store');
    assert.equal(result.body.lifecyclePolicy.body.policy.phases.delete.min_age, '30d');
    assert.equal(result.body.config['filebeat.inputs'][0].fields.kubenova.cluster_id, cluster.id);
    assert.ok(!JSON.stringify(result.body).includes(source.secretRef));
    await post(sessions.admin.id, { ...input, endpoint: 'https://injected.invalid' }).expect(400);
    await post(sessions.admin.id, { ...input, clusterId: 'foreign' }).expect(404);
    await db.monitoringDataSource.update({ where: { id: source.id }, data: { enabled: false } });
    await post(sessions.admin.id).expect(404);
    await db.session.update({ where: { id: sessions.admin.id }, data: { revokedAt: new Date() } });
    await post(sessions.admin.id).expect(401);
    assert.equal(await db.monitoringDataSource.count(), 1);
    console.log('PASS real HTTP/session/PostgreSQL collector preview, reader denial, revocation and secret omission; isolated fixtures only');
  } finally {
    try { await app?.close(); } finally {
      await db.$disconnect();
      try { if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await admin.$disconnect(); }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
