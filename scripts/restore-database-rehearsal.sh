#!/usr/bin/env bash
set -euo pipefail

case "${RESTORE_DATABASE:-application}" in
  application)
    restore_filename=kubenova-postgresql.dump
    readback_sql='SELECT count(*) AS users FROM "User"; SELECT count(*) AS migrations FROM "_prisma_migrations";'
    ;;
  keycloak)
    restore_filename=kubenova-keycloak.dump
    readback_sql='SELECT count(*) AS realms FROM public.realm; SELECT count(*) AS clients FROM public.client; SELECT count(*) AS users FROM public.user_entity;'
    ;;
  *) echo 'RESTORE_DATABASE must be application or keycloak' >&2; exit 1 ;;
esac

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE}"
: "${RESTIC_SNAPSHOT:?Set an explicit full snapshot ID}"
: "${RESTORE_DATABASE_URL:?Set a disposable rehearsal database URL}"
[[ "$RESTIC_SNAPSHOT" =~ ^[a-f0-9]{64}$ ]] || { echo 'A full snapshot ID is required, not latest' >&2; exit 1; }
command -v node >/dev/null
command -v psql >/dev/null
command -v pg_restore >/dev/null
command -v restic >/dev/null
# Restrict restores to local, explicitly named disposable databases.
node -e '
const u = new URL(process.env.RESTORE_DATABASE_URL);
if (!["postgres:","postgresql:"].includes(u.protocol) || !["127.0.0.1","localhost","[::1]"].includes(u.hostname) || u.search || u.hash || !/^\/kubenova_restore_[a-z0-9_]+$/.test(u.pathname)) process.exit(1);
' || { echo 'Restore target must be a loopback kubenova_restore_* database without URL options' >&2; exit 1; }
postgres_command="$(dirname "$0")/postgres-command.cjs"
# libpq hostaddr/service settings can otherwise override a validated URL host.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
tables=$(node "$postgres_command" RESTORE_DATABASE_URL psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');")
[[ "$tables" == 0 ]] || { echo 'Restore refused: target database is not empty' >&2; exit 1; }
restic dump "$RESTIC_SNAPSHOT" "$restore_filename" |
  node "$postgres_command" RESTORE_DATABASE_URL pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="${RESTORE_DATABASE_URL##*/}"
node "$postgres_command" RESTORE_DATABASE_URL psql -X -v ON_ERROR_STOP=1 -c "$readback_sql"
echo 'Restore loaded into disposable database; application/login acceptance still required.'
