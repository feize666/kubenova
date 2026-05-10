#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${SYSTEMD_DIR:-/usr/lib/systemd/system}"
ENV_DIR="${ENV_DIR:-/etc/k8s-aiops-manager}"
RELEASE_ROOT="${RELEASE_ROOT:-/opt/k8s-aiops-manager}"
CURRENT_DIR="${CURRENT_DIR:-${RELEASE_ROOT}/current}"

require_cmd() {
  local cmd="$1" pkg="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[错误] 未找到 '$cmd'，请先安装 $pkg。" >&2
    exit 1
  fi
}

require_cmd install
require_cmd systemctl "systemd"
require_cmd ln
require_cmd mkdir

install -d -m 0755 "$ENV_DIR"
install -d -m 0755 "$RELEASE_ROOT"

if [[ ! -d "$CURRENT_DIR" ]]; then
  echo "[错误] 当前发布目录不存在：$CURRENT_DIR" >&2
  exit 1
fi

install -m 0644 "$ROOT_DIR/deploy/systemd/aiops.target" "$SYSTEMD_DIR/aiops.target"
install -m 0644 "$ROOT_DIR/deploy/systemd/aiops-control-api.service" "$SYSTEMD_DIR/aiops-control-api.service"
install -m 0644 "$ROOT_DIR/deploy/systemd/aiops-runtime-gateway.service" "$SYSTEMD_DIR/aiops-runtime-gateway.service"

install -m 0644 "$ROOT_DIR/deploy/systemd/env/control-api.env.example" "$CURRENT_DIR/env/control-api.env.example"
install -m 0644 "$ROOT_DIR/deploy/systemd/env/runtime-gateway.env.example" "$CURRENT_DIR/env/runtime-gateway.env.example"

if [[ ! -f "$ENV_DIR/control-api.env" ]]; then
  install -m 0644 "$ROOT_DIR/deploy/systemd/env/control-api.env.example" "$ENV_DIR/control-api.env"
fi

if [[ ! -f "$ENV_DIR/runtime-gateway.env" ]]; then
  install -m 0644 "$ROOT_DIR/deploy/systemd/env/runtime-gateway.env.example" "$ENV_DIR/runtime-gateway.env"
fi

systemctl daemon-reload
systemctl enable aiops.target >/dev/null 2>&1 || true
systemctl enable aiops-control-api.service >/dev/null 2>&1 || true
systemctl enable aiops-runtime-gateway.service >/dev/null 2>&1 || true

echo "✔ systemd 与环境模板安装完成"
echo "  单元目录: $SYSTEMD_DIR"
echo "  环境目录: $ENV_DIR"
echo "  发布目录: $CURRENT_DIR"
