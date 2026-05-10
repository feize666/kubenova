#!/usr/bin/env bash
# dev-up.sh — 一键启动所有开发服务
# 用法: bash scripts/dev-up.sh [--no-gateway]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/_dev-env.sh"
load_dev_env_defaults

FRONTEND_DIR="$ROOT_DIR/frontend"
CONTROL_API_DIR="$ROOT_DIR/backend/control-api"
RUNTIME_GATEWAY_DIR="$ROOT_DIR/backend/runtime-gateway"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$LOG_DIR"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"
RUNTIME_TOKEN_SECRET="${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret}"
RUNTIME_GATEWAY_GOPROXY="${RUNTIME_GATEWAY_GOPROXY:-https://goproxy.cn,direct}"
START_GATEWAY="${START_GATEWAY:-true}"
USE_TMUX="${USE_TMUX:-false}"
FRONTEND_BOOT_MODE="${FRONTEND_BOOT_MODE:-dev}"

service_health_url() {
  local name="$1" port="$2"
  case "$name" in
    frontend) echo "http://127.0.0.1:${port}/" ;;
    control-api) echo "http://127.0.0.1:${port}/api/capabilities" ;;
    runtime-gateway) echo "http://127.0.0.1:${port}/healthz" ;;
    *) echo "" ;;
  esac
}

service_session_name() {
  local name="$1"
  echo "aiops-${name}"
}

tmux_session_exists() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null
}

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --no-gateway) START_GATEWAY="false" ;;
  esac
done

# ── 依赖检查 ────────────────────────────────────────────
check_dep() {
  local cmd="$1" pkg="${2:-$1}"
  if ! command -v "$cmd" &>/dev/null; then
    echo "[错误] 未找到 '$cmd'，请先安装 $pkg。" >&2
    exit 1
  fi
}

check_dep node "Node.js (https://nodejs.org)"
check_dep npm  "npm"
check_dep curl "curl"
check_dep psql "PostgreSQL client (apt install postgresql-client)"
check_dep redis-cli "Redis (apt install redis)"

if [[ "$START_GATEWAY" == "true" ]]; then
  check_dep go "Go (https://go.dev)"
fi

prepare_runtime_gateway() {
  if [[ "$START_GATEWAY" != "true" ]]; then
    return
  fi
  echo "[预检] 正在检查 runtime-gateway 的 Go 依赖..."
  if ! (cd "$RUNTIME_GATEWAY_DIR" && GOPROXY="$RUNTIME_GATEWAY_GOPROXY" go mod download); then
    echo "[错误] runtime-gateway 依赖下载失败，请检查网络或代理后重试。" >&2
    echo "        已尝试 GOPROXY=$RUNTIME_GATEWAY_GOPROXY" >&2
    exit 1
  fi
  echo "[预检] runtime-gateway 依赖正常"
}

prepare_frontend_deps() {
  local next_bin="$FRONTEND_DIR/node_modules/next/dist/bin/next"
  if [[ -f "$next_bin" ]]; then
    return
  fi

  echo "[预检] 前端依赖缺失，正在安装..."
  if ! (cd "$FRONTEND_DIR" && npm ci); then
    echo "[错误] 前端依赖安装失败，请检查 frontend/package-lock.json 与网络后重试。" >&2
    exit 1
  fi
  echo "[预检] 前端依赖安装完成"
}

prepare_control_api_deps() {
  local nest_bin="$CONTROL_API_DIR/node_modules/.bin/nest"
  if [[ -f "$nest_bin" ]]; then
    return
  fi

  echo "[预检] control-api 依赖缺失，正在安装..."
  if ! (cd "$CONTROL_API_DIR" && npm ci); then
    echo "[错误] control-api 依赖安装失败，请检查 backend/control-api/package-lock.json 与网络后重试。" >&2
    exit 1
  fi
  echo "[预检] control-api 依赖安装完成"
}

prepare_frontend_standalone() {
  if [[ "$FRONTEND_BOOT_MODE" != "stable" ]]; then
    return
  fi

  local server_js="$FRONTEND_DIR/.next/standalone/server.js"
  if [[ -f "$server_js" ]]; then
    if [[ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" || ! -d "$FRONTEND_DIR/.next/standalone/public" ]]; then
      echo "[预检] 正在同步前端静态资源到 standalone 包..."
      rm -rf "$FRONTEND_DIR/.next/standalone/.next/static" "$FRONTEND_DIR/.next/standalone/public"
      mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
      cp -a "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/"
      if [[ -d "$FRONTEND_DIR/public" ]]; then
        cp -a "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/"
      fi
      echo "[预检] 前端静态资源同步完成"
    fi
    return
  fi

  echo "[预检] 前端 standalone 包缺失，正在构建稳定包..."
  local build_ok="false"
  for attempt in 1 2; do
    if (cd "$FRONTEND_DIR" && npm run build:stable); then
      build_ok="true"
      break
    fi
    if [[ "$attempt" == "1" ]]; then
      echo "[预检] 前端构建可能被占用或锁定，稍后重试一次..." >&2
      sleep 5
    fi
  done

  if [[ "$build_ok" != "true" ]]; then
    echo "[错误] 前端稳定包构建重试后仍失败，请查看构建输出后再试。" >&2
    exit 1
  fi

  for _ in $(seq 1 10); do
    if [[ -f "$server_js" ]]; then
      if [[ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" || ! -d "$FRONTEND_DIR/.next/standalone/public" ]]; then
        echo "[预检] 正在同步前端静态资源到 standalone 包..."
        rm -rf "$FRONTEND_DIR/.next/standalone/.next/static" "$FRONTEND_DIR/.next/standalone/public"
        mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
        cp -a "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/"
        if [[ -d "$FRONTEND_DIR/public" ]]; then
          cp -a "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/"
        fi
        echo "[预检] 前端静态资源同步完成"
      fi
      echo "[预检] 前端 standalone 包正常"
      return
    fi
    sleep 1
  done

  if [[ ! -f "$server_js" ]]; then
    echo "[错误] 前端构建已完成，但仍未找到 $server_js。" >&2
    exit 1
  fi
}

# ── 服务健康检查 ────────────────────────────────────────
wait_for_postgres() {
  local db_url="${DATABASE_URL:-postgresql://k8s_aiops:k8s_aiops_dev@localhost:5432/k8s_aiops}"
  echo "[预检] 正在检查 PostgreSQL..."
  if ! psql "$db_url" -c "SELECT 1" &>/dev/null; then
    echo "[错误] 无法连接 PostgreSQL：$db_url" >&2
    echo "  请确认 PostgreSQL 已启动且数据库已创建。" >&2
    echo "  可执行：bash scripts/db-init.sh" >&2
    exit 1
  fi
  echo "[预检] PostgreSQL 正常"
}

wait_for_redis() {
  local redis_url="${REDIS_URL:-redis://localhost:6379}"
  local host port
  host="$(echo "$redis_url" | sed 's|redis://||' | cut -d: -f1)"
  port="$(echo "$redis_url" | sed 's|redis://||' | cut -d: -f2)"
  echo "[预检] 正在检查 Redis..."
  if ! redis-cli -h "$host" -p "$port" ping &>/dev/null; then
    echo "[错误] 无法连接 Redis：$host:$port" >&2
    exit 1
  fi
  echo "[预检] Redis 正常"
}

wait_for_postgres
wait_for_redis
prepare_runtime_gateway
prepare_frontend_deps
prepare_control_api_deps
prepare_frontend_standalone

# ── 进程管理 ────────────────────────────────────────────
listener_pid() {
  local port="$1"
  fuser -n tcp "$port" 2>/dev/null | awk '{print $1}'
}

wait_for_port_free() {
  local port="$1"
  local retries="${2:-10}"
  for _ in $(seq 1 "$retries"); do
    if ! listener_pid "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

resolve_managed_pid() {
  local name="$1" port="$2" fallback_pid="${3:-}"
  local bound_pid
  bound_pid="$(listener_pid "$port" || true)"

  if [[ -n "$bound_pid" ]]; then
    case "$name" in
      frontend)
        if is_frontend_process "$bound_pid"; then
          echo "$bound_pid"
          return
        fi
        ;;
      control-api)
        if is_control_api_process "$bound_pid"; then
          echo "$bound_pid"
          return
        fi
        ;;
      runtime-gateway)
        if is_runtime_gateway_process "$bound_pid"; then
          echo "$bound_pid"
          return
        fi
        ;;
    esac
  fi

  if [[ -n "$fallback_pid" ]]; then
    echo "$fallback_pid"
  fi
}

process_cmdline() {
  local pid="$1"
  ps -p "$pid" -o args= 2>/dev/null || true
}

process_cwd() {
  local pid="$1"
  readlink -f "/proc/$pid/cwd" 2>/dev/null || true
}

is_runtime_gateway_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"runtime-gateway"* || "$cmdline" == *"cmd/runtime-gateway"* ]]
}

is_frontend_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"next-server"* || "$cmdline" == *"frontend/.next/standalone/server.js"* || "$cmdline" == *"next/dist/bin/next start"* || "$cmdline" == *"next/dist/bin/next dev"* ]]
}

is_frontend_standalone_process() {
  local pid="$1"
  local cwd
  cwd="$(process_cwd "$pid")"
  [[ "$cwd" == *"/frontend/.next/standalone" ]]
}

is_control_api_process() {
  local pid="$1"
  local cmdline
  cmdline="$(process_cmdline "$pid")"
  [[ "$cmdline" == *"/backend/control-api/dist/"* || "$cmdline" == *"dist/src/main.js"* || "$cmdline" == *"nestjs"* || "$cmdline" == *"start:dev"* ]]
}

service_is_starting() {
  local pid="$1" port="$2"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if [[ -n "$port" ]] && ss -ltnp "( sport = :$port )" 2>/dev/null | rg -q "pid=$pid"; then
    return 1
  fi
  local stat
  stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -n "$stat" ]]
}

is_healthy() {
  local url="$1"
  if [[ -z "$url" ]]; then
    return 0
  fi
  local code
  code="$(curl -s -o /dev/null -m 2 -w "%{http_code}" "$url" || true)"
  [[ "$code" =~ ^[234][0-9][0-9]$ ]]
}

wait_for_health() {
  local url="$1" retries="${2:-12}"
  if [[ -z "$url" ]]; then
    return 0
  fi
  for _ in $(seq 1 "$retries"); do
    if is_healthy "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

service_health_timeout() {
  local name="$1"
  case "$name" in
    control-api) echo 180 ;;
    frontend) echo 120 ;;
    runtime-gateway) echo 120 ;;
    *) echo 60 ;;
  esac
}

start_if_not_running() {
  local name="$1"
  local workdir="$2"
  local port="$3"
  local cmd="$4"
  local pid_file="$RUN_DIR/${name}.pid"
  local log_file="$LOG_DIR/${name}.log"
  local session_name
  session_name="$(service_session_name "$name")"
  local health_url
  health_url="$(service_health_url "$name" "$port")"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      if is_healthy "$health_url"; then
        echo "[$name] 已在运行（pid=$pid, 端口=$port）"
        return
      fi
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中（pid=$pid, 端口=$port）"
        return
      fi
      echo "[$name] pid=$pid 仍在，但健康检查失败，正在重启..."
      kill "$pid" || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" || true
      fi
      wait_for_port_free "$port" 10 || true
    fi
    rm -f "$pid_file"
  fi

  if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    if [[ -n "$health_url" ]] && is_healthy "$health_url"; then
      local adopted_pid
      adopted_pid="$(resolve_managed_pid "$name" "$port" "")"
      if [[ -n "$adopted_pid" ]]; then
        echo "$adopted_pid" >"$pid_file"
      fi
      echo "[$name] tmux 会话 '$session_name' 已在运行，端口 $port"
      return
    fi
    local tmux_pid
    tmux_pid="$(listener_pid "$port" || true)"
    if [[ -n "$tmux_pid" ]] && service_is_starting "$tmux_pid" "$port"; then
      echo "[$name] 启动中（tmux 会话='$session_name', pid=$tmux_pid, 端口=$port）"
      return
    fi
    echo "[$name] tmux 会话 '$session_name' 存在，但健康检查失败，正在重启..."
    tmux kill-session -t "$session_name" 2>/dev/null || true
    sleep 1
  fi

  local bound_pid
  bound_pid="$(listener_pid "$port" || true)"
  if [[ -n "$bound_pid" ]]; then
    if [[ "$name" == "runtime-gateway" ]] && is_runtime_gateway_process "$bound_pid"; then
      if [[ -n "$health_url" ]] && is_healthy "$health_url"; then
        echo "[$name] 端口 $port 已由 runtime-gateway(pid=$bound_pid) 提供服务，接管为受管进程。"
        echo "$bound_pid" >"$pid_file"
        return
      fi
      if service_is_starting "$bound_pid" "$port"; then
        echo "[$name] 启动中（pid=$bound_pid, 端口=$port）"
        echo "$bound_pid" >"$pid_file"
        return
      fi
      echo "[$name] runtime-gateway(pid=$bound_pid) 健康异常，正在以受管模式重启..."
      kill "$bound_pid" || true
      sleep 1
      if kill -0 "$bound_pid" 2>/dev/null; then
        kill -9 "$bound_pid" || true
      fi
    elif [[ "$name" == "frontend" ]] && is_frontend_process "$bound_pid"; then
      if [[ "$FRONTEND_BOOT_MODE" == "dev" ]] && is_frontend_standalone_process "$bound_pid"; then
        echo "[$name] 端口 $port 上存在旧前端(pid=$bound_pid)，当前以 dev 模式启动，准备重启为源码直跑。"
        kill "$bound_pid" || true
        sleep 1
        if kill -0 "$bound_pid" 2>/dev/null; then
          kill -9 "$bound_pid" || true
        fi
        wait_for_port_free "$port" 10 || true
      elif [[ -n "$health_url" ]] && is_healthy "$health_url"; then
        echo "[$name] 端口 $port 已由前端(pid=$bound_pid)提供服务，接管为受管进程。"
        echo "$bound_pid" >"$pid_file"
        return
      elif service_is_starting "$bound_pid" "$port"; then
        echo "[$name] 启动中（pid=$bound_pid, 端口=$port）"
        echo "$bound_pid" >"$pid_file"
        return
      else
        echo "[$name] 前端(pid=$bound_pid) 健康异常，正在以受管模式重启..."
        kill "$bound_pid" || true
        sleep 1
        if kill -0 "$bound_pid" 2>/dev/null; then
          kill -9 "$bound_pid" || true
        fi
        wait_for_port_free "$port" 10 || true
      fi
    elif [[ "$name" == "control-api" ]] && is_control_api_process "$bound_pid"; then
      if service_is_starting "$bound_pid" "$port"; then
        echo "[$name] 启动中（pid=$bound_pid, 端口=$port）"
        echo "$bound_pid" >"$pid_file"
        return
      fi
      echo "[$name] 端口 $port 上存在旧 control-api(pid=$bound_pid)，准备重启为 watch 模式。"
      kill "$bound_pid" || true
      sleep 1
      if kill -0 "$bound_pid" 2>/dev/null; then
        kill -9 "$bound_pid" || true
      fi
      wait_for_port_free "$port" 10 || true
    else
      echo "[$name] 端口 $port 被 pid=$bound_pid 占用，且不受本脚本管理。"
      if [[ -n "$health_url" ]] && is_healthy "$health_url"; then
        echo "[$name] 健康检查可用，但进程归属未知；为避免误判，已中止启动。"
      else
        echo "[$name] 健康检查不可用，已中止启动。"
      fi
      exit 1
    fi
  fi

  echo "[$name] 正在启动，端口 $port..."
  : >"$log_file"
  if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1; then
    tmux new-session -d -s "$session_name" -c "$workdir" "exec bash -lc $(printf '%q' "$cmd")"
    tmux pipe-pane -o -t "${session_name}:0.0" "cat >> $(printf '%q' "$log_file")"
  else
    (
      cd "$workdir"
      if command -v setsid >/dev/null 2>&1; then
        setsid bash -lc "$cmd" >"$log_file" 2>&1 < /dev/null &
      else
        nohup bash -lc "$cmd" >"$log_file" 2>&1 < /dev/null &
      fi
      echo $! >"$pid_file"
    )
  fi

  sleep 2
  wait_for_port_free "$port" 10 || true
  local new_pid raw_pid
  raw_pid=""
  if [[ -f "$pid_file" ]]; then
    raw_pid="$(cat "$pid_file")"
  fi
  local health_timeout
  health_timeout="$(service_health_timeout "$name")"

  if wait_for_health "$health_url" "$health_timeout"; then
    new_pid="$(resolve_managed_pid "$name" "$port" "$raw_pid")"
    if [[ -n "$new_pid" ]]; then
      echo "$new_pid" >"$pid_file"
    fi
    if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1; then
      echo "[$name] 已启动（pid=${new_pid:-unknown}, 会话=$session_name, 端口=$port, 日志=$log_file）"
    else
      echo "[$name] 已启动（pid=${new_pid:-unknown}, 端口=$port, 日志=$log_file）"
    fi
    return
  fi

  new_pid="$(resolve_managed_pid "$name" "$port" "$raw_pid")"
  echo "[$name] 健康检查失败：${health_url:-N/A}（等待 ${health_timeout}s）"
  if [[ -n "$new_pid" ]] && kill -0 "$new_pid" 2>/dev/null; then
    kill "$new_pid" || true
    sleep 1
    if kill -0 "$new_pid" 2>/dev/null; then
      kill -9 "$new_pid" || true
    fi
  fi
  if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    tmux kill-session -t "$session_name" 2>/dev/null || true
  fi
  rm -f "$pid_file"
  tail -40 "$log_file" >&2
  exit 1
}

# ── 启动各服务 ──────────────────────────────────────────
start_if_not_running "frontend" \
  "$FRONTEND_DIR" \
  "$FRONTEND_PORT" \
  "$(if [[ "$FRONTEND_BOOT_MODE" == "dev" ]]; then
      printf '%s' "node --max-old-space-size=1536 ./node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port $FRONTEND_PORT"
    else
      printf '%s' "PORT=$FRONTEND_PORT HOSTNAME=0.0.0.0 node --max-old-space-size=1536 .next/standalone/server.js"
    fi)"

start_if_not_running "control-api" \
  "$CONTROL_API_DIR" \
  "$CONTROL_API_PORT" \
  "PORT=$CONTROL_API_PORT DATABASE_URL=${DATABASE_URL:-postgresql://k8s_aiops:k8s_aiops_dev@localhost:5432/k8s_aiops} REDIS_URL=${REDIS_URL:-redis://localhost:6379} JWT_SECRET=${JWT_SECRET:-dev-secret-please-change-in-production} CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_GATEWAY_BASE_URL=ws://127.0.0.1:$RUNTIME_GATEWAY_PORT RUNTIME_TOKEN_SECRET=${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret} npx --no-install nest start --watch"

if [[ "$START_GATEWAY" == "true" ]]; then
  start_if_not_running "runtime-gateway" \
    "$RUNTIME_GATEWAY_DIR" \
    "$RUNTIME_GATEWAY_PORT" \
    "PORT=$RUNTIME_GATEWAY_PORT CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_TOKEN_SECRET=$RUNTIME_TOKEN_SECRET GOPROXY=$RUNTIME_GATEWAY_GOPROXY go run ./cmd/runtime-gateway"
else
  echo "[runtime-gateway] 已跳过（--no-gateway）"
fi

echo ""
echo "✔ 所有服务已启动"
echo "  前端:            http://localhost:$FRONTEND_PORT"
if [[ "$FRONTEND_BOOT_MODE" == "dev" ]]; then
  echo "  前端模式:        dev"
else
  echo "  前端模式:        stable"
fi
echo "  control-api:     http://localhost:$CONTROL_API_PORT"
echo "  swagger 文档:     http://localhost:$CONTROL_API_PORT/api/docs"
if [[ "$START_GATEWAY" == "true" ]]; then
  echo "  runtime-gateway: ws://localhost:$RUNTIME_GATEWAY_PORT"
fi
echo ""
echo "日志目录: $LOG_DIR"
echo "停止命令: bash scripts/dev-down.sh"
