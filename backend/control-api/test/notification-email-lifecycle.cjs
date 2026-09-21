const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

async function run() {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(path.isAbsolute(process.env.SMTP_TEST_SERVER_MODULE || ''));
  if (!process.env.LIFECYCLE_TEST_CERT) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-mail-lifecycle-'));
    try {
      const cert = path.join(dir, 'cert.pem');
      const key = path.join(dir, 'key.pem');
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe' });
      const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert, LIFECYCLE_TEST_CERT: cert, LIFECYCLE_TEST_KEY: key };
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete env.NODE_OPTIONS;
      execFileSync(process.execPath, [__filename], { env, stdio: 'inherit', timeout: 30000 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    return;
  }
  const { PrismaClient } = require('@prisma/client');
  const { SMTPServer } = require(process.env.SMTP_TEST_SERVER_MODULE);
  const { AlertReceiverService } = require('../dist/src/monitoring/alert-receiver.service');
  const { AlertIngestionService } = require('../dist/src/monitoring/alert-ingestion.service');
  const { NotificationWorker } = require('../dist/src/monitoring/notification-worker');
  const { ObservabilityService } = require('../dist/src/monitoring/observability.service');
  const { AlertIngestionController } = require('../dist/src/monitoring/alert-ingestion.controller');
  const { Test } = require('@nestjs/testing');
  const request = require('supertest');
  const db = new PrismaClient();
  let cluster;
  let app;
  const messages = [];
  const server = new SMTPServer({ secure: true, key: fs.readFileSync(process.env.LIFECYCLE_TEST_KEY), cert: fs.readFileSync(process.env.LIFECYCLE_TEST_CERT), disabledCommands: ['AUTH'], authOptional: true,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', callback);
      stream.on('end', () => { messages.push({ raw: Buffer.concat(chunks).toString(), secure: session.secure, recipients: session.envelope.rcptTo.map(x => x.address) }); callback(); });
    },
  });
  server.on('error', () => {});
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.server.address().port), SMTP_SECURE: 'true', SMTP_FROM: 'sender@example.test' });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    cluster = await db.clusterRegistry.create({ data: { name: `mail-lifecycle-${randomUUID()}`, apiServer: 'https://invalid.test', status: 'disabled' } });
    await db.monitoringNotificationTemplate.create({ data: { clusterId: cluster.id, name: 'fixture-mail', channel: 'email', endpoint: 'recipient@example.test', bodyTemplate: '{"title":"{{title}}","message":"{{message}}"}' } });
    const { token } = await new AlertReceiverService(db).rotate({ role: 'admin' }, cluster.id);
    const ingestion = new AlertIngestionService(db);
    const module = await Test.createTestingModule({
      controllers: [AlertIngestionController],
      providers: [{ provide: AlertIngestionService, useValue: ingestion }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const post = (credential, body) => request(app.getHttpServer())
      .post(`/api/monitoring/clusters/${cluster.id}/receiver/alerts`)
      .set('Authorization', `Bearer ${credential}`).send(body);
    const worker = new NotificationWorker(db, new ObservabilityService(db));
    const event = { fingerprint: randomUUID(), status: 'firing', startsAt: new Date().toISOString(), labels: { alertname: 'Mail lifecycle' }, annotations: { description: 'fixture-only' } };
    await post('invalid', { alerts: [event] }).expect(401);
    await post(token, { alerts: [{ ...event, status: 'invalid' }] }).expect(400);
    assert.equal(await db.monitoringAlert.count({ where: { clusterId: cluster.id } }), 0);
    for (const status of ['firing', 'resolved']) {
      const body = { alerts: [{ ...event, status, ...(status === 'resolved' ? { endsAt: new Date(Date.now() + 1000).toISOString() } : {}) }] };
      await post(token, body).expect(200);
      await post(token, body).expect(200);
      await Promise.all([worker.runOnce(cluster.id), worker.runOnce(cluster.id)]);
    }
    assert.equal(messages.length, 2, 'one firing and one recovery email');
    for (const message of messages) { assert.equal(message.secure, true); assert.deepEqual(message.recipients, ['recipient@example.test']); }
    const deliveries = await db.notificationDelivery.findMany({ where: { alert: { clusterId: cluster.id } } });
    assert.deepEqual(deliveries.map(x => `${x.event}:${x.status}`).sort(), ['firing:sent', 'resolved:sent']);
    const subjects = messages.map(message => {
      const unfolded = message.raw.replace(/\r?\n([ \t]+)/g, '$1');
      const subject = /^Subject: (.*)$/mi.exec(unfolded)?.[1]?.trim();
      assert.ok(subject);
      return subject;
    });
    const mime = require(path.join(path.dirname(require.resolve('nodemailer')), 'mime-funcs'));
    assert.equal(subjects[0], mime.encodeWords('告警：Mail lifecycle', 'Q', 52, true));
    assert.equal(subjects[1], mime.encodeWords('已恢复：Mail lifecycle', 'Q', 52, true));
    console.log('PASS HTTP receiver -> PostgreSQL outbox -> worker -> TLS SMTP firing/recovery; invalid credentials/payloads denied, duplicates suppressed');
  } finally {
    try {
      if (cluster) { await db.monitoringAlert.deleteMany({ where: { clusterId: cluster.id } }); await db.auditLog.deleteMany({ where: { clusterId: cluster.id } }); await db.clusterRegistry.delete({ where: { id: cluster.id } }); }
    } finally {
      await app?.close();
      await db.$disconnect();
      for (const connection of server.connections) connection.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
