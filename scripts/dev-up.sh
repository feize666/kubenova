#!/usr/bin/env bash
# dev-up.sh — 一键启动所有开发服务
# 用法: bash scripts/dev-up.sh [--no-gateway] [--stable-frontend|--dev-frontend] [--stable-api|--dev-api]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/_dev-env.sh"
load_dev_env_defaults

FRONTEND_DIR="$ROOT_DIR/frontend"
CONTROL_API_DIR="$ROOT_DIR/backend/control-api"
RUNTIME_GATEWAY_DIR="$ROOT_DIR/backend/runtime-gateway"
RUN_DIR="$ROOT_DIR/.run"
CACHE_DIR="$RUN_DIR/cache"
mkdir -p "$CACHE_DIR"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"
RUNTIME_TOKEN_SECRET="${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret}"
RUNTIME_GATEWAY_GOPROXY="${RUNTIME_GATEWAY_GOPROXY:-https://goproxy.cn,direct}"
START_GATEWAY="${START_GATEWAY:-true}"
USE_TMUX="${USE_TMUX:-false}"
FRONTEND_BOOT_MODE="${FRONTEND_BOOT_MODE:-dev}"
CONTROL_API_BOOT_MODE="${CONTROL_API_BOOT_MODE:-dev}"
FRONTEND_DEV_BUNDLER="${FRONTEND_DEV_BUNDLER:-turbopack}"
FRONTEND_NODE_OPTIONS="${FRONTEND_NODE_OPTIONS:---max-old-space-size=1536}"
CONTROL_API_NODE_OPTIONS="${CONTROL_API_NODE_OPTIONS:---max-old-space-size=768}"
RUNTIME_GATEWAY_DEPS_STAMP="$CACHE_DIR/runtime-gateway-go-mod.download.stamp"
SERVICE_LOG_SUFFIX="dev"
source "$ROOT_DIR/scripts/_service-lib.sh"
service_lib_init

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --no-gateway) START_GATEWAY="false" ;;
    --stable-frontend) FRONTEND_BOOT_MODE="stable" ;;
    --dev-frontend) FRONTEND_BOOT_MODE="dev" ;;
    --stable-api) CONTROL_API_BOOT_MODE="stable" ;;
    --dev-api) CONTROL_API_BOOT_MODE="dev" ;;
  esac
done

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
  local mod_file="$RUNTIME_GATEWAY_DIR/go.mod"
  local sum_file="$RUNTIME_GATEWAY_DIR/go.sum"
  if [[ -f "$RUNTIME_GATEWAY_DEPS_STAMP" ]] && [[ ! "$RUNTIME_GATEWAY_DEPS_STAMP" -ot "$mod_file" ]] && [[ ! "$RUNTIME_GATEWAY_DEPS_STAMP" -ot "$sum_file" ]]; then
    echo "[预检] runtime-gateway 依赖缓存命中，跳过 go mod download"
    return
  fi
  echo "[预检] 正在检查 runtime-gateway 的 Go 依赖..."
  if ! (cd "$RUNTIME_GATEWAY_DIR" && GOPROXY="$RUNTIME_GATEWAY_GOPROXY" go mod download); then
    echo "[错误] runtime-gateway 依赖下载失败，请检查网络或代理后重试。" >&2
    echo "        已尝试 GOPROXY=$RUNTIME_GATEWAY_GOPROXY" >&2
    exit 1
  fi
  touch "$RUNTIME_GATEWAY_DEPS_STAMP"
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

clean_frontend_dev_cache() {
  if [[ "$FRONTEND_BOOT_MODE" != "dev" ]]; then
    return
  fi

  local bound_pid bound_cmdline
  bound_pid="$(fuser -n tcp "$FRONTEND_PORT" 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$bound_pid" ]]; then
    bound_cmdline="$(ps -p "$bound_pid" -o args= 2>/dev/null || true)"
    if [[ "$bound_cmdline" == *"next-server"* || "$bound_cmdline" == *"next/dist/bin/next dev"* ]]; then
      echo "[预检] 前端正在运行，跳过 dev 缓存清理"
      return
    fi
  fi

  local log_file
  log_file="$(service_log_file frontend)"
  local dev_dir="$FRONTEND_DIR/.next/dev"
  local manifest="$dev_dir/server/app/page/build-manifest.json"
  if [[ -d "$dev_dir" && ! -f "$manifest" ]]; then
    echo "[预检] 检测到前端 dev 缓存缺失构建清单，正在清理..."
    rm -rf "$dev_dir"
    return
  fi

  if [[ -f "$log_file" ]] && tail -n 200 "$log_file" 2>/dev/null | grep -Eq 'build-manifest\.json|Persisting failed:|Compaction failed:|ENOENT: no such file or directory, open .*/\.next/dev/'; then
    if [[ -d "$dev_dir" ]]; then
      echo "[预检] 检测到前端 dev 缓存异常，正在清理..."
      rm -rf "$dev_dir"
    fi
  fi
}

frontend_sources_newer_than() {
  local marker="$1"
  local paths=(
    "$FRONTEND_DIR/src"
    "$FRONTEND_DIR/public"
    "$FRONTEND_DIR/package.json"
    "$FRONTEND_DIR/package-lock.json"
    "$FRONTEND_DIR/next.config.ts"
    "$FRONTEND_DIR/next.config.js"
    "$FRONTEND_DIR/tsconfig.json"
  )
  local path
  for path in "${paths[@]}"; do
    [[ -e "$path" ]] || continue
    if find "$path" -newer "$marker" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done
  return 1
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
    if frontend_sources_newer_than "$server_js"; then
      echo "[预检] 检测到前端源码比 standalone 包更新，正在重建稳定包..."
      rm -rf "$FRONTEND_DIR/.next/standalone"
    else
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
  fi

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

prepare_control_api_standalone() {
  if [[ "$CONTROL_API_BOOT_MODE" != "stable" ]]; then
    return
  fi

  local server_js="$CONTROL_API_DIR/dist/src/main.js"
  if [[ -f "$server_js" ]]; then
    local changed=""
    changed="$(find "$CONTROL_API_DIR/src" "$CONTROL_API_DIR/package.json" "$CONTROL_API_DIR/tsconfig.json" -newer "$server_js" -print -quit 2>/dev/null || true)"
    if [[ -z "$changed" ]]; then
      return
    fi
  fi

  echo "[预检] control-api stable 包缺失或过期，正在构建..."
  if ! (cd "$CONTROL_API_DIR" && npm run build); then
    echo "[错误] control-api stable 包构建失败，请查看构建输出。" >&2
    exit 1
  fi
}

# ── 服务健康检查 ────────────────────────────────────────
wait_for_postgres() {
  local db_url="${DATABASE_URL:-postgresql://kubenova:kubenova_dev@localhost:5432/kubenova}"
  local check_url="${db_url%%\?*}"
  echo "[预检] 正在检查 PostgreSQL..."
  if ! psql "$check_url" -c "SELECT 1" &>/dev/null; then
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
clean_frontend_dev_cache
prepare_frontend_standalone
prepare_control_api_standalone

# ── 进程管理 ────────────────────────────────────────────
cleanup_orphan_processes() {
  local name="$1" port="$2"
  local pid_file
  pid_file="$(service_pid_file "$name")"

  local managed_pid=""
  if [[ -f "$pid_file" ]]; then
    managed_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$managed_pid" ]] && kill -0 "$managed_pid" 2>/dev/null; then
      return
    fi
    rm -f "$pid_file"
  fi

  local bound_pid
  bound_pid="$(listener_pid "$port" || true)"
  if [[ -n "$bound_pid" ]]; then
    return
  fi

  local pids=()
  case "$name" in
    frontend)
      mapfile -t pids < <(pgrep -f "$FRONTEND_DIR/.next/standalone/server.js|$FRONTEND_DIR/node_modules/next/dist/bin/next dev|dev-supervise.sh frontend" 2>/dev/null || true)
      ;;
    control-api)
      mapfile -t pids < <(pgrep -f "$CONTROL_API_DIR/node_modules/.bin/nest start --watch|cd $CONTROL_API_DIR|$CONTROL_API_DIR/dist/src/main" 2>/dev/null || true)
      ;;
    runtime-gateway)
      mapfile -t pids < <(pgrep -f "$RUNTIME_GATEWAY_DIR|cmd/runtime-gateway|runtime-gateway" 2>/dev/null || true)
      ;;
  esac

  for pid in "${pids[@]}"; do
    [[ "$pid" != "$$" ]] || continue
    [[ "$pid" != "$managed_pid" ]] || continue
    if [[ "$name" == "frontend" ]] && ! is_frontend_process "$pid"; then
      continue
    fi
    if [[ "$name" == "control-api" ]] && ! is_control_api_process "$pid"; then
      continue
    fi
    if [[ "$name" == "runtime-gateway" ]] && ! is_runtime_gateway_process "$pid"; then
      continue
    fi
    echo "[$name] 清理无端口监听的残留进程 pid=$pid"
    terminate_pid "$pid"
  done
}

start_if_not_running() {
  local name="$1"
  local workdir="$2"
  local port="$3"
  local cmd="$4"
  local pid_file
  pid_file="$(service_pid_file "$name")"
  local child_pid_file
  child_pid_file="$(service_child_pid_file "$name")"
  local log_file
  log_file="$(service_log_file "$name")"
  local session_name
  session_name="$(service_session_name "$name")"
  local health_url
  health_url="$(service_health_url "$name" "$port")"

  cleanup_orphan_processes "$name" "$port"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      if [[ "$name" == "frontend" && "$FRONTEND_BOOT_MODE" == "dev" ]] && is_frontend_standalone_process "$pid"; then
        echo "[$name] pid=$pid 是旧 standalone 前端，当前以 dev 模式启动，正在重启为源码直跑..."
        terminate_pid "$pid"
        rm -f "$child_pid_file"
        wait_for_port_free "$port" 10 || true
        rm -f "$pid_file"
      else
        if is_healthy "$health_url"; then
          echo "[$name] 已在运行（pid=$pid, 端口=$port）"
          return
        fi
        if service_is_starting "$pid" "$port"; then
          echo "[$name] 启动中（pid=$pid, 端口=$port）"
          return
        fi
        echo "[$name] pid=$pid 仍在，但健康检查失败，正在重启..."
        terminate_pid "$pid"
        rm -f "$child_pid_file"
        wait_for_port_free "$port" 10 || true
      fi
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
      terminate_pid "$bound_pid"
    elif [[ "$name" == "frontend" ]] && is_frontend_process "$bound_pid"; then
      if [[ "$FRONTEND_BOOT_MODE" == "dev" ]] && is_frontend_standalone_process "$bound_pid"; then
        echo "[$name] 端口 $port 上存在旧前端(pid=$bound_pid)，当前以 dev 模式启动，准备重启为源码直跑。"
        terminate_pid "$bound_pid"
        wait_for_port_free "$port" 10 || true
      elif [[ -n "$health_url" ]] && is_healthy "$health_url"; then
        echo "[$name] 端口 $port 已由前端(pid=$bound_pid)提供服务，接管为受管进程。"
        echo "$bound_pid" >"$child_pid_file"
        echo "$bound_pid" >"$pid_file"
        return
      elif service_is_starting "$bound_pid" "$port"; then
        echo "[$name] 启动中（pid=$bound_pid, 端口=$port）"
        echo "$bound_pid" >"$child_pid_file"
        echo "$bound_pid" >"$pid_file"
        return
      else
        echo "[$name] 前端(pid=$bound_pid) 健康异常，正在以受管模式重启..."
        terminate_pid "$bound_pid"
        rm -f "$child_pid_file"
        wait_for_port_free "$port" 10 || true
      fi
    elif [[ "$name" == "control-api" ]] && is_control_api_process "$bound_pid"; then
      if service_is_starting "$bound_pid" "$port"; then
        echo "[$name] 启动中（pid=$bound_pid, 端口=$port）"
        echo "$bound_pid" >"$pid_file"
        return
      fi
      echo "[$name] 端口 $port 上存在旧 control-api(pid=$bound_pid)，准备重启为 $CONTROL_API_BOOT_MODE 模式。"
      terminate_pid "$bound_pid"
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
  ensure_service_log_dir "$name"
  : >"$log_file"
  if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1; then
    tmux new-session -d -s "$session_name" -c "$workdir" "exec bash -lc $(printf '%q' "$cmd")"
    tmux pipe-pane -o -t "${session_name}:0.0" "cat >> $(printf '%q' "$log_file")"
  else
    (
      cd "$workdir"
      local launch_cmd="$cmd"
      if [[ "$name" == "frontend" && "$FRONTEND_BOOT_MODE" == "dev" ]]; then
        launch_cmd="$ROOT_DIR/scripts/dev-supervise.sh frontend $(printf '%q' "$child_pid_file") $(printf '%q' "$cmd")"
      fi
      if command -v setsid >/dev/null 2>&1; then
        setsid bash -lc "$launch_cmd" >"$log_file" 2>&1 < /dev/null &
      else
        nohup bash -lc "$launch_cmd" >"$log_file" 2>&1 < /dev/null &
      fi
      echo $! >"$pid_file"
    )
  fi

  sleep 2
  local new_pid raw_pid
  raw_pid=""
  if [[ -f "$pid_file" ]]; then
    raw_pid="$(cat "$pid_file")"
  fi
  local health_timeout
  health_timeout="$(service_health_timeout "$name")"

  if wait_for_health "$health_url" "$health_timeout"; then
    new_pid="$(resolve_managed_pid "$name" "$port" "$raw_pid")"
    if service_uses_supervisor "$name"; then
      if [[ -n "$raw_pid" ]]; then
        echo "$raw_pid" >"$pid_file"
      fi
      if [[ -n "$new_pid" ]]; then
        echo "$new_pid" >"$child_pid_file"
      fi
    elif [[ -n "$new_pid" ]]; then
      echo "$new_pid" >"$pid_file"
    fi
    if [[ "$USE_TMUX" == "true" ]] && command -v tmux >/dev/null 2>&1; then
      echo "[$name] 已启动（pid=${new_pid:-unknown}, 会话=$session_name, 端口=$port, 日志=$log_file）"
    else
      if service_uses_supervisor "$name"; then
        echo "[$name] 已启动（supervisor=${raw_pid:-unknown}, pid=${new_pid:-unknown}, 端口=$port, 日志=$log_file）"
      else
        echo "[$name] 已启动（pid=${new_pid:-unknown}, 端口=$port, 日志=$log_file）"
      fi
    fi
    return
  fi

  new_pid="$(resolve_managed_pid "$name" "$port" "$raw_pid")"
  echo "[$name] 健康检查失败：${health_url:-N/A}（等待 ${health_timeout}s）"
  terminate_pid "$raw_pid"
  if [[ "$new_pid" != "$raw_pid" ]]; then
    terminate_pid "$new_pid"
  fi
  rm -f "$child_pid_file"
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
      bundler_flag=""
      if [[ "$FRONTEND_DEV_BUNDLER" == "webpack" ]]; then
        bundler_flag=" --webpack"
      elif [[ "$FRONTEND_DEV_BUNDLER" == "turbopack" ]]; then
        bundler_flag=" --turbo"
      fi
      printf '%s' "NODE_OPTIONS='$FRONTEND_NODE_OPTIONS' ./node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port $FRONTEND_PORT$bundler_flag"
    else
      printf '%s' "PORT=$FRONTEND_PORT HOSTNAME=0.0.0.0 NODE_OPTIONS='$FRONTEND_NODE_OPTIONS' node .next/standalone/server.js"
    fi)"

start_if_not_running "control-api" \
  "$CONTROL_API_DIR" \
  "$CONTROL_API_PORT" \
  "$(if [[ "$CONTROL_API_BOOT_MODE" == "stable" ]]; then
      printf '%s' "PORT=$CONTROL_API_PORT DATABASE_URL=${DATABASE_URL:-postgresql://kubenova:kubenova_dev@localhost:5432/kubenova} REDIS_URL=${REDIS_URL:-redis://localhost:6379} JWT_SECRET=${JWT_SECRET:-dev-secret-please-change-in-production} CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_GATEWAY_BASE_URL=${RUNTIME_GATEWAY_BASE_URL:-ws://127.0.0.1:$RUNTIME_GATEWAY_PORT} RUNTIME_TOKEN_SECRET=${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret} NODE_OPTIONS='$CONTROL_API_NODE_OPTIONS' node dist/src/main.js"
    else
      printf '%s' "PORT=$CONTROL_API_PORT DATABASE_URL=${DATABASE_URL:-postgresql://kubenova:kubenova_dev@localhost:5432/kubenova} REDIS_URL=${REDIS_URL:-redis://localhost:6379} JWT_SECRET=${JWT_SECRET:-dev-secret-please-change-in-production} CONTROL_API_BASE_URL=http://127.0.0.1:$CONTROL_API_PORT RUNTIME_GATEWAY_BASE_URL=${RUNTIME_GATEWAY_BASE_URL:-ws://127.0.0.1:$RUNTIME_GATEWAY_PORT} RUNTIME_TOKEN_SECRET=${RUNTIME_TOKEN_SECRET:-dev-runtime-token-secret} NODE_OPTIONS='$CONTROL_API_NODE_OPTIONS' npx --no-install nest start --watch"
    fi)"

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
echo "  前端内存:        NODE_OPTIONS=$FRONTEND_NODE_OPTIONS（内存紧张可用 --stable-frontend）"
echo "  control-api:     http://localhost:$CONTROL_API_PORT"
echo "  control-api 模式: $CONTROL_API_BOOT_MODE"
echo "  control-api 内存: NODE_OPTIONS=$CONTROL_API_NODE_OPTIONS（内存紧张可用 --stable-api）"
echo "  swagger 文档:     http://localhost:$CONTROL_API_PORT/api/docs"
if [[ "$START_GATEWAY" == "true" ]]; then
  echo "  runtime-gateway: ws://localhost:$RUNTIME_GATEWAY_PORT"
fi
echo ""
service_log_dirs_summary
echo "停止命令: bash scripts/dev-down.sh"
