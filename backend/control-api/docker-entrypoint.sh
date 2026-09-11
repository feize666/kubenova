#!/bin/sh
set -eu

# Fail before touching the database when a production secret is missing or is
# still one of the repository examples. This prevents a container from
# starting with credentials that are known to be unsafe.
if [ "${NODE_ENV:-production}" = "production" ]; then
  key="${AI_CREDENTIAL_ENCRYPTION_KEY:-}"
  case "$key" in
    ""|*replace-with*|*change-me*|*development-key*|*placeholder*|*example*)
      echo "[startup] AI_CREDENTIAL_ENCRYPTION_KEY must be a non-placeholder value with at least 32 characters" >&2
      exit 78
      ;;
  esac
  if [ "${#key}" -lt 32 ]; then
    echo "[startup] AI_CREDENTIAL_ENCRYPTION_KEY must be a non-placeholder value with at least 32 characters" >&2
    exit 78
  fi
fi

: "${DATABASE_URL:?DATABASE_URL is required}"

# Migrations are part of the image startup contract. The local Prisma binary
# is used deliberately so startup never attempts a package download.
./node_modules/.bin/prisma migrate deploy
exec "$@"
