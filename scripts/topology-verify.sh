#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FEATURE_DIR="$ROOT_DIR/.codex/specs/resource-topology-headlamp-parity"
TASKS_FILE="$FEATURE_DIR/tasks.md"
TOPOLOGY_FILE="$ROOT_DIR/frontend/src/app/network/topology/page.tsx"
CLEANUP_FILE="$ROOT_DIR/scripts/topology-clean-artifacts.sh"
AUTH_CLIENT_FILE="$ROOT_DIR/frontend/src/lib/api/client.ts"
AUTH_CONTEXT_FILE="$ROOT_DIR/frontend/src/components/auth-context.tsx"
SHELL_LAYOUT_FILE="$ROOT_DIR/frontend/src/components/shell-layout.tsx"

echo "[拓扑校验] 根目录=$ROOT_DIR"

failures=0

check_file() {
  local label="$1"
  local file="$2"

  if [[ -f "$file" ]]; then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 缺失 -> $file" >&2
  failures=$((failures + 1))
  return 1
}

check_pattern() {
  local label="$1"
  shift
  local pattern="$1"
  shift
  local files=("$@")

  if rg -n "$pattern" "${files[@]}" >/dev/null; then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 在 ${files[*]} 中缺少模式 /$pattern/" >&2
  failures=$((failures + 1))
  return 1
}

check_file "tasks file" "$TASKS_FILE"
check_file "topology page" "$TOPOLOGY_FILE"
check_file "cleanup script" "$CLEANUP_FILE"
check_file "auth client" "$AUTH_CLIENT_FILE"
check_file "auth context" "$AUTH_CONTEXT_FILE"
check_file "shell layout" "$SHELL_LAYOUT_FILE"

if [[ "$failures" -eq 0 ]]; then
  check_pattern "topology key functions" "resolveResourceDetailRequest|layoutComponentBlock|buildConnectedComponents|buildNamespaceCanvasEdges|applyNamespaceStackLayout" "$TOPOLOGY_FILE"
  check_pattern "connected component internals" "componentIdByNodeId|componentNodeIdsById|componentCanonicalNodeById" "$TOPOLOGY_FILE"
  check_pattern "focus / layout / detail paths" "focusedNodeId|focusedNamespaceId|focusVisibleNodeIds|layoutViewportKey|detailRequest|ResourceDetailDrawer" "$TOPOLOGY_FILE"
  check_pattern "fallback / timeout / auth-expired symbols" "service-unavailable|network-timeout|集群服务暂不可达|网络或超时异常|拓扑数据不可用|导航超时，点击重试|navigationTimeoutRef|navigationRetryRef|AUTH_EXPIRED_EVENT|aiops:auth-expired|authExpiredHandled|resetAuthExpiryState" \
    "$TOPOLOGY_FILE" "$AUTH_CLIENT_FILE" "$AUTH_CONTEXT_FILE" "$SHELL_LAYOUT_FILE"
  check_pattern "cleanup command hooks" "topology:clean-artifacts|topology:clean-artifacts:dry-run|topology:verify" "$ROOT_DIR/package.json"
  check_pattern "task list markers" "3\\.1|3\\.2|3\\.3|6\\.1|6\\.2|6\\.3" "$TASKS_FILE"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "[topology-verify] fail: $failures check(s) failed" >&2
  exit 1
fi

echo "[拓扑校验] 正常：所有静态回归检查通过"
