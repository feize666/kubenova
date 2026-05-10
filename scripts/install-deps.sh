#!/usr/bin/env bash
# install-deps.sh — 安装所有子项目依赖
# 用法: bash scripts/install-deps.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[安装] 正在安装前端依赖..."
npm --prefix "$ROOT_DIR/frontend" install

echo "[安装] 正在安装 control-api 依赖..."
npm --prefix "$ROOT_DIR/backend/control-api" install

if [[ -d "$ROOT_DIR/backend/runtime-gateway" ]]; then
  echo "[安装] 正在安装 runtime-gateway 依赖（go mod download）..."
  (cd "$ROOT_DIR/backend/runtime-gateway" && go mod download)
fi

echo ""
echo "✔ 所有依赖已安装"
