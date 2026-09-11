#!/usr/bin/env bash
set -euo pipefail

# Static release contract checks. This intentionally does not start services,
# read secret values, or require Docker/Kubernetes, so it can run in CI and on
# an operator laptop before an artifact is published.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

pass() { printf '[release-check] ok: %s\n' "$1"; }
fail() { printf '[release-check] fail: %s\n' "$1" >&2; failures=$((failures + 1)); }

require_file() {
  local path="$1"
  if [[ -f "$ROOT_DIR/$path" ]]; then pass "$path exists"; else fail "$path missing"; fi
}

require_pattern() {
  local label="$1" pattern="$2" path="$3"
  # Callers use shell literals, so collapse doubled backslashes before passing
  # the expression to ripgrep.
  pattern="${pattern//\\\\/\\}"
  if [[ -f "$ROOT_DIR/$path" ]] && rg -q "$pattern" "$ROOT_DIR/$path"; then
    pass "$label"
  else
    fail "$label"
  fi
}

require_literal() {
  local label="$1" pattern="$2" path="$3"
  if [[ -f "$ROOT_DIR/$path" ]] && rg -Fq -- "$pattern" "$ROOT_DIR/$path"; then
    pass "$label"
  else
    fail "$label"
  fi
}

require_file deploy/docker/docker-compose.prod.yml
require_file deploy/docker/.env.example
require_file backend/control-api/Dockerfile
require_file backend/control-api/docker-entrypoint.sh
require_file backend/control-api/prisma/migrations/migration_lock.toml
require_file scripts/package-release.sh
require_file scripts/prod.sh

require_pattern 'container startup runs Prisma migrations' 'prisma migrate deploy' backend/control-api/docker-entrypoint.sh
require_pattern 'binary production startup runs Prisma migrations' 'node_modules/\\.bin/prisma migrate deploy' scripts/prod.sh
require_pattern 'Dockerfile uses migration entrypoint' 'ENTRYPOINT.*docker-entrypoint\\.sh' backend/control-api/Dockerfile
require_pattern 'Compose requires AI credential key' 'AI_CREDENTIAL_ENCRYPTION_KEY:\\s*\\$\\{AI_CREDENTIAL_ENCRYPTION_KEY:\?' deploy/docker/docker-compose.prod.yml
require_pattern 'Compose has a release tag fallback' 'KUBENOVA_IMAGE_TAG' deploy/docker/docker-compose.prod.yml
require_pattern 'Compose probes readiness endpoint' '/api/health/ready' deploy/docker/docker-compose.prod.yml
require_pattern 'Kubernetes probes readiness endpoint' '/api/health/ready' deploy/k8s/control-api.yaml
require_pattern 'Kubernetes injects AI credential key from Secret' 'name:\\s*AI_CREDENTIAL_ENCRYPTION_KEY' deploy/k8s/control-api.yaml
require_pattern 'release package carries control-api package metadata' 'control-api/package\\.json' scripts/package-release.sh
require_pattern 'release package carries Prisma CLI' 'control-api/node_modules/\\.bin/prisma' scripts/package-release.sh
require_pattern 'release package emits checksum' 'sha256' scripts/package-release.sh

if rg -n --hidden --glob '!**/.git/**' --glob '!**/node_modules/**' --glob '!**/.next/**' '\\.env\\.ai\\.local' "$ROOT_DIR/scripts" "$ROOT_DIR/deploy" >/dev/null; then
  # The filename may be mentioned in ignore/documentation, but it must never
  # be copied into an artifact or loaded by a production Docker image.
  if rg -n 'cp .*\\.env\\.ai\\.local|COPY .*\\.env\\.ai\\.local|ADD .*\\.env\\.ai\\.local' "$ROOT_DIR/scripts" "$ROOT_DIR/deploy" >/dev/null; then
    fail 'release paths do not copy .env.ai.local'
  else
    pass '.env.ai.local is not copied into release paths'
  fi
fi

for script in scripts/package-release.sh scripts/prod.sh scripts/service.sh scripts/_service-lib.sh; do
  if bash -n "$ROOT_DIR/$script"; then pass "$script shell syntax"; else fail "$script shell syntax"; fi
done

if [[ "$failures" -gt 0 ]]; then
  printf '[release-check] %d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '[release-check] all checks passed\n'
