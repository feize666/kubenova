const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
assert.ok(process.env.RESTIC_BIN, 'Set verified RESTIC_BIN');
const binary = fs.realpathSync(process.env.RESTIC_BIN);
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-config-recovery-test-')));
try {
  fs.symlinkSync(binary, path.join(dir, 'restic'));
  const password = path.join(dir, 'password');
  fs.writeFileSync(password, randomBytes(32).toString('hex'), { mode: 0o600 });
  const file = path.join(dir, '.env'); const content = `TEST_KEY=${randomBytes(32).toString('hex')}`;
  fs.writeFileSync(file, content, { mode: 0o600 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, RESTIC_REPOSITORY: path.join(dir, 'repo'), RESTIC_CACHE_DIR: path.join(dir, 'cache'), RESTIC_PASSWORD_FILE: password, CONFIG_RESTORE_PARENT: dir };
  delete env.RESTIC_PASSWORD; delete env.RESTIC_PASSWORD_COMMAND;
  function restic(args) {
    const result = spawnSync(binary, args, { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  }
  restic(['init']); restic(['backup', '--tag', 'kubenova-configuration', '--', file]);
  const snapshot = JSON.parse(restic(['snapshots', '--json']))[0].id;
  const run = id => spawnSync(process.execPath, [path.join(__dirname, 'restore-config.cjs')], { env: { ...env, RESTIC_SNAPSHOT: id }, encoding: 'utf8', timeout: 30000 });
  const result = run(snapshot); assert.equal(result.status, 0, result.stderr);
  const target = result.stdout.trim(); assert.ok(target.startsWith(`${dir}/kubenova-config-restore-`));
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
  const restored = path.join(target, file);
  assert.equal(fs.readFileSync(restored, 'utf8'), content);
  assert.equal(fs.statSync(restored).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8'), content, 'original must be unchanged');
  assert.notEqual(run('latest').status, 0);
  restic(['backup', '--tag', 'kubenova-database', '--', file]);
  const wrong = JSON.parse(restic(['snapshots', '--json'])).find(item => item.tags.includes('kubenova-database'));
  assert.notEqual(run(wrong.id).status, 0);
  console.log('PASS actual encrypted configuration restore: exact content, private permissions, isolated target, wrong-class/latest denied');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
