const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the real shell/Node pipeline; only database and storage tools are doubled.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-restore-flow-'));
try {
  const log = path.join(dir, 'calls');
  const commands = {
    psql: 'printf "psql %s\\n" "$*" >> "$TEST_LOG"\ncase "$*" in *pg_class*) echo 0;; esac',
    restic: 'printf "restic %s\\n" "$*" >> "$TEST_LOG"\nprintf archive\nexit "${ARCHIVE_EXIT:-0}"',
    pg_restore: 'printf "restore %s\\n" "$*" >> "$TEST_LOG"\ncat >/dev/null\nexit "${RESTORE_EXIT:-0}"',
  };
  for (const [name, body] of Object.entries(commands)) {
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n' + body + '\n', { mode: 0o700 });
  }
  const run = overrides => {
    fs.writeFileSync(log, '');
    const result = spawnSync('bash', [path.join(__dirname, 'restore-database-rehearsal.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${dir}:${path.dirname(process.execPath)}:${process.env.PATH}`,
        TEST_LOG: log, RESTIC_REPOSITORY: 's3:https://storage.invalid/test',
        RESTIC_PASSWORD_FILE: log, RESTIC_SNAPSHOT: 'a'.repeat(64),
        RESTORE_DATABASE_URL: 'postgresql://localhost/kubenova_restore_fixture',
        RESTORE_DATABASE: 'application', ARCHIVE_EXIT: '0', RESTORE_EXIT: '0', ...overrides,
      },
    });
    return { ...result, calls: fs.readFileSync(log, 'utf8') };
  };
  for (const [kind, filename, readback] of [
    ['application', 'kubenova-postgresql.dump', '"_prisma_migrations"'],
    ['keycloak', 'kubenova-keycloak.dump', 'public.realm'],
  ]) {
    const result = run({ RESTORE_DATABASE: kind });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.includes(filename), `${kind} archive selection`);
    assert.ok(result.calls.includes(readback), `${kind} readback`);
    assert.ok(result.calls.includes('--single-transaction'), 'atomic database restore');
    assert.equal(result.calls.includes(kind === 'keycloak' ? '"_prisma_migrations"' : 'public.realm'), false);
    for (const failure of [{ ARCHIVE_EXIT: '1' }, { RESTORE_EXIT: '1' }]) {
      const failed = run({ RESTORE_DATABASE: kind, ...failure });
      assert.notEqual(failed.status, 0);
      assert.equal(failed.calls.includes(readback), false, 'no acceptance readback after failure');
      assert.equal(failed.stdout.includes('Restore loaded'), false);
    }
  }
  const invalid = run({ RESTORE_DATABASE: 'unknown' });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.calls, '', 'invalid class cannot access database or storage');
  console.log('PASS application/identity restore selection, failure gates and invalid-class denial');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
