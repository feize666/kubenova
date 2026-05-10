#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
CONTROL_API_PORT="${CONTROL_API_PORT:-4000}"
RUNTIME_GATEWAY_PORT="${RUNTIME_GATEWAY_PORT:-4100}"

service_health_url() {
  local name="$1" port="$2"
  case "$name" in
    frontend) echo "http://127.0.0.1:${port}/" ;;
    control-api) echo "http://127.0.0.1:${port}/api/capabilities" ;;
    runtime-gateway) echo "http://127.0.0.1:${port}/healthz" ;;
    *) echo "" ;;
  esac
}

is_healthy() {
  local url="$1"
  [[ -n "$url" ]] || return 0
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

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      if is_healthy "$health_url"; then
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=正常"
      else
        echo "[$name] 运行中 pid=$pid 端口=$port 健康=异常"
      fi
      return
    fi
    rm -f "$pid_file"
  fi

  local pid=""
  pid="$(fuser -n tcp "$port" 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "$pid" ]]; then
    if is_healthy "$health_url"; then
      echo "[$name] 未受管监听 pid=$pid 端口=$port 健康=正常"
    else
      echo "[$name] 未受管监听 pid=$pid 端口=$port 健康=异常"
    fi
    return
  fi

  echo "[$name] 未运行"
}

check_service frontend "$FRONTEND_PORT"
check_service control-api "$CONTROL_API_PORT"
check_service runtime-gateway "$RUNTIME_GATEWAY_PORT"

echo "日志目录: $LOG_DIR"
