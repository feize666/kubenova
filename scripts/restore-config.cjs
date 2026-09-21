const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let target;
try {
  const snapshot = process.env.RESTIC_SNAPSHOT;
  if (!/^[a-f0-9]{64}$/.test(snapshot || '')) throw Error('Set an explicit full snapshot ID');
  const parent = process.env.CONFIG_RESTORE_PARENT;
  if (!parent || !path.isAbsolute(parent) || fs.realpathSync(parent) !== path.resolve(parent) || !fs.statSync(parent).isDirectory()) throw Error('Set a canonical existing recovery directory');
  if (!process.env.RESTIC_REPOSITORY || !process.env.RESTIC_PASSWORD_FILE) throw Error('Repository and password file required');
  const list = spawnSync('restic', ['snapshots', '--json', snapshot], { encoding: 'utf8', timeout: 30000 });
  if (list.status !== 0) throw Error('Unable to verify configuration snapshot');
  const snapshots = JSON.parse(list.stdout);
  if (snapshots.length !== 1 || snapshots[0].id !== snapshot || !snapshots[0].tags?.includes('kubenova-configuration')) throw Error('Snapshot is not a configuration backup');
  target = fs.mkdtempSync(path.join(parent, 'kubenova-config-restore-'));
  fs.chmodSync(target, 0o700);
  const result = spawnSync('restic', ['restore', snapshot, '--target', target, '--verify'], { stdio: ['ignore', 'ignore', 'ignore'] });
  if (result.status !== 0) throw Error('Configuration restore failed');
  function protect(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error('Unexpected restored file type');
      fs.chmodSync(file, entry.isDirectory() ? 0o700 : 0o600);
      if (entry.isDirectory()) protect(file);
    }
  }
  protect(target);
  console.log(target);
} catch {
  if (target) fs.rmSync(target, { recursive: true, force: true });
  console.error('Configuration restore refused or failed; no live configuration was replaced');
  process.exitCode = 1;
}
