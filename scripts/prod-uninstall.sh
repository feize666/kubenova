#!/usr/bin/env bash
set -euo pipefail

ENV_DIR="${ENV_DIR:-/etc/kubenova}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/usr/lib/systemd/system}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop kubenova-runtime-gateway.service >/dev/null 2>&1 || true
  systemctl stop kubenova-control-api.service >/dev/null 2>&1 || true
  systemctl disable kubenova.target >/dev/null 2>&1 || true
fi

rm -f "$SYSTEMD_DIR/kubenova.target" \
      "$SYSTEMD_DIR/kubenova-control-api.service" \
      "$SYSTEMD_DIR/kubenova-runtime-gateway.service"

rm -f "$ENV_DIR/control-api.env" \
      "$ENV_DIR/runtime-gateway.env"

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

echo "✔ systemd 与环境模板已卸载"
