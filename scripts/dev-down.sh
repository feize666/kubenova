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
FRONTEND_BOOT_MODE="${FRONTEND_BOOT_MODE:-dev}"
USE_TMUX="${USE_TMUX:-false}"

service_session_name() {
  local name="$1"
  echo "aiops-${name}"
}

service_pid_file() {
  local name="$1"
  if [[ "$name" == "frontend" && "$FRONTEND_BOOT_MODE" == "dev" && "$USE_TMUX" != "true" ]]; then
    echo "$RUN_DIR/${name}.supervisor.pid"
  else
    echo "$RUN_DIR/${name}.pid"
  fi
}

service_child_pid_file() {
  local name="$1"
  echo "$RUN_DIR/${name}.pid"
}

service_uses_supervisor() {
  local name="$1"
  [[ "$name" == "frontend" && "$FRONTEND_BOOT_MODE" == "dev" && "$USE_TMUX" != "true" ]]
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

terminate_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
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
  [[ "$cmdline" == *"dev-supervise.sh frontend"* || "$cmdline" == *"next-server"* || "$cmdline" == *"frontend/.next/standalone/server.js"* || "$cmdline" == *"next/dist/bin/next start"* || "$cmdline" == *"next/dist/bin/next dev"* ]]
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
  local pid_file
  pid_file="$(service_pid_file "$name")"
  local child_pid_file
  child_pid_file="$(service_child_pid_file "$name")"
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
    terminate_pid "$pid"
    if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
      local child_pid
      child_pid="$(cat "$child_pid_file")"
      if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
        echo "[$name] 正在停止子进程（pid=$child_pid）..."
        terminate_pid "$child_pid"
      fi
    fi
    if service_uses_supervisor "$name"; then
      local listener_pid_now
      listener_pid_now="$(fuser -n tcp "$port" 2>/dev/null | awk '{print $1}' || true)"
      if [[ -n "$listener_pid_now" ]] && is_frontend_process "$listener_pid_now"; then
        echo "[$name] 正在停止监听进程（pid=$listener_pid_now）..."
        terminate_pid "$listener_pid_now"
      fi
    fi
    wait_for_port_free "$port" 10 || true
    echo "[$name] 已停止"
  else
    echo "[$name] 旧 pid 文件（进程已退出）"
  fi

  rm -f "$pid_file"
  if service_uses_supervisor "$name"; then
    rm -f "$child_pid_file"
  fi
}

stop_service "frontend" "$FRONTEND_PORT"
stop_service "control-api" "$CONTROL_API_PORT"
stop_service "runtime-gateway" "$RUNTIME_GATEWAY_PORT"
