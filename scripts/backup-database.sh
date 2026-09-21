#!/usr/bin/env bash
set -euo pipefail

# Restic encrypts before upload; no plaintext dump is written to disk.
case "${BACKUP_DATABASE:-application}" in
  application)
    : "${DATABASE_URL:?Set DATABASE_URL}"
    database_variable=DATABASE_URL
    backup_filename=kubenova-postgresql.dump
    backup_tag=kubenova-database
    ;;
  keycloak)
    : "${KEYCLOAK_DATABASE_URL:?Set KEYCLOAK_DATABASE_URL}"
    database_variable=KEYCLOAK_DATABASE_URL
    backup_filename=kubenova-keycloak.dump
    backup_tag=kubenova-keycloak
    ;;
  *) echo 'BACKUP_DATABASE must be application or keycloak' >&2; exit 1 ;;
esac
: "${RESTIC_REPOSITORY:?Set an initialized s3: repository}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE}"
case "$RESTIC_REPOSITORY" in
  s3:*) ;;
  *) echo 'Backup requires an offsite S3-compatible repository' >&2; exit 1 ;;
esac
[[ -r "$RESTIC_PASSWORD_FILE" ]] || { echo 'Backup password file is not readable' >&2; exit 1; }
command -v pg_dump >/dev/null
command -v restic >/dev/null
command -v node >/dev/null

# The wrapper maps the URI to libpq environment fields without exposing credentials.
# Prevent inherited libpq overrides from silently selecting a different server.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
restic backup --stdin-from-command --stdin-filename "$backup_filename" \
  --tag "$backup_tag" -- node "$(dirname "$0")/postgres-command.cjs" "$database_variable" pg_dump --format=custom --no-owner --no-acl

# Only expire this backup class after a successful upload. Prune is separate.
restic forget --tag "$backup_tag" --group-by host,paths,tags --keep-daily 7 --keep-weekly 4
