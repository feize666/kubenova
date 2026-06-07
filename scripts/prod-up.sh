#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

RELEASE_ROOT="${RELEASE_ROOT:-/opt/kubenova/current}"
SYSTEMD_ENV_DIR="${SYSTEMD_ENV_DIR:-/etc/kubenova}"
FRONTEND_DIR="$RELEASE_ROOT/frontend"
CONTROL_API_DIR="$RELEASE_ROOT/control-api"
RUNTIME_GATEWAY_DIR="$RELEASE_ROOT/runtime-gateway"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"
RUNTIME_GATEWAY_GOPROXY="${RUNTIME_GATEWAY_GOPROXY:-https://goproxy.cn,direct}"
RUNTIME_TOKEN_SECRET="${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret}"
FRONTEND_BOOT_MODE="stable"
USE_TMUX="false"
SERVICE_PID_SUFFIX=".prod"
SERVICE_LOG_SUFFIX="prod"
source "$ROOT_DIR/scripts/_service-lib.sh"
service_lib_init

require_release_layout() {
  local base="$1"
  [[ -d "$base" ]] || { echo "[错误] 发布目录不存在：$base" >&2; exit 1; }
  [[ -x "$base/runtime-gateway/runtime-gateway" ]] || { echo "[错误] 缺少 runtime-gateway 可执行文件：$base/runtime-gateway/runtime-gateway" >&2; exit 1; }
  [[ -f "$base/control-api/dist/src/main.js" ]] || { echo "[错误] 缺少 control-api 构建产物：$base/control-api/dist/src/main.js" >&2; exit 1; }
  [[ -f "$base/frontend/.next/standalone/server.js" ]] || { echo "[错误] 缺少前端 standalone 包：$base/frontend/.next/standalone/server.js" >&2; exit 1; }
  [[ -d "$base/frontend/.next/standalone/.next/static" ]] || { echo "[错误] 缺少前端静态资源：$base/frontend/.next/standalone/.next/static" >&2; exit 1; }
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

check_dep node "Node.js"
check_dep npm "npm"
check_dep curl "curl"
check_dep psql "PostgreSQL client"
check_dep redis-cli "Redis client"
check_dep go "Go"

if [[ ! -d "$RELEASE_ROOT" ]]; then
  echo "[错误] 发布目录不存在：$RELEASE_ROOT" >&2
  exit 1
fi

require_release_layout "$RELEASE_ROOT"

load_env_file "$SYSTEMD_ENV_DIR/control-api.env"
load_env_file "$SYSTEMD_ENV_DIR/runtime-gateway.env"

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[预检] 正在检查 PostgreSQL..."
  psql "$DATABASE_URL" -c "SELECT 1" >/dev/null
  echo "[预检] PostgreSQL 正常"
fi

if [[ -n "${REDIS_URL:-}" ]]; then
  redis_host="$(echo "$REDIS_URL" | sed 's|redis://||' | cut -d: -f1)"
  redis_port="$(echo "$REDIS_URL" | sed 's|redis://||' | cut -d: -f2)"
  echo "[预检] 正在检查 Redis..."
  redis-cli -h "$redis_host" -p "$redis_port" ping >/dev/null
  echo "[预检] Redis 正常"
fi

frontend_log="$(service_log_file frontend)"
control_api_log="$(service_log_file control-api)"
runtime_gateway_log="$(service_log_file runtime-gateway)"
frontend_pid="$(service_pid_file frontend)"
control_api_pid="$(service_pid_file control-api)"
runtime_gateway_pid="$(service_pid_file runtime-gateway)"

frontend_cmd="HOSTNAME=0.0.0.0 PORT=$FRONTEND_PORT node --max-old-space-size=2048 .next/standalone/server.js"
control_api_cmd="PORT=$CONTROL_API_PORT CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_GATEWAY_BASE_URL=ws://127.0.0.1:$RUNTIME_GATEWAY_PORT RUNTIME_TOKEN_SECRET=$RUNTIME_TOKEN_SECRET node --enable-source-maps dist/src/main.js"
runtime_gateway_cmd="PORT=$RUNTIME_GATEWAY_PORT CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_TOKEN_SECRET=$RUNTIME_TOKEN_SECRET GOPROXY=$RUNTIME_GATEWAY_GOPROXY ./runtime-gateway"

echo "[前端] 正在启动，端口 $FRONTEND_PORT..."
start_detached "$RELEASE_ROOT/frontend" "$frontend_cmd" "$frontend_log" "$frontend_pid"
wait_for_health "$(service_health_url frontend "$FRONTEND_PORT")" 60 || { tail -40 "$frontend_log" >&2 || true; exit 1; }
echo "[前端] 已启动"

echo "[control-api] 正在启动，端口 $CONTROL_API_PORT..."
start_detached "$RELEASE_ROOT/control-api" "$control_api_cmd" "$control_api_log" "$control_api_pid"
wait_for_health "$(service_health_url control-api "$CONTROL_API_PORT")" 60 || { tail -40 "$control_api_log" >&2 || true; exit 1; }
echo "[control-api] 已启动"

echo "[runtime-gateway] 正在启动，端口 $RUNTIME_GATEWAY_PORT..."
start_detached "$RELEASE_ROOT/runtime-gateway" "$runtime_gateway_cmd" "$runtime_gateway_log" "$runtime_gateway_pid"
wait_for_health "$(service_health_url runtime-gateway "$RUNTIME_GATEWAY_PORT")" 60 || { tail -40 "$runtime_gateway_log" >&2 || true; exit 1; }
echo "[runtime-gateway] 已启动"

echo ""
echo "✔ 生产启动完成"
echo "  发布目录: $RELEASE_ROOT"
echo "  前端: http://127.0.0.1:$FRONTEND_PORT"
echo "  control-api: http://127.0.0.1:$CONTROL_API_PORT"
echo "  runtime-gateway: ws://127.0.0.1:$RUNTIME_GATEWAY_PORT"
service_log_dirs_summary
