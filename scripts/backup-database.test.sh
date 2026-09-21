#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_bin=$(mktemp -d)
trap 'rm -f "$test_bin/pg_dump"; rmdir "$test_bin"' EXIT
printf '#!/usr/bin/env bash\npg_dump "$@"\n' > "$test_bin/pg_dump"
chmod +x "$test_bin/pg_dump"
export PATH="$test_bin:$PATH"

# Test command wiring without contacting PostgreSQL or remote storage.
pg_dump() {
  [[ "$PGDATABASE" == "$EXPECTED_DATABASE" ]] || return 91
  [[ -z "${PGHOSTADDR+x}${PGSERVICE+x}${PGSERVICEFILE+x}${PGOPTIONS+x}" ]] || return 92
  printf 'test dump'; return "${DUMP_EXIT:-0}"
}
restic() {
  if [[ "$1" == backup ]]; then
    [[ "$2" == --stdin-from-command ]] || return 99
    [[ "$4" == "$EXPECTED_FILENAME" && "$6" == "$EXPECTED_TAG" ]] || return 97
    while [[ "$1" != -- ]]; do shift; done
    shift
    "$@" >/dev/null || return 17
    printf 'snapshot-committed\n'
  else
    [[ "$*" == "forget --tag $EXPECTED_TAG --group-by host,paths,tags --keep-daily 7 --keep-weekly 4" ]] || return 98
    printf 'retention-applied\n'
  fi
}
export -f pg_dump restic
export DATABASE_URL='postgresql://test.invalid/test'
export EXPECTED_DATABASE=test EXPECTED_FILENAME=kubenova-postgresql.dump EXPECTED_TAG=kubenova-database
export RESTIC_REPOSITORY='s3:https://storage.test.invalid/bucket'
export RESTIC_PASSWORD_FILE="$PWD/scripts/backup-database.test.sh"
export PGHOSTADDR=192.0.2.1 PGSERVICE=wrong-db PGSERVICEFILE=/tmp/untrusted-service PGOPTIONS='-c search_path=wrong'
output=$(bash scripts/backup-database.sh)
[[ "$output" == $'snapshot-committed\nretention-applied' ]]
export DUMP_EXIT=1
if output=$(bash scripts/backup-database.sh); then
  echo 'Failed dump unexpectedly succeeded' >&2
  exit 1
fi
[[ -z "$output" ]]
unset DUMP_EXIT
export BACKUP_DATABASE=keycloak KEYCLOAK_DATABASE_URL='postgresql://identity.invalid/keycloak'
export EXPECTED_DATABASE=keycloak EXPECTED_FILENAME=kubenova-keycloak.dump EXPECTED_TAG=kubenova-keycloak
output=$(bash scripts/backup-database.sh)
[[ "$output" == $'snapshot-committed\nretention-applied' ]]
export DUMP_EXIT=1
if output=$(bash scripts/backup-database.sh); then exit 1; fi
[[ -z "$output" ]]
unset DUMP_EXIT KEYCLOAK_DATABASE_URL
if output=$(bash scripts/backup-database.sh 2>/dev/null); then
  echo 'Missing identity database fell back to application database' >&2; exit 1
fi
[[ -z "$output" ]]
export BACKUP_DATABASE=invalid
if output=$(bash scripts/backup-database.sh 2>/dev/null); then exit 1; fi
[[ -z "$output" ]]
printf 'PASS successful backup retention; failed dump prevents snapshot and retention\n'
printf 'PASS identity database selection, isolated retention and missing configuration denial\n'
