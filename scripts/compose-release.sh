#!/usr/bin/env bash
set -euo pipefail

# Compose release operator. It validates production secrets without printing
# their values, applies one tag to all application images, and waits for every
# declared health check before reporting success.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/docker/.env}"
ACTION=""
TAG=""

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/compose-release.sh init [--env-file <file>]
  bash scripts/compose-release.sh preflight [--env-file <file>]
  bash scripts/compose-release.sh up [--tag <version>] [--env-file <file>]
  bash scripts/compose-release.sh pull [--tag <version>] [--env-file <file>]
  bash scripts/compose-release.sh rollback <version> [--env-file <file>]

One tag is applied to frontend, control-api, and runtime-gateway. The
production env file is never rewritten. control-api runs Prisma migrations
from its image entrypoint before the readiness check can pass.
USAGE
}

die() { printf '[compose-release] error: %s\n' "$*" >&2; exit 2; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      [[ -n "$ENV_FILE" ]] || die '--env-file requires a path'
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      [[ -n "$TAG" ]] || die '--tag requires a version'
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    init|preflight|up|pull|rollback)
      [[ -z "$ACTION" ]] || die 'only one action may be supplied'
      ACTION="$1"
      shift
      ;;
    *)
      if [[ "$ACTION" == rollback && -z "$TAG" ]]; then
        TAG="$1"
        shift
      else
        die "unknown argument: $1"
      fi
      ;;
  esac
done

ACTION="${ACTION:-preflight}"
if [[ "$ACTION" == init ]]; then
  require_cmd node
  exec node "$ROOT_DIR/scripts/init-compose-env.mjs" "$ENV_FILE"
fi
[[ -f "$COMPOSE_FILE" ]] || die "compose file not found: $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE (run init first)"
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
export KUBENOVA_COMPOSE_ENV_FILE="$ENV_FILE"
if [[ -n "$TAG" && ! "$TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  die 'tag may contain only letters, digits, dot, underscore, and dash'
fi

env_value() {
  local key="$1" value
  if [[ -n "${!key+x}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  value="$(awk -F= -v key="$key" '/^[[:space:]]*#/ { next } $1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

validate_secret() {
  local key="$1" minimum="$2" value lower
  value="$(env_value "$key")"
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$value" || "${#value}" -lt "$minimum" || "$lower" == *replace-with* || "$lower" == *change-me* || "$lower" == *development-key* || "$lower" == *placeholder* || "$lower" == *example* ]]; then
    die "$key must be a non-placeholder value with at least $minimum characters"
  fi
}

validate_env() {
  validate_secret POSTGRES_PASSWORD 16
  validate_secret JWT_SECRET 32
  validate_secret RUNTIME_TOKEN_SECRET 32
  validate_secret RUNTIME_GATEWAY_INTERNAL_SECRET 32
  validate_secret AI_CREDENTIAL_ENCRYPTION_KEY 32
}

image_repository() {
  local key="$1" fallback="$2" value
  value="$(env_value "$key")"
  [[ -n "$value" ]] || value="$fallback"
  value="${value%@sha256:*}"
  value="$(printf '%s' "$value" | sed -E 's/:[^/:]+$//')"
  printf '%s' "$value"
}

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [[ "$(env_value KUBENOVA_UPDATE_ENABLED)" == true ]]; then
  COMPOSE_ARGS+=(-f "$(dirname "$COMPOSE_FILE")/docker-compose.update.yml")
fi
COMPOSE_ARGS+=(--env-file "$ENV_FILE")
PROJECT_NAME="$(env_value COMPOSE_PROJECT_NAME)"
if [[ -n "$PROJECT_NAME" ]]; then COMPOSE_ARGS+=(--project-name "$PROJECT_NAME"); fi

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

compose_tagged() {
  if [[ -z "$TAG" ]]; then
    compose "$@"
    return
  fi
  local frontend control_api runtime
  frontend="$(env_value FRONTEND_IMAGE)"
  control_api="$(env_value CONTROL_API_IMAGE)"
  runtime="$(env_value RUNTIME_GATEWAY_IMAGE)"
  [[ "$frontend" == *@sha256:* ]] || frontend="$(image_repository FRONTEND_IMAGE ghcr.io/feize666/kubenova-frontend):$TAG"
  [[ "$control_api" == *@sha256:* ]] || control_api="$(image_repository CONTROL_API_IMAGE ghcr.io/feize666/kubenova-control-api):$TAG"
  [[ "$runtime" == *@sha256:* ]] || runtime="$(image_repository RUNTIME_GATEWAY_IMAGE ghcr.io/feize666/kubenova-runtime-gateway):$TAG"
  env "KUBENOVA_IMAGE_TAG=$TAG" "FRONTEND_IMAGE=$frontend" "CONTROL_API_IMAGE=$control_api" "RUNTIME_GATEWAY_IMAGE=$runtime" docker compose "${COMPOSE_ARGS[@]}" "$@"
}

preflight() {
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die 'docker compose plugin is unavailable'
  require_cmd awk
  require_cmd sed
  require_cmd tr
  require_cmd curl
  validate_env
  # --quiet validates interpolation and YAML without echoing resolved secrets.
  compose_tagged config --quiet
  printf '[compose-release] preflight passed (secrets validated, compose rendered)\n'
}

wait_for_health() {
  local -a services=(postgres redis control-api runtime-gateway frontend)
  local deadline=$((SECONDS + 180)) service state health all_ready
  while (( SECONDS < deadline )); do
    all_ready=true
    for service in "${services[@]}"; do
      state="$(docker inspect --format '{{.State.Status}}' "kubenova-$service" 2>/dev/null || true)"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "kubenova-$service" 2>/dev/null || true)"
      if [[ "$state" != running || "$health" != healthy ]]; then all_ready=false; fi
    done
    if [[ "$all_ready" == true ]]; then
      curl --fail --silent --show-error --retry 3 "http://127.0.0.1:$(env_value CONTROL_API_PORT || printf 4000)/api/health/ready" >/dev/null
      curl --fail --silent --show-error --retry 3 "http://127.0.0.1:$(env_value RUNTIME_GATEWAY_PORT || printf 4100)/healthz" >/dev/null
      curl --fail --silent --show-error --retry 3 "http://127.0.0.1:$(env_value FRONTEND_PORT || printf 3000)/login" >/dev/null
      printf '[compose-release] all services healthy\n'
      return 0
    fi
    sleep 2
  done
  printf '[compose-release] health timeout; inspect with compose ps/logs\n' >&2
  compose_tagged ps >&2 || true
  return 1
}

deploy() {
  preflight
  compose_tagged pull
  compose_tagged up -d --remove-orphans
  wait_for_health
  printf '[compose-release] %s complete%s\n' "$ACTION" "${TAG:+ tag=$TAG}"
}

case "$ACTION" in
  preflight)
    preflight
    ;;
  pull)
    preflight
    compose_tagged pull
    printf '[compose-release] pull complete%s\n' "${TAG:+ tag=$TAG}"
    ;;
  up|rollback)
    [[ "$ACTION" != rollback || -n "$TAG" ]] || die 'rollback requires a version, e.g. rollback v1.1'
    deploy
    ;;
  *)
    die "unknown action: $ACTION"
    ;;
esac
