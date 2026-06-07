#!/usr/bin/env bash
set -euo pipefail

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop kubenova-runtime-gateway.service >/dev/null 2>&1 || true
  systemctl stop kubenova-control-api.service >/dev/null 2>&1 || true
  systemctl daemon-reload || true
fi
