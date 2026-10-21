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
  if [[ -f "$ROOT_DIR/$path" ]] && grep -Eq -- "$pattern" "$ROOT_DIR/$path"; then
    pass "$label"
  else
    fail "$label"
  fi
}

require_literal() {
  local label="$1" pattern="$2" path="$3"
  if [[ -f "$ROOT_DIR/$path" ]] && grep -Fq -- "$pattern" "$ROOT_DIR/$path"; then
    pass "$label"
  else
    fail "$label"
  fi
}

require_absence() {
  local label="$1" pattern="$2" path="$3"
  if [[ -f "$ROOT_DIR/$path" ]] && ! grep -Eq -- "$pattern" "$ROOT_DIR/$path"; then
    pass "$label"
  else
    fail "$label"
  fi
}

require_file deploy/docker/docker-compose.prod.yml
require_file deploy/docker/.env.example
require_file deploy/systemd/kubenova-frontend.service
require_file deploy/systemd/env/frontend.env.example
require_file backend/control-api/Dockerfile
require_file backend/control-api/docker-entrypoint.sh
require_file backend/control-api/prisma/migrations/migration_lock.toml
require_file scripts/package-release.sh
require_file scripts/update-executor.mjs
require_file scripts/s3-backup-storage.mjs
require_file scripts/systemd-update-executor.mjs
require_file scripts/systemd-update-utils.mjs
require_file scripts/install-systemd-update-executor.mjs
require_file scripts/init-compose-env.mjs
require_file scripts/install-update-executor.mjs
require_file deploy/docker/docker-compose.update.yml
require_file deploy/systemd/kubenova-update-executor.service
require_file deploy/systemd/env/update-executor.env.example
require_file backend/control-api/src/system-update/kubernetes-update.worker.ts
require_file backend/control-api/src/system-update/kubernetes-update.worker.spec.ts
require_file backend/control-api/src/system-update/kubernetes-database-backup.service.ts
require_file deploy/k8s/update-controller.yaml
require_file deploy/k8s/update-backups-pvc.yaml
require_file scripts/prod.sh

require_pattern 'container startup runs Prisma migrations' 'prisma migrate deploy' backend/control-api/docker-entrypoint.sh
require_pattern 'binary production startup runs Prisma migrations' 'node_modules/[.]bin/prisma migrate deploy' scripts/prod.sh
require_pattern 'Dockerfile uses migration entrypoint' 'ENTRYPOINT.*docker-entrypoint[.]sh' backend/control-api/Dockerfile
require_pattern 'Kubernetes updater image includes PostgreSQL and S3 backup clients' 'postgresql-client aws-cli' backend/control-api/Dockerfile
require_pattern 'Compose requires AI credential key' 'AI_CREDENTIAL_ENCRYPTION_KEY:[[:space:]]*[$][{]AI_CREDENTIAL_ENCRYPTION_KEY:[?]' deploy/docker/docker-compose.prod.yml
require_pattern 'Compose has a release tag fallback' 'KUBENOVA_IMAGE_TAG' deploy/docker/docker-compose.prod.yml
require_pattern 'Compose probes readiness endpoint' '/api/health/ready' deploy/docker/docker-compose.prod.yml
require_pattern 'Kubernetes probes readiness endpoint' '/api/health/ready' deploy/k8s/control-api.yaml
require_pattern 'Kubernetes injects AI credential key from Secret' 'name:[[:space:]]*AI_CREDENTIAL_ENCRYPTION_KEY' deploy/k8s/control-api.yaml
require_absence 'Kubernetes control-api does not use the dormant deployment-patch ServiceAccount' 'serviceAccountName:[[:space:]]*kubenova-update-executor' deploy/k8s/control-api.yaml
require_pattern 'Kubernetes update controller uses a dedicated ServiceAccount' 'serviceAccountName:[[:space:]]*kubenova-update-executor' deploy/k8s/update-controller.yaml
require_absence 'Kubernetes control-api does not receive Deployment patch permissions' 'serviceAccountName:[[:space:]]*kubenova-update-executor' deploy/k8s/control-api.yaml
require_pattern 'Kubernetes update controller has a dedicated scoped RoleBinding' 'kind:[[:space:]]*RoleBinding' deploy/k8s/update-executor-rbac.yaml
require_pattern 'Kubernetes update controller consumes persistent task signing key from Secret' 'name:[[:space:]]*KUBENOVA_K8S_UPDATE_TASK_KEY' deploy/k8s/update-controller.yaml
require_pattern 'Kubernetes update controller mounts persistent backup storage' 'claimName:[[:space:]]*kubenova-update-backups' deploy/k8s/update-controller.yaml
require_pattern 'Kubernetes API and update controller read encrypted update settings key' 'name:[[:space:]]*KUBENOVA_UPDATE_ENCRYPTION_KEY' deploy/k8s/control-api.yaml
require_pattern 'release package carries control-api package metadata' 'control-api/package[.]json' scripts/package-release.sh
require_pattern 'release package carries Prisma CLI' 'control-api/node_modules/[.]bin/prisma' scripts/package-release.sh
require_pattern 'release package emits checksum' 'sha256' scripts/package-release.sh
require_pattern 'online updater is host-executor based' 'KUBENOVA_UPDATE_EXECUTOR_URL' deploy/docker/.env.example

local_ai_refs="$(find "$ROOT_DIR/scripts" "$ROOT_DIR/deploy" -type f ! -path '*/node_modules/*' ! -path '*/.next/*' -exec grep -nF '.env.ai.local' {} + 2>/dev/null || true)"
if [[ -n "$local_ai_refs" ]]; then
  # The filename may be mentioned in ignore/documentation, but it must never
  # be copied into an artifact or loaded by a production Docker image.
  if printf '%s\n' "$local_ai_refs" | grep -Eq '(cp|COPY|ADD) .*([.]|/)[.]env[.]ai[.]local'; then
    fail 'release paths do not copy .env.ai.local'
  else
    pass '.env.ai.local is not copied into release paths'
  fi
fi

for script in scripts/compose-release.sh scripts/package-release.sh scripts/prod.sh scripts/service.sh scripts/_service-lib.sh scripts/readme-sync-check.sh .githooks/pre-commit; do
  if bash -n "$ROOT_DIR/$script"; then pass "$script shell syntax"; else fail "$script shell syntax"; fi
done

if node --check "$ROOT_DIR/scripts/update-executor.mjs"; then pass 'scripts/update-executor.mjs syntax'; else fail 'scripts/update-executor.mjs syntax'; fi
if node --check "$ROOT_DIR/scripts/systemd-update-executor.mjs" && node --check "$ROOT_DIR/scripts/install-systemd-update-executor.mjs"; then pass 'systemd updater syntax'; else fail 'systemd updater syntax'; fi
if node --test "$ROOT_DIR/scripts/install-systemd-update-executor.test.mjs" "$ROOT_DIR/scripts/systemd-update-executor.test.mjs" "$ROOT_DIR/scripts/systemd-update-utils.test.mjs"; then pass 'systemd updater isolated tests'; else fail 'systemd updater isolated tests'; fi
if node --test "$ROOT_DIR/scripts/update-preflight.test.mjs"; then pass 'update preflight and backup retention tests'; else fail 'update preflight and backup retention tests'; fi
if node --test "$ROOT_DIR/scripts/s3-backup-storage.test.mjs"; then pass 'S3 backup storage isolated tests'; else fail 'S3 backup storage isolated tests'; fi

require_file scripts/readme-sync-check.sh
require_file .githooks/pre-commit

if [[ "$failures" -gt 0 ]]; then
  printf '[release-check] %d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '[release-check] all checks passed\n'
