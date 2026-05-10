#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/_prod-lib.sh"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "用法: bash scripts/prod-switch.sh <version>" >&2
  exit 1
fi

RELEASE_DIR="$(prod_lib::release_dir "$VERSION")"
CURRENT_LINK="$(prod_lib::current_root)"

prod_lib::require_cmd ln
prod_lib::require_cmd readlink
prod_lib::require_cmd systemctl "systemd"

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "[错误] 版本目录不存在：$RELEASE_DIR" >&2
  exit 1
fi

if [[ ! -x "$RELEASE_DIR/runtime-gateway/runtime-gateway" ]]; then
  echo "[错误] runtime-gateway 缺少可执行文件：$RELEASE_DIR/runtime-gateway/runtime-gateway" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_DIR/control-api/dist/src/main.js" ]]; then
  echo "[错误] control-api 缺少构建产物：$RELEASE_DIR/control-api/dist/src/main.js" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_DIR/frontend/.next/standalone/server.js" ]]; then
  echo "[错误] 前端缺少 standalone 包：$RELEASE_DIR/frontend/.next/standalone/server.js" >&2
  exit 1
fi

if [[ ! -d "$RELEASE_DIR/frontend/.next/standalone/.next/static" ]]; then
  echo "[错误] 前端缺少静态资源：$RELEASE_DIR/frontend/.next/standalone/.next/static" >&2
  exit 1
fi

PREVIOUS_VERSION=""
if [[ -L "$CURRENT_LINK" || -e "$CURRENT_LINK" ]]; then
  PREVIOUS_VERSION="$(readlink -f "$CURRENT_LINK" || true)"
fi

echo "[切换] 当前版本: ${PREVIOUS_VERSION:-未设置}"
echo "[切换] 目标版本: $VERSION"

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
prod_lib::reload_systemd
prod_lib::restart_services

echo "✔ 已切换到版本 $VERSION"
echo "  current: $(readlink -f "$CURRENT_LINK")"
