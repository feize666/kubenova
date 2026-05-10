#!/usr/bin/env bash
set -euo pipefail

ENV_DIR="${ENV_DIR:-/etc/k8s-aiops-manager}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/usr/lib/systemd/system}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop aiops-runtime-gateway.service >/dev/null 2>&1 || true
  systemctl stop aiops-control-api.service >/dev/null 2>&1 || true
  systemctl disable aiops.target >/dev/null 2>&1 || true
fi

rm -f "$SYSTEMD_DIR/aiops.target" \
      "$SYSTEMD_DIR/aiops-control-api.service" \
      "$SYSTEMD_DIR/aiops-runtime-gateway.service"

rm -f "$ENV_DIR/control-api.env" \
      "$ENV_DIR/runtime-gateway.env"

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

echo "✔ systemd 与环境模板已卸载"
