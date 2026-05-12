#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/_dev-env.sh"
load_dev_env_defaults

RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

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

process_cmdline() {
  local pid="$1"
  ps -p "$pid" -o args= 2>/dev/null || true
}

wait_for_port_free() {
  local port="$1"
  local retries="${2:-10}"
  for _ in $(seq 1 "$retries"); do
    if ! fuser -n tcp "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
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
  if [[ -n "$port" ]] && ss -ltnp "( sport = :$port )" 2>/dev/null | grep -Eq "pid=$pid"; then
    return 1
  fi
  local stat
  stat="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -n "$stat" ]]
}

stop_service() {
  local name="$1"
  local pid_file="$RUN_DIR/${name}.pid"
  local port="$2"
  local session_name
  session_name="$(service_session_name "$name")"

  if command -v tmux >/dev/null 2>&1 && tmux_session_exists "$session_name"; then
    echo "[$name] 正在停止 tmux 会话 '$session_name'..."
    tmux kill-session -t "$session_name" 2>/dev/null || true
    rm -f "$pid_file"
    sleep 1
  fi

  if [[ ! -f "$pid_file" ]]; then
    local bound_pid
    bound_pid="$(fuser -n tcp "$port" 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "$bound_pid" ]]; then
      if [[ "$name" == "runtime-gateway" ]] && is_runtime_gateway_process "$bound_pid"; then
        echo "[$name] 无 pid 文件，接管 runtime-gateway pid=$bound_pid 以执行关闭。"
        echo "$bound_pid" >"$pid_file"
      elif [[ "$name" == "frontend" ]] && is_frontend_process "$bound_pid"; then
        echo "[$name] 无 pid 文件，接管前端 pid=$bound_pid 以执行关闭。"
        echo "$bound_pid" >"$pid_file"
      elif [[ "$name" == "control-api" ]] && is_control_api_process "$bound_pid"; then
        echo "[$name] 无 pid 文件，接管 control-api pid=$bound_pid 以执行关闭。"
        echo "$bound_pid" >"$pid_file"
      else
        echo "[$name] 无 pid 文件，但端口 $port 被 pid=$bound_pid 占用（未受管）"
      fi
    else
      echo "[$name] 未运行（无 pid 文件）"
    fi
    if [[ ! -f "$pid_file" ]]; then
      return
    fi
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    if service_is_starting "$pid" "$port"; then
      echo "[$name] 启动中（pid=$pid, 端口=$port），仍执行停止。"
    fi
    echo "[$name] 正在停止（pid=$pid）..."
    kill "$pid" || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      echo "[$name] 正在强制终止（pid=$pid）..."
      kill -9 "$pid" || true
    fi
    wait_for_port_free "$port" 10 || true
    echo "[$name] 已停止"
  else
    echo "[$name] 旧 pid 文件（进程已退出）"
  fi

  rm -f "$pid_file"
}

stop_service "frontend" "$FRONTEND_PORT"
stop_service "control-api" "$CONTROL_API_PORT"
stop_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
