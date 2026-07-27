#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FEATURE_DIR="${TOPOLOGY_SPEC_DIR:-$ROOT_DIR/.codex/specs/ops-console-unified-experience}"
SPEC_TASKS_FILE="$FEATURE_DIR/tasks.md"
SLICE_TASKS_FILE="$ROOT_DIR/docs/parallel-execution-tasks.md"
TASKS_FILE="$SPEC_TASKS_FILE"
if [[ ! -f "$TASKS_FILE" && -f "$SLICE_TASKS_FILE" ]]; then
  TASKS_FILE="$SLICE_TASKS_FILE"
fi
TOPOLOGY_FILE="$ROOT_DIR/frontend/src/app/network/topology/page.tsx"
SERVICE_FILE="$ROOT_DIR/scripts/service.sh"
AUTH_CLIENT_FILE="$ROOT_DIR/frontend/src/lib/api/client.ts"
AUTH_CONTEXT_FILE="$ROOT_DIR/frontend/src/components/auth-context.tsx"
SHELL_LAYOUT_FILE="$ROOT_DIR/frontend/src/components/shell-layout.tsx"
REALTIME_BRIDGE_FILE="$ROOT_DIR/frontend/src/components/realtime-sync-bridge.tsx"
REALTIME_UTILS_FILE="$ROOT_DIR/frontend/src/components/realtime-sync-utils.ts"
RESOURCE_REFRESH_FILE="$ROOT_DIR/frontend/src/lib/resource-list-refresh.ts"
TOPOLOGY_V2_CAPACITY_SPEC="$ROOT_DIR/backend/control-api/src/topology-graph/topology-graph.capacity.spec.ts"
TOPOLOGY_V2_CAPACITY_SCRIPT="$ROOT_DIR/frontend/scripts/topology-v2-capacity.mjs"
TOPOLOGY_V2_API_FILE="$ROOT_DIR/frontend/src/lib/api/topology-graph.ts"
TOPOLOGY_V2_CANVAS_FILE="$ROOT_DIR/frontend/src/modules/topology-kubejojo/TopologyCanvas.tsx"
TOPOLOGY_V2_CAPACITY_FILE="$ROOT_DIR/frontend/src/modules/topology-kubejojo/engine/capacity.ts"

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

check_no_pattern() {
  local label="$1"
  shift
  local pattern="$1"
  shift
  local files=("$@")
  local matches

  matches="$(rg -n "$pattern" "${files[@]}" || true)"
  if [[ -z "$matches" ]]; then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 命中禁用模式 /$pattern/" >&2
  echo "$matches" >&2
  failures=$((failures + 1))
  return 1
}

check_node_script() {
  local label="$1"
  local file="$2"

  if node --check "$file" >/dev/null && node "$file" >/dev/null; then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 无法通过 Node.js 语法/执行检查 -> $file" >&2
  failures=$((failures + 1))
  return 1
}

check_realtime_stream_guard() {
  local label="SSE stream single owner"
  local matches
  local invalid

  matches="$(rg -n "EventSource|text/event-stream|/api/v1/clusters/events/stream" "$ROOT_DIR/frontend/src" -g '*.ts' -g '*.tsx' || true)"
  invalid="$(printf '%s\n' "$matches" | awk -F: -v allowed="$REALTIME_BRIDGE_FILE" 'NF > 1 && $1 != allowed { print }')"

  if [[ -z "$invalid" ]] &&
    rg -n "text/event-stream" "$REALTIME_BRIDGE_FILE" >/dev/null &&
    rg -n "/api/v1/clusters/events/stream" "$REALTIME_BRIDGE_FILE" >/dev/null; then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 只允许 $REALTIME_BRIDGE_FILE 持有事件流路径/依赖" >&2
  if [[ -n "$invalid" ]]; then
    echo "$invalid" >&2
  fi
  failures=$((failures + 1))
  return 1
}

check_refresh_interval_guard() {
  local label="refresh interval floor"
  local min_ms=5000
  local bad=""
  local file line text value clean

  while IFS=: read -r file line text; do
    value="$(printf '%s\n' "$text" | sed -E 's/.*(refetchInterval|RESOURCE_LIST_REFRESH_INTERVAL_MS)[^0-9]*([0-9][0-9_]*).*/\2/')"
    clean="${value//_/}"
    if [[ "$clean" =~ ^[0-9]+$ ]] && (( clean < min_ms )); then
      bad+="$file:$line:$text"$'\n'
    fi
  done < <(rg -n "refetchInterval[[:space:]]*:[[:space:]]*[0-9][0-9_]*|RESOURCE_LIST_REFRESH_INTERVAL_MS[[:space:]]*=[[:space:]]*[0-9][0-9_]*" \
    "$ROOT_DIR/frontend/src/app" "$RESOURCE_REFRESH_FILE" || true)

  if [[ -z "$bad" ]]; then
    echo "[拓扑校验] 正常：$label >= ${min_ms}ms"
    return 0
  fi

  echo "[拓扑校验] 失败：$label 发现低于 ${min_ms}ms 的轮询配置" >&2
  printf '%s' "$bad" >&2
  failures=$((failures + 1))
  return 1
}

check_topology_query_key_guard() {
  local label="topology query key stability"

  if node - "$TOPOLOGY_FILE" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const failures = [];

function findArrayEnd(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function lineNumber(index) {
  return text.slice(0, index).split("\n").length;
}

const queryBlocks = [];
let searchIndex = 0;
while (true) {
  const queryIndex = text.indexOf("queryKey", searchIndex);
  if (queryIndex === -1) break;
  const openIndex = text.indexOf("[", queryIndex);
  if (openIndex === -1) break;
  const closeIndex = findArrayEnd(text, openIndex);
  if (closeIndex === -1) {
    failures.push(`queryKey at line ${lineNumber(queryIndex)} has no closing bracket.`);
    break;
  }
  const block = text.slice(openIndex, closeIndex + 1);
  if (block.includes("topology-") || block.includes("topology-map")) queryBlocks.push({ block, line: lineNumber(queryIndex) });
  searchIndex = closeIndex + 1;
}

const requiredKeys = [
  "clusters",
  "namespaces",
  "graph",
];
for (const key of requiredKeys) {
  if (!queryBlocks.some(({ block }) => block.includes(`"${key}"`) || block.includes(`'${key}'`))) {
    failures.push(`Missing topology queryKey ${key}.`);
  }
}

for (const { block, line } of queryBlocks) {
  const compact = block.replace(/\s+/g, " ");
  const unstablePatterns = [
    [/\{/, "object literal"],
    [/Math\.random|crypto\.randomUUID/, "random value"],
    [/Date\.now|new Date\(/, "time value"],
    [/JSON\.stringify/, "stringified object"],
  ];
  for (const [pattern, reason] of unstablePatterns) {
    if (pattern.test(block)) failures.push(`Unstable topology queryKey at line ${line}: ${reason}: ${compact}`);
  }
  if (
    /"graph"|'graph'/.test(block) &&
    !block.includes("selectedNamespace")
  ) {
    failures.push(`Topology queryKey at line ${line} must include selectedNamespace or stable namespace value: ${compact}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
NODE
  then
    echo "[拓扑校验] 正常：$label"
    return 0
  fi

  echo "[拓扑校验] 失败：$label" >&2
  failures=$((failures + 1))
  return 1
}

check_file "tasks file" "$TASKS_FILE"
check_file "topology page" "$TOPOLOGY_FILE"
check_file "service entrypoint" "$SERVICE_FILE"
check_file "auth client" "$AUTH_CLIENT_FILE"
check_file "auth context" "$AUTH_CONTEXT_FILE"
check_file "shell layout" "$SHELL_LAYOUT_FILE"
check_file "realtime bridge" "$REALTIME_BRIDGE_FILE"
check_file "realtime utils" "$REALTIME_UTILS_FILE"
check_file "resource refresh policy" "$RESOURCE_REFRESH_FILE"
check_file "Topology Graph V2 capacity contract" "$TOPOLOGY_V2_CAPACITY_SPEC"
check_file "Topology Graph V2 capacity script" "$TOPOLOGY_V2_CAPACITY_SCRIPT"
check_file "Topology Graph V2 API client" "$TOPOLOGY_V2_API_FILE"
check_file "Topology Graph V2 canvas" "$TOPOLOGY_V2_CANVAS_FILE"
check_file "Topology Graph V2 capacity engine" "$TOPOLOGY_V2_CAPACITY_FILE"

if [[ "$failures" -eq 0 ]]; then
  check_pattern "Topology Graph V2 backend limits" "10_000|30_000|enforceTopologyGraphV2Capacity" "$TOPOLOGY_V2_CAPACITY_SPEC"
  check_pattern "Topology Graph V2 frontend limits" "10_000|30_000|1_500|5_000|600|2_000|300|1_000" "$TOPOLOGY_V2_CAPACITY_SCRIPT"
  check_pattern "Topology Graph V2 explicit over-limit behavior" "semantic-aggregation|RangeError|capacity exceeded" "$TOPOLOGY_V2_CAPACITY_SCRIPT" "$TOPOLOGY_V2_CAPACITY_FILE"
  check_node_script "Topology Graph V2 capacity script is executable" "$TOPOLOGY_V2_CAPACITY_SCRIPT"
  check_pattern "Topology Graph V2 request path" "getTopologyGraphV2|/api/topology/graph/v2" "$TOPOLOGY_FILE" "$TOPOLOGY_V2_API_FILE"
  check_pattern "topology graph/detail functions" "filterGraph|detailRequest|yamlTarget" "$TOPOLOGY_FILE"
  check_pattern "connected graph internals" "selectedResourceId|selectedRelations|resourcesById|KubejojoTopologyCanvas" "$TOPOLOGY_FILE"
  check_pattern "focus / layout / detail paths" "selectedResourceId|setDetail|ResourceDetailDrawer|KubejojoTopologyCanvas" "$TOPOLOGY_FILE" "$TOPOLOGY_V2_CANVAS_FILE"
  check_pattern "semantic capacity projection" "applyTopologyCapacity|semantic-aggregation|aggregation" "$TOPOLOGY_V2_CANVAS_FILE" "$TOPOLOGY_V2_CAPACITY_FILE"
  check_pattern "resource detail drawer symbol" "ResourceDetailDrawer" "$TOPOLOGY_FILE"
  check_pattern "resource yaml drawer symbol" "ResourceYamlDrawer" "$TOPOLOGY_FILE"
  check_pattern "gateway resource helpers" "yamlTarget|GatewayClass|Gateway|HTTPRoute" "$TOPOLOGY_FILE"
  check_pattern "topology namespace query key" "namespaces|selectedNamespace|ALL_NAMESPACE" "$TOPOLOGY_FILE"
  check_pattern "partial and stale coverage handling" "partialSources|coverage|freshness|unavailable" "$TOPOLOGY_FILE"
  check_pattern "fallback / timeout / auth-expired symbols" "service-unavailable|network-timeout|集群服务暂不可达|网络或超时异常|拓扑数据不可用|导航超时，点击重试|navigationTimeoutRef|navigationRetryRef|AUTH_EXPIRED_EVENT|aiops:auth-expired|authExpiredHandled|resetAuthExpiryState" \
    "$TOPOLOGY_FILE" "$AUTH_CLIENT_FILE" "$AUTH_CONTEXT_FILE" "$SHELL_LAYOUT_FILE"
  check_pattern "topology memoized graph/view work" "useMemo|filterGraph|canvasResources|canvasRelations" "$TOPOLOGY_FILE"
  check_pattern "topology realtime invalidation prefixes" "getTopologyQueryPrefixes|topologyQueryKeyForResource|topologyKinds|queryClient\\.invalidateQueries|INVALIDATE_BATCH_DELAY_MS" "$REALTIME_BRIDGE_FILE" "$REALTIME_UTILS_FILE"
  check_no_pattern "topology page must not own SSE stream" "EventSource|text/event-stream|/api/v1/clusters/events/stream" "$TOPOLOGY_FILE"
  check_no_pattern "topology queries must not poll by interval" "refetchInterval|setInterval\\(" "$TOPOLOGY_FILE"
  check_realtime_stream_guard
  check_refresh_interval_guard
  check_topology_query_key_guard
    check_pattern "cleanup command hooks" "topology-artifacts|test topology|topology-verify\\.sh" "$SERVICE_FILE"
  if [[ "$TASKS_FILE" == "$SPEC_TASKS_FILE" ]]; then
    check_pattern "task list markers" "5\\.1|5\\.2|5\\.3|5\\.4|12\\.5" "$TASKS_FILE"
  else
    check_pattern "slice task markers" "Performance/Stability Slices|Static guard agent|bash scripts/topology-verify\\.sh" "$TASKS_FILE"
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  echo "[topology-verify] fail: $failures check(s) failed" >&2
  exit 1
fi

echo "[拓扑校验] 正常：所有静态回归检查通过"
