const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
assert.ok(process.env.RESTIC_BIN, 'Set verified RESTIC_BIN');
const binary = fs.realpathSync(process.env.RESTIC_BIN);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-restic-test-'));
try {
  const password = path.join(dir, 'password');
  const wrong = path.join(dir, 'wrong');
  fs.writeFileSync(password, randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(wrong, randomBytes(32).toString('hex'), { mode: 0o600 });
  const env = { ...process.env, RESTIC_REPOSITORY: path.join(dir, 'repo'), RESTIC_PASSWORD_FILE: password, RESTIC_CACHE_DIR: path.join(dir, 'cache') };
  delete env.RESTIC_PASSWORD; delete env.RESTIC_PASSWORD_COMMAND;
  const run = (args, options = {}) => spawnSync(binary, args, { env, encoding: 'utf8', timeout: 30000, ...options });
  let result = run(['init']); assert.equal(result.status, 0, result.stderr);
  const fixture = `kubenova-fixture-${randomBytes(32).toString('hex')}`;
  result = run(['backup', '--stdin', '--stdin-filename', 'fixture.txt', '--tag', 'fixture'], { input: fixture });
  assert.equal(result.status, 0, result.stderr);
  result = run(['snapshots', '--json']); assert.equal(result.status, 0, result.stderr);
  const [snapshot] = JSON.parse(result.stdout);
  assert.match(snapshot.id, /^[a-f0-9]{64}$/);
  result = run(['dump', snapshot.id, 'fixture.txt']);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, fixture);
  result = run(['dump', snapshot.id, 'fixture.txt'], { env: { ...env, RESTIC_PASSWORD_FILE: wrong } });
  assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  result = run(['check', '--read-data']); assert.equal(result.status, 0, result.stderr);
  function inspect(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) inspect(file);
      else assert.equal(fs.readFileSync(file).includes(Buffer.from(fixture)), false, 'fixture must not be stored as plaintext');
    }
  }
  inspect(env.RESTIC_REPOSITORY);
  console.log('PASS actual Restic encrypted repository: exact restore, wrong-key denial, full integrity check and no plaintext fixture. Local backend only.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
