// Run after building; SMTP_TEST_SERVER_MODULE points to an isolated smtp-server install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function runChild() {
  const { SMTPServer } = require(process.env.SMTP_TEST_SERVER_MODULE);
  const { sendNotificationEmail } = require(process.env.SMTP_TEST_BUILD_DIR
    ? path.join(process.env.SMTP_TEST_BUILD_DIR, 'notification-email')
    : '../dist/src/monitoring/notification-email');
  const trusted = process.argv[2] === 'trusted';
  for (const secure of trusted ? [true, false] : [true]) {
    const messages = [];
    const server = new SMTPServer({
      secure,
      key: fs.readFileSync(process.env.SMTP_TEST_KEY),
      cert: fs.readFileSync(process.env.SMTP_TEST_CERT),
      authOptional: true,
      disabledCommands: ['AUTH'],
      logger: false,
      onRcptTo(address, session, callback) {
        if (address.address === 'rejected@example.test') {
          return callback(Object.assign(new Error('Recipient rejected'), { responseCode: 550 }));
        }
        callback();
      },
      onData(stream, session, callback) {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.once('error', callback);
        stream.once('end', () => {
          messages.push({ raw: Buffer.concat(chunks).toString('utf8'),
            secure: session.secure, envelope: session.envelope });
          callback();
        });
      },
    });
    // Certificate rejection is expected for the untrusted child.
    const serverErrors = [];
    server.on('error', error => serverErrors.push(error));
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      Object.assign(process.env, {
        SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.server.address().port),
        SMTP_SECURE: String(secure), SMTP_FROM: 'sender@example.test',
      });
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      const values = { title: 'SMTP integration alert', message: 'Alert firing\nRecovery supported.' };
      if (!trusted) {
        await assert.rejects(sendNotificationEmail('recipient@example.test', values),
          /^Error: Email notification delivery failed$/);
        assert.equal(messages.length, 0, 'Untrusted TLS must never deliver');
      } else {
        await sendNotificationEmail('recipient@example.test', values);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].secure, true, 'Implicit TLS and STARTTLS must encrypt data');
        assert.equal(messages[0].envelope.mailFrom.address, 'sender@example.test');
        assert.deepEqual(messages[0].envelope.rcptTo.map(value => value.address), ['recipient@example.test']);
        assert.match(messages[0].raw, /Subject: SMTP integration alert\r?\n/);
        assert.match(messages[0].raw, /Alert firing\r?\nRecovery supported\./);
        await assert.rejects(sendNotificationEmail('rejected@example.test', values),
          /^Error: Email notification delivery failed$/);
        assert.equal(messages.length, 1, 'Rejected recipient must not receive DATA');
        assert.equal(serverErrors.length, 0);
      }
    } finally {
      for (const connection of server.connections) connection.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
}

async function main() {
  assert.ok(path.isAbsolute(process.env.SMTP_TEST_SERVER_MODULE || ''),
    'Set SMTP_TEST_SERVER_MODULE to an absolute isolated smtp-server module path');
  if (process.argv[2]) return runChild();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-smtp-cert-'));
  try {
    const cert = path.join(fixture, 'cert.pem');
    const key = path.join(fixture, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'pipe', timeout: 5000 });
    for (const mode of ['trusted', 'untrusted']) {
      const env = { ...process.env, SMTP_TEST_KEY: key, SMTP_TEST_CERT: cert };
      delete env.NODE_EXTRA_CA_CERTS;
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete env.NODE_OPTIONS;
      if (mode === 'trusted') env.NODE_EXTRA_CA_CERTS = cert;
      execFileSync(process.execPath, [__filename, mode], { env, stdio: 'pipe', timeout: 10000 });
    }
    console.log('SMTP integration passed: TLS, STARTTLS, envelope/body, recipient rejection, untrusted certificate rejection');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
