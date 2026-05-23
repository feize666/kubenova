#!/usr/bin/env bash
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

stop_service "frontend" "$FRONTEND_PORT"
stop_service "control-api" "$CONTROL_API_PORT"
stop_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
