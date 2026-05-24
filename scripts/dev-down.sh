#!/usr/bin/env bash
# dev-down.sh - stop development services
# usage: bash scripts/dev-down.sh [frontend|control-api|runtime-gateway|all...]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/_dev-env.sh"
load_dev_env_defaults

FRONTEND_DIR="$ROOT_DIR/frontend"
CONTROL_API_DIR="$ROOT_DIR/backend/control-api"
RUNTIME_GATEWAY_DIR="$ROOT_DIR/backend/runtime-gateway"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"
FRONTEND_BOOT_MODE="${FRONTEND_BOOT_MODE:-dev}"
USE_TMUX="${USE_TMUX:-false}"
SERVICE_LOG_SUFFIX="dev"
source "$ROOT_DIR/scripts/_service-lib.sh"
service_lib_init

services=("$@")
if [[ "${#services[@]}" -eq 0 ]]; then
  services=("all")
fi

stop_named_service() {
  local name="$1"
  case "$name" in
    frontend)
      stop_service "frontend" "$FRONTEND_PORT"
      ;;
    control-api)
      stop_service "control-api" "$CONTROL_API_PORT"
      ;;
    runtime-gateway)
      stop_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
      ;;
    all)
      stop_service "frontend" "$FRONTEND_PORT"
      stop_service "control-api" "$CONTROL_API_PORT"
      stop_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
      ;;
    *)
      echo "unknown service: $name" >&2
      echo "usage: bash scripts/dev-down.sh [frontend|control-api|runtime-gateway|all...]" >&2
      exit 2
      ;;
  esac
}

for service in "${services[@]}"; do
  stop_named_service "$service"
done
