const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildCollectorConfig } = require('../dist/src/log-center/collector-config');

assert.ok(process.env.FILEBEAT_BIN, 'Set FILEBEAT_BIN to a verified Filebeat 9.5.4 binary');
const binary = fs.realpathSync(process.env.FILEBEAT_BIN);
const version = spawnSync(binary, ['version'], { encoding: 'utf8', timeout: 10000 });
assert.equal(version.status, 0, version.stderr);
assert.match(version.stdout, /filebeat version 9\.5\.4\b/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-filebeat-config-'));
try {
  const { config } = buildCollectorConfig({ clusterId: 'fixture-cluster', endpoint: 'https://elasticsearch.invalid:9200' });
  const filename = path.join(dir, 'filebeat.yml');
  // JSON is YAML-compatible and avoids a second serializer for this check.
  fs.writeFileSync(filename, JSON.stringify(config), { mode: 0o600 });
  const env = { ...process.env, NODE_NAME: 'fixture-node', ELASTICSEARCH_API_KEY: 'fixture:fixture' };
  delete env.KUBECONFIG;
  const result = spawnSync(binary, ['test', 'config', '-c', filename, '--path.data', dir, '--path.logs', dir], {
    env, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout + result.stderr, /Config OK/);
  console.log('PASS official Filebeat 9.5.4 accepts generated config; no collection/output test performed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
