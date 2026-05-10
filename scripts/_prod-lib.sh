#!/usr/bin/env bash

prod_lib::root_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

prod_lib::current_root() {
  local release_root="${RELEASE_BASE:-/opt/k8s-aiops-manager}"
  echo "${release_root}/current"
}

prod_lib::release_dir() {
  local version="$1"
  local release_root="${RELEASE_BASE:-/opt/k8s-aiops-manager}"
  echo "${release_root}/releases/${version}"
}

prod_lib::require_cmd() {
  local cmd="$1" pkg="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[错误] 未找到 '$cmd'，请先安装 $pkg。" >&2
    exit 1
  fi
}

prod_lib::reload_systemd() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
  fi
}

prod_lib::restart_services() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart aiops-runtime-gateway.service aiops-control-api.service
  fi
}
