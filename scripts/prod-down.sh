#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

RELEASE_ROOT="${RELEASE_ROOT:-/opt/kubenova/current}"
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
source "$ROOT_DIR/scripts/_service-lib.sh"
service_lib_init

stop_service frontend "$FRONTEND_PORT" "false"
stop_service control-api "$CONTROL_API_PORT" "false"
stop_service runtime-gateway "$RUNTIME_GATEWAY_PORT" "false"
