#!/usr/bin/env bash
set -euo pipefail

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop aiops-runtime-gateway.service >/dev/null 2>&1 || true
  systemctl stop aiops-control-api.service >/dev/null 2>&1 || true
  systemctl daemon-reload || true
fi
