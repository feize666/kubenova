#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/_prod-lib.sh"

TARGET_VERSION="${1:-}"
if [[ -z "$TARGET_VERSION" ]]; then
  echo "用法: bash scripts/prod-rollback.sh <version>" >&2
  exit 1
fi

RELEASE_DIR="$(prod_lib::release_dir "$TARGET_VERSION")"
CURRENT_LINK="$(prod_lib::current_root)"

prod_lib::require_cmd ln
prod_lib::require_cmd readlink
prod_lib::require_cmd systemctl "systemd"

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "[错误] 回滚目标版本不存在：$RELEASE_DIR" >&2
  exit 1
fi

echo "[回滚] 目标版本: $TARGET_VERSION"
echo "[回滚] 目标目录: $RELEASE_DIR"

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
prod_lib::reload_systemd
prod_lib::restart_services

echo "✔ 已回滚到版本 $TARGET_VERSION"
echo "  current: $(readlink -f "$CURRENT_LINK")"
