const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');
const { buildCollectorManifests } = require('../dist/src/log-center/collector-manifests');

async function main() {
  assert.ok(process.env.FILEBEAT_BIN, 'Set verified FILEBEAT_BIN');
  const binary = fs.realpathSync(process.env.FILEBEAT_BIN);
  const version = spawnSync(binary, ['version'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /filebeat version 9\.5\.4\b/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-filebeat-tls-'));
  let server;
  let requests = 0;
  try {
    const ca = path.join(dir, 'ca.crt');
    const key = path.join(dir, 'server.key');
    const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', ca, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(cert.status, 0, cert.stderr);
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(ca) }, (req, res) => {
      requests++;
      assert.equal(req.headers.authorization, `ApiKey ${Buffer.from('fixture:fixture').toString('base64')}`);
      res.writeHead(200, { 'content-type': 'application/json', 'x-elastic-product': 'Elasticsearch' });
      res.end(JSON.stringify({ name: 'isolated-tls-fixture', cluster_name: 'fixture', cluster_uuid: 'fixture',
        version: { number: '9.5.4', build_flavor: 'default', build_type: 'tar' }, tagline: 'You Know, for Search' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    async function check(host, trusted) {
      const manifest = buildCollectorManifests({ clusterId: 'fixture', endpoint: `https://${host}:${port}`,
        ...(trusted ? { caSecretName: 'fixture-ca' } : {}) });
      const config = JSON.parse(manifest.items.find(item => item.kind === 'ConfigMap').data['filebeat.yml']);
      assert.equal(config['output.elasticsearch'].ssl.verification_mode, 'full');
      if (trusted) {
        assert.deepEqual(config['output.elasticsearch'].ssl.certificate_authorities, ['/etc/filebeat-ca/ca.crt']);
        // Emulate the Secret mount in this disposable macOS directory.
        config['output.elasticsearch'].ssl.certificate_authorities = [ca];
      }
      const file = path.join(dir, 'config.json');
      fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      const env = { ...process.env, NODE_NAME: 'fixture', ELASTICSEARCH_API_KEY: 'fixture:fixture' };
      delete env.KUBECONFIG;
      return await new Promise((resolve, reject) => {
        const child = spawn(binary, ['test', 'output', '-c', file, '--path.data', dir, '--path.logs', dir], { env });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
      });
    }
    const accepted = await check('localhost', true);
    assert.equal(accepted.code, 0, accepted.output);
    assert.ok(requests > 0, 'actual HTTPS request required');
    const beforeDenied = requests;
    const untrusted = await check('localhost', false);
    assert.notEqual(untrusted.code, 0);
    assert.equal(untrusted.signal, null, 'must reject certificate, not timeout');
    assert.match(untrusted.output, /x509|certificate/i);
    const wrongHost = await check('127.0.0.1', true);
    assert.notEqual(wrongHost.code, 0);
    assert.equal(wrongHost.signal, null);
    assert.match(wrongHost.output, /x509|certificate/i);
    assert.equal(requests, beforeDenied, 'failed TLS must not send credentials over HTTP');
    console.log('PASS official Filebeat output: custom CA accepted; untrusted CA and hostname mismatch denied. Local HTTPS fixture, not Elasticsearch ingestion.');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
