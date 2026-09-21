const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-config-backup-')));
try {
  const config = path.join(dir, '.env'); const password = path.join(dir, 'password'); const log = path.join(dir, 'calls');
  fs.writeFileSync(config, 'FIXTURE_ONLY=secret', { mode: 0o600 });
  fs.writeFileSync(password, 'fixture-password', { mode: 0o600 });
  fs.symlinkSync(config, path.join(dir, 'link'));
  fs.writeFileSync(path.join(dir, 'restic'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_LOG"\nif [ "$1" = backup ]; then exit "${FAIL_BACKUP:-0}"; fi\n', { mode: 0o700 });
  function run(files, extra = {}) {
    fs.writeFileSync(log, '');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'backup-config.cjs')], { encoding: 'utf8', env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_LOG: log, BACKUP_CONFIG_FILES: JSON.stringify(files),
      RESTIC_REPOSITORY: 's3:https://fixture.invalid/repo', RESTIC_PASSWORD_FILE: password, ...extra,
    } });
    return { ...result, calls: fs.readFileSync(log, 'utf8') };
  }
  const success = run([config]); assert.equal(success.status, 0, success.stderr); assert.equal(success.calls, 'backup\nforget\n');
  const failed = run([config], { FAIL_BACKUP: '1' }); assert.notEqual(failed.status, 0); assert.equal(failed.calls, 'backup\n');
  for (const files of [[], [password], [dir], [path.join(dir, 'link')], [config, config], ['relative']]) {
    const denied = run(files); assert.notEqual(denied.status, 0); assert.equal(denied.calls, '');
  }
  console.log('PASS explicit config backup file boundaries; successful-upload retention only; password/self-backup and symlinks denied');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
