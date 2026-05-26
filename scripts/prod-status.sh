#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

RELEASE_ROOT="${RELEASE_ROOT:-/opt/k8s-aiops-manager/current}"
FRONTEND_DIR="$RELEASE_ROOT/frontend"
CONTROL_API_DIR="$RELEASE_ROOT/control-api"
RUNTIME_GATEWAY_DIR="$RELEASE_ROOT/runtime-gateway"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"
FRONTEND_BOOT_MODE="stable"
USE_TMUX="false"
SERVICE_PID_SUFFIX=".prod"
SERVICE_LOG_SUFFIX="prod"
SERVICE_STATUS_ADOPT="false"

source "$ROOT_DIR/scripts/_service-lib.sh"
service_lib_init

check_service_status "frontend" "$FRONTEND_PORT"
check_service_status "control-api" "$CONTROL_API_PORT"
check_service_status "runtime-gateway" "$RUNTIME_GATEWAY_PORT"

service_log_dirs_summary
