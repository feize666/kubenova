#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

TARGETS=(
  "$ROOT_DIR/.playwright-mcp"
  "$ROOT_DIR/tmp-topology-default.md"
  "$ROOT_DIR/tmp-topology-default.png"
)

echo "[topology-clean] root=$ROOT_DIR dry_run=$DRY_RUN"

for target in "${TARGETS[@]}"; do
  if [[ ! -e "$target" ]]; then
    continue
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[topology-clean] would remove: $target"
    continue
  fi
  rm -rf "$target"
  echo "[topology-clean] removed: $target"
done

echo "[topology-clean] done"
