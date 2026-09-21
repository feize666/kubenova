const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubenova-backup-sequence-'));
try {
  fs.copyFileSync(path.join(__dirname, 'backup-all.sh'), path.join(dir, 'backup-all.sh'));
  fs.writeFileSync(path.join(dir, 'backup-database.sh'), `node -e 'const s=JSON.parse(require("fs").readFileSync(process.env.BACKUP_STATUS_FILE));require("assert").equal(s.status,"running");require("assert").equal(s.completedAt,null)' || exit 9
echo "$BACKUP_DATABASE" >> "$TEST_LOG"
[ "$FAIL_STAGE" != "$BACKUP_DATABASE" ]
`);
  fs.writeFileSync(path.join(dir, 'backup-config.cjs'), 'require("fs").appendFileSync(process.env.TEST_LOG,"config\\n");process.exit(process.env.FAIL_STAGE==="config"?1:0);');
  const log = path.join(dir, 'calls');
  const stateFile = path.join(dir, 'state', 'backup.json');
  for (const [stage, expected, status] of [['none', 'application\nkeycloak\nconfig\n', 0], ['application', 'application\n', 1], ['keycloak', 'application\nkeycloak\n', 1], ['config', 'application\nkeycloak\nconfig\n', 1]]) {
    fs.writeFileSync(log, '');
    const result = spawnSync('bash', [path.join(dir, 'backup-all.sh')], { env: {
      ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, TEST_LOG: log, FAIL_STAGE: stage,
      BACKUP_STATUS_FILE: stateFile,
      DATABASE_URL: 'fixture', KEYCLOAK_DATABASE_URL: 'fixture', BACKUP_CONFIG_FILES: '[]', RESTIC_REPOSITORY: 'fixture', RESTIC_PASSWORD_FILE: 'fixture',
    } });
    assert.equal(result.status, status); assert.equal(fs.readFileSync(log, 'utf8'), expected);
    assert.ok(fs.existsSync(stateFile), 'backup must publish its outcome for the status API');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.status, status === 0 ? 'success' : 'failed');
    assert.ok(Number.isFinite(Date.parse(state.startedAt)));
    assert.ok(Date.parse(state.completedAt) >= Date.parse(state.startedAt));
    assert.deepEqual(Object.keys(state).sort(), ['completedAt', 'startedAt', 'status']);
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  }
  const missingConfig = spawnSync('bash', [path.join(dir, 'backup-all.sh')], { env: {
    ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    BACKUP_STATUS_FILE: stateFile, DATABASE_URL: '',
  } });
  assert.notEqual(missingConfig.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).status, 'failed');
  fs.writeFileSync(log, '');
  const unwritableState = spawnSync('bash', [path.join(dir, 'backup-all.sh')], { env: {
    ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    BACKUP_STATUS_FILE: path.join(log, 'impossible.json'), TEST_LOG: log,
  } });
  assert.notEqual(unwritableState.status, 0);
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'no backup begins without observable status');
  console.log('PASS backup sequence: all three stages required; each failure propagates and stops subsequent stages');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
