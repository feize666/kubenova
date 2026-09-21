#!/usr/bin/env bash
set -euo pipefail

export BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-$PWD/.run/backup-status.json}"
backup_started_at=$(node -p 'new Date().toISOString()')
write_status() {
  node - "$1" "$backup_started_at" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const [status, startedAt] = process.argv.slice(2);
const target = path.resolve(process.env.BACKUP_STATUS_FILE);
const temporary = `${target}.${randomUUID()}.tmp`;
try {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, JSON.stringify({ status, startedAt,
    completedAt: status === 'running' ? null : new Date().toISOString(),
  }) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, target);
} catch {
  console.error('Unable to publish backup status');
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { force: true });
}
NODE
}
finish() {
  local result=$?
  trap - EXIT
  if [ "$result" -eq 0 ]; then
    write_status success || result=1
  else
    write_status failed || true
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
write_status running

for required in DATABASE_URL KEYCLOAK_DATABASE_URL BACKUP_CONFIG_FILES RESTIC_REPOSITORY RESTIC_PASSWORD_FILE; do
  if [ -z "${!required:-}" ]; then
    echo "Missing required backup setting: $required" >&2
    exit 1
  fi
done
script_dir=$(cd "$(dirname "$0")" && pwd)

# The oneshot service serializes scheduled runs; failures stop the recovery set.
BACKUP_DATABASE=application bash "$script_dir/backup-database.sh"
BACKUP_DATABASE=keycloak bash "$script_dir/backup-database.sh"
node "$script_dir/backup-config.cjs"
