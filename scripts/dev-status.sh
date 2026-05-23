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
FRONTEND_BOOT_MODE="${FRONTEND_BOOT_MODE:-dev}"
USE_TMUX="${USE_TMUX:-false}"

stream_match() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -q -- "$pattern"
  else
    grep -Eq -- "$pattern"
  fi
}

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
  if [[ -n "$port" ]] && ss -ltnp "( sport = :$port )" 2>/dev/null | stream_match "pid=$pid"; then
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
  local pid_file
  pid_file="$(service_pid_file "$name")"
  local child_pid_file
  child_pid_file="$(service_child_pid_file "$name")"
  local health_url
  health_url="$(service_health_url "$name" "$port")"
  local session_name
  session_name="$(service_session_name "$name")"
  local pid=""

  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      local display_pid="$pid"
      if service_uses_supervisor "$name" && [[ -f "$child_pid_file" ]]; then
        local child_pid
        child_pid="$(cat "$child_pid_file")"
        if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
          display_pid="$pid child=$child_pid"
        fi
      fi
      if service_uses_supervisor "$name"; then
        local listener
        listener="$(listener_pid "$port" || true)"
        if [[ -n "$listener" ]] && is_frontend_process "$listener"; then
          display_pid="$display_pid listener=$listener"
        fi
      fi
      if service_uses_supervisor "$name" && is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$display_pid 端口=$port 健康=正常"
        return
      fi
      if service_is_starting "$pid" "$port"; then
        echo "[$name] 启动中 pid=$display_pid 端口=$port"
        return
      fi
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$display_pid 端口=$port 健康=正常"
      else
        echo "[$name] 运行中 pid=$display_pid 端口=$port 健康=异常"
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
