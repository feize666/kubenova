#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/_dev-env.sh"
load_dev_env_defaults

RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"

service_session_name() {
  local name="$1"
  echo "aiops-${name}"
}

tmux_session_exists() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null
}

service_health_url() {
  local name="$1" port="$2"
  case "$name" in
    frontend) echo "http://127.0.0.1:${port}/" ;;
    control-api) echo "http://127.0.0.1:${port}/api/capabilities" ;;
    runtime-gateway) echo "http://127.0.0.1:${port}/healthz" ;;
    *) echo "" ;;
  esac
}

listener_pid() {
  local port="$1"
  fuser -n tcp "$port" 2>/dev/null | awk '{print $1}'
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
  [[ "$cmdline" == *"frontend/.next/standalone/server.js"* || "$cmdline" == *"next/dist/bin/next start"* || "$cmdline" == *"next/dist/bin/next dev"* ]]
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

check_service() {
  local name="$1"
  local port="$2"
  local pid_file="$RUN_DIR/${name}.pid"
  local health_url
  health_url="$(service_health_url "$name" "$port")"
  local session_name
  session_name="$(service_session_name "$name")"
  local pid=""

  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$pid 端口=$port"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常"
      fi
      return
    fi
    rm -f "$pid_file"
    echo "[$name] 旧 pid 文件已清理"
  fi

  if command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    pid="$(listener_pid "$port" || true)"
    if [[ -n "$pid" ]]; then
      echo "$pid" >"$pid_file"
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常 会话=$session_name"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常 会话=$session_name"
      fi
    else
      echo "[$name] tmux 会话=$session_name 存在，但端口 $port 无监听"
    fi
    return
  fi

  pid="$(listener_pid "$port" || true)"
  if [[ -n "$pid" ]]; then
    if [[ "$name" == "frontend" ]] && is_frontend_process "$pid"; then
      echo "$pid" >"$pid_file"
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$pid 端口=$port（已接管）"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常（已接管）"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常（已接管）"
      fi
      return
    fi
    if [[ "$name" == "control-api" ]] && is_control_api_process "$pid"; then
      echo "$pid" >"$pid_file"
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$pid 端口=$port（已接管）"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常（已接管）"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常（已接管）"
      fi
      return
    fi
    if [[ "$name" == "runtime-gateway" ]] && is_runtime_gateway_process "$pid"; then
      echo "$pid" >"$pid_file"
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$pid 端口=$port（已接管）"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常（已接管）"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常（已接管）"
      fi
      return
    fi
    if is_healthy "$health_url"; then
      echo "[$name] 未受管监听 pid=$pid 端口=$port 健康=正常"
    else
      echo "[$name] 未受管监听 pid=$pid 端口=$port 健康=异常"
    fi
    return
  fi

  echo "[$name] 未运行"
}

check_service "frontend" "$FRONTEND_PORT"
check_service "control-api" "$CONTROL_API_PORT"
check_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"

echo "logs dir: $LOG_DIR"
