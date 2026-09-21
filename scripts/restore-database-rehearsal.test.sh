#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_bin=$(mktemp -d)
trap 'rm -f "$test_bin/psql"; rmdir "$test_bin"' EXIT
printf '#!/usr/bin/env bash\npsql "$@"\n' > "$test_bin/psql"
chmod +x "$test_bin/psql"
export PATH="$test_bin:$PATH"
psql() {
  [[ -z "${PGHOSTADDR+x}${PGSERVICE+x}${PGSERVICEFILE+x}${PGOPTIONS+x}" ]] || { echo 'Unsafe inherited connection overrides' >&2; return 97; }
  printf '%s\n' "${TEST_TABLE_COUNT:-1}"
}
pg_restore() { echo 'Unexpected restore invocation' >&2; return 99; }
restic() { echo 'Unexpected archive access' >&2; return 99; }
export -f psql pg_restore restic
export RESTIC_REPOSITORY='s3:https://example.invalid/backup'
export RESTIC_PASSWORD_FILE="$PWD/scripts/restore-database-rehearsal.test.sh"
export RESTIC_SNAPSHOT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
for target in 'postgresql://localhost/k8s_aiops' 'postgresql://remote.invalid/kubenova_restore_test' 'postgresql://localhost/kubenova_restore_test?host=remote.invalid'; do
  if output=$(RESTORE_DATABASE_URL="$target" bash scripts/restore-database-rehearsal.sh 2>&1); then exit 1; fi
  [[ "$output" == *'Restore target must be a loopback'* ]] || { echo "$output" >&2; exit 1; }
done
if output=$(PGHOSTADDR=203.0.113.1 PGSERVICE=production PGSERVICEFILE=/invalid PGOPTIONS='-c search_path=other' RESTORE_DATABASE_URL=postgresql://localhost/kubenova_restore_test bash scripts/restore-database-rehearsal.sh 2>&1); then exit 1; fi
[[ "$output" == *'Restore refused: target database is not empty'* ]] || { echo "$output" >&2; exit 1; }
echo 'PASS restore refuses active/nonlocal/overridden/nonempty targets'
