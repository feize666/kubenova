#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"

stop_pid_file() {
  local name="$1"
  local pid_file="$RUN_DIR/${name}.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "[$name] 未运行（无 pid 文件）"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "[$name] 正在停止（pid=$pid）..."
    kill "$pid" || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      echo "[$name] 正在强制终止（pid=$pid）..."
      kill -9 "$pid" || true
    fi
    echo "[$name] 已停止"
  else
    echo "[$name] 旧 pid 文件（进程已退出）"
  fi

  rm -f "$pid_file"
}

stop_pid_file frontend
stop_pid_file control-api
stop_pid_file runtime-gateway
