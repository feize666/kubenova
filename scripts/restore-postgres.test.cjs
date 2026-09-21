const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const base = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
assert.equal(base.search, '');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-restore-real-'));
const databases = [];
const wrapper = path.join(__dirname, 'postgres-command.cjs');
const env = { ...process.env };
const restic = process.env.RESTIC_BIN ? fs.realpathSync(process.env.RESTIC_BIN) : null;
delete env.RESTIC_PASSWORD;
delete env.RESTIC_PASSWORD_COMMAND;
function sql(url, query) {
  const result = spawnSync(process.execPath, [wrapper, 'DATABASE_URL', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    env: { ...env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
try {
  if (restic) fs.symlinkSync(restic, path.join(dir, 'restic'));
  else fs.writeFileSync(path.join(dir, 'restic'), '#!/bin/sh\n[ "$1" = dump ] || exit 90\ncat "$FIXTURE_ARCHIVE"\n', { mode: 0o700 });
  for (const kind of ['application', 'keycloak']) {
    const suffix = randomBytes(6).toString('hex');
    const source = `kubenova_restore_source_${suffix}`;
    const target = `kubenova_restore_target_${suffix}`;
    for (const name of [source, target]) { sql(base, `CREATE DATABASE "${name}"`); databases.push(name); }
    const sourceUrl = new URL(base); sourceUrl.pathname = `/${source}`;
    const targetUrl = new URL(base); targetUrl.pathname = `/${target}`;
    const tables = kind === 'application' ? ['User', '_prisma_migrations'] : ['realm', 'client', 'user_entity'];
    for (const table of tables) sql(sourceUrl, `CREATE TABLE "${table}" (id text PRIMARY KEY); INSERT INTO "${table}" VALUES ('fixture-only')`);
    const archive = path.join(dir, `${kind}.dump`);
    const restoreEnv = { ...env, PATH: `${dir}:${path.dirname(process.execPath)}:${env.PATH}`, RESTORE_DATABASE: kind,
      RESTORE_DATABASE_URL: targetUrl.toString(), RESTIC_REPOSITORY: 's3:https://fixture.invalid/bucket',
      RESTIC_PASSWORD_FILE: archive, RESTIC_SNAPSHOT: 'a'.repeat(64), FIXTURE_ARCHIVE: archive };
    if (restic) {
      const password = path.join(dir, `${kind}.password`);
      fs.writeFileSync(password, randomBytes(32).toString('hex'), { mode: 0o600 });
      Object.assign(restoreEnv, { RESTIC_PASSWORD_FILE: password, RESTIC_REPOSITORY: path.join(dir, `${kind}-repo`), RESTIC_CACHE_DIR: path.join(dir, 'cache'), DATABASE_URL: sourceUrl.toString() });
      const execute = args => {
        const result = spawnSync(restic, args, { env: restoreEnv, encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.stderr); return result.stdout;
      };
      execute(['init']);
      execute(['backup', '--stdin-from-command', '--stdin-filename', kind === 'application' ? 'kubenova-postgresql.dump' : 'kubenova-keycloak.dump', '--', process.execPath, wrapper, 'DATABASE_URL', 'pg_dump', '--format=custom', '--no-owner', '--no-acl']);
      restoreEnv.RESTIC_SNAPSHOT = JSON.parse(execute(['snapshots', '--json']))[0].id;
      assert.equal(fs.existsSync(archive), false, 'streaming backup must not write a plaintext archive');
      execute(['check', '--read-data']);
    } else {
    const fd = fs.openSync(archive, 'w', 0o600);
    let dump;
    try { dump = spawnSync(process.execPath, [wrapper, 'DATABASE_URL', 'pg_dump', '--format=custom', '--no-owner', '--no-acl'], {
      env: { ...env, DATABASE_URL: sourceUrl.toString() }, stdio: ['ignore', fd, 'pipe'], timeout: 20000,
    }); } finally { fs.closeSync(fd); }
    assert.equal(dump.status, 0, dump.stderr?.toString());
    }
    const run = () => spawnSync('bash', [path.join(__dirname, 'restore-database-rehearsal.sh')], { env: restoreEnv, encoding: 'utf8', timeout: 20000 });
    const restored = run();
    assert.equal(restored.status, 0, restored.stderr);
    for (const table of tables) assert.equal(sql(targetUrl, `SELECT id FROM "${table}"`), 'fixture-only');
    const repeat = run();
    assert.notEqual(repeat.status, 0);
    assert.match(repeat.stderr, /not empty/);
  }
  console.log(`PASS real pg_dump/pg_restore: application and identity fixture records restored; nonempty targets refused. ${restic ? 'Actual encrypted Restic streaming/local repository.' : 'Restic transport doubled.'}`);
} finally {
  try { for (const name of databases.reverse()) sql(base, `DROP DATABASE "${name}"`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
