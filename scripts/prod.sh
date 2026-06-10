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

SYSTEMD_DIR="${SYSTEMD_DIR:-/usr/lib/systemd/system}"
ENV_DIR="${ENV_DIR:-${SYSTEMD_ENV_DIR:-/etc/kubenova}}"
RELEASE_BASE="${RELEASE_BASE:-/opt/kubenova}"
CURRENT_DIR="${CURRENT_DIR:-${RELEASE_BASE}/current}"

prod_usage() {
  cat <<'USAGE'
Usage:
  bash scripts/prod.sh up
  bash scripts/prod.sh down
  bash scripts/prod.sh restart
  bash scripts/prod.sh status
  bash scripts/prod.sh install
  bash scripts/prod.sh uninstall
  bash scripts/prod.sh switch <version>
  bash scripts/prod.sh rollback <version>
USAGE
}

require_release_layout() {
  local base="$1"
  [[ -d "$base" ]] || { echo "[错误] 发布目录不存在：$base" >&2; exit 1; }
  [[ -x "$base/runtime-gateway/runtime-gateway" ]] || { echo "[错误] 缺少 runtime-gateway 可执行文件：$base/runtime-gateway/runtime-gateway" >&2; exit 1; }
  [[ -f "$base/control-api/dist/src/main.js" ]] || { echo "[错误] 缺少 control-api 构建产物：$base/control-api/dist/src/main.js" >&2; exit 1; }
  [[ -f "$base/frontend/.next/standalone/server.js" ]] || { echo "[错误] 缺少前端 standalone 包：$base/frontend/.next/standalone/server.js" >&2; exit 1; }
  [[ -d "$base/frontend/.next/standalone/.next/static" ]] || { echo "[错误] 缺少前端静态资源：$base/frontend/.next/standalone/.next/static" >&2; exit 1; }
}

require_cmd() {
  local cmd="$1" pkg="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[错误] 未找到 '$cmd'，请先安装 $pkg。" >&2
    exit 1
  fi
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

install_systemd() {
  require_cmd install
  require_cmd systemctl "systemd"
  require_cmd ln
  require_cmd mkdir

  install -d -m 0755 "$ENV_DIR"
  install -d -m 0755 "$RELEASE_BASE"

  if [[ ! -d "$CURRENT_DIR" ]]; then
    echo "[错误] 当前发布目录不存在：$CURRENT_DIR" >&2
    exit 1
  fi
  install -d -m 0755 "$CURRENT_DIR/env"

  install -m 0644 "$ROOT_DIR/deploy/systemd/kubenova.target" "$SYSTEMD_DIR/kubenova.target"
  install -m 0644 "$ROOT_DIR/deploy/systemd/kubenova-control-api.service" "$SYSTEMD_DIR/kubenova-control-api.service"
  install -m 0644 "$ROOT_DIR/deploy/systemd/kubenova-runtime-gateway.service" "$SYSTEMD_DIR/kubenova-runtime-gateway.service"

  install -m 0644 "$ROOT_DIR/deploy/systemd/env/control-api.env.example" "$CURRENT_DIR/env/control-api.env.example"
  install -m 0644 "$ROOT_DIR/deploy/systemd/env/runtime-gateway.env.example" "$CURRENT_DIR/env/runtime-gateway.env.example"

  if [[ ! -f "$ENV_DIR/control-api.env" ]]; then
    install -m 0644 "$ROOT_DIR/deploy/systemd/env/control-api.env.example" "$ENV_DIR/control-api.env"
  fi
  if [[ ! -f "$ENV_DIR/runtime-gateway.env" ]]; then
    install -m 0644 "$ROOT_DIR/deploy/systemd/env/runtime-gateway.env.example" "$ENV_DIR/runtime-gateway.env"
  fi

  systemctl daemon-reload
  systemctl enable kubenova.target >/dev/null 2>&1 || true
  systemctl enable kubenova-control-api.service >/dev/null 2>&1 || true
  systemctl enable kubenova-runtime-gateway.service >/dev/null 2>&1 || true

  echo "✔ systemd 与环境模板安装完成"
  echo "  单元目录: $SYSTEMD_DIR"
  echo "  环境目录: $ENV_DIR"
  echo "  发布目录: $CURRENT_DIR"
}

uninstall_systemd() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop kubenova-runtime-gateway.service >/dev/null 2>&1 || true
    systemctl stop kubenova-control-api.service >/dev/null 2>&1 || true
    systemctl disable kubenova.target >/dev/null 2>&1 || true
  fi

  rm -f "$SYSTEMD_DIR/kubenova.target" \
        "$SYSTEMD_DIR/kubenova-control-api.service" \
        "$SYSTEMD_DIR/kubenova-runtime-gateway.service"

  rm -f "$ENV_DIR/control-api.env" \
        "$ENV_DIR/runtime-gateway.env"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
  fi

  echo "✔ systemd 与环境模板已卸载"
}

switch_release() {
  local version="$1" action="$2"
  if [[ -z "$version" ]]; then
    echo "用法: bash scripts/service.sh prod $action <version>" >&2
    exit 1
  fi

  local release_dir="${RELEASE_BASE}/releases/${version}"
  local current_link="${RELEASE_BASE}/current"
  require_cmd ln
  require_cmd readlink
  require_cmd systemctl "systemd"

  if [[ ! -d "$release_dir" ]]; then
    echo "[错误] 目标版本不存在：$release_dir" >&2
    exit 1
  fi
  require_release_layout "$release_dir"

  echo "[$action] 当前版本: $(readlink -f "$current_link" 2>/dev/null || echo 未设置)"
  echo "[$action] 目标版本: $version"
  ln -sfn "$release_dir" "$current_link"
  systemctl daemon-reload
  systemctl restart kubenova-runtime-gateway.service kubenova-control-api.service || true
  echo "✔ 已切换到版本 $version"
  echo "  current: $(readlink -f "$current_link")"
}

stop_prod() {
  stop_service frontend "$FRONTEND_PORT" "false"
  stop_service control-api "$CONTROL_API_PORT" "false"
  stop_service runtime-gateway "$RUNTIME_GATEWAY_PORT" "false"
}

status_prod() {
  SERVICE_STATUS_ADOPT="false"
  check_service_status "frontend" "$FRONTEND_PORT"
  check_service_status "control-api" "$CONTROL_API_PORT"
  check_service_status "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
  service_log_dirs_summary
}

cmd="${1:-up}"
case "$cmd" in
  up|start)
    shift || true
    ;;
  down|stop)
    stop_prod
    exit 0
    ;;
  restart)
    stop_prod
    exec bash "$ROOT_DIR/scripts/prod.sh" up
    ;;
  status)
    status_prod
    exit 0
    ;;
  install)
    install_systemd
    exit 0
    ;;
  uninstall)
    uninstall_systemd
    exit 0
    ;;
  switch|rollback)
    shift || true
    switch_release "${1:-}" "$cmd"
    exit 0
    ;;
  help|-h|--help)
    prod_usage
    exit 0
    ;;
  *)
    echo "[错误] 未知 prod 命令: $cmd" >&2
    prod_usage >&2
    exit 2
    ;;
esac

check_dep node "Node.js"
check_dep npm "npm"
check_dep curl "curl"
check_dep psql "PostgreSQL client"
check_dep redis-cli "Redis client"
check_dep go "Go"
if ! command -v helm >/dev/null 2>&1; then
  echo "[警告] 未找到 helm，基础服务继续启动；Helm 应用/仓库能力会不可用。" >&2
fi

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
