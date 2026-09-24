#!/usr/bin/env bash
# readme-sync-check.sh — 代码变更必须同步更新 README.md
#
# 用法:
#   bash scripts/readme-sync-check.sh              # 校验已暂存内容（pre-commit 用）
#   bash scripts/readme-sync-check.sh --range A..B # 校验提交区间（CI 用）
#
# 跳过:
#   KUBENOVA_SKIP_README_CHECK=1 bash scripts/readme-sync-check.sh
#   git commit --no-verify
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${KUBENOVA_SKIP_README_CHECK:-}" == "1" ]]; then
  echo "[readme-sync] 已跳过（KUBENOVA_SKIP_README_CHECK=1）"
  exit 0
fi

range=""
if [[ "${1:-}" == "--range" ]]; then
  range="${2:-}"
  [[ -n "$range" ]] || { echo "[readme-sync] --range 需要提交区间，例如 v1.7..HEAD" >&2; exit 2; }
fi

if [[ -n "$range" ]]; then
  changed="$(git diff --name-only --diff-filter=ACMR "$range" 2>/dev/null || true)"
else
  changed="$(git diff --cached --name-only --diff-filter=ACMR)"
fi

[[ -n "$changed" ]] || exit 0

readme_touched="false"
needs_readme="false"
details=""

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  case "$f" in
    README.md)
      readme_touched="true"
      continue
      ;;
  esac
  case "$f" in
    frontend/src/*|frontend/app/*|frontend/components/*)
      needs_readme="true"; details="$details
  - $f" ;;
    backend/*|scripts/*|deploy/*|k8s/*)
      needs_readme="true"; details="$details
  - $f" ;;
    frontend/package.json|frontend/next.config.ts|frontend/Dockerfile|frontend/next-env.d.ts)
      needs_readme="true"; details="$details
  - $f" ;;
    package.json|Dockerfile|docker-compose.yml|docker-compose.yaml)
      needs_readme="true"; details="$details
  - $f" ;;
  esac
done <<< "$changed"

if [[ "$needs_readme" == "true" && "$readme_touched" != "true" ]]; then
  echo "" >&2
  echo "[readme-sync] 检测到功能/配置/部署相关改动，但本次未更新 README.md：" >&2
  printf '%s\n' "$details" >&2
  echo "" >&2
  echo "  请在同一次提交中更新 README.md；若本次确实无需改动文档，可显式跳过：" >&2
  echo "    KUBENOVA_SKIP_README_CHECK=1 git commit ..." >&2
  echo "    git commit --no-verify ..." >&2
  echo "" >&2
  exit 1
fi

if [[ "$readme_touched" == "true" ]]; then
  echo "[readme-sync] README.md 已在本次改动中更新"
else
  echo "[readme-sync] 本次改动不涉及需要同步 README 的路径"
fi
