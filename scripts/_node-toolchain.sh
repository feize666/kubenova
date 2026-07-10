#!/usr/bin/env bash

kubenova_node_dir() {
  local node_path
  node_path="$(command -v node 2>/dev/null || true)"
  [[ -n "$node_path" ]] || return 1
  cd "$(dirname "$node_path")" && pwd -P
}

kubenova_prefer_current_node_toolchain() {
  local node_dir
  node_dir="$(kubenova_node_dir 2>/dev/null || true)"
  [[ -n "$node_dir" ]] || return 0
  [[ -x "$node_dir/npm" && -x "$node_dir/npx" ]] || return 0
  export PATH="$node_dir:$PATH"
}

kubenova_tool_dir() {
  local tool="$1" tool_path
  tool_path="$(command -v "$tool" 2>/dev/null || true)"
  [[ -n "$tool_path" ]] || return 1
  cd "$(dirname "$tool_path")" && pwd -P
}

kubenova_require_node_runtime() {
  local component="${1:-node}"
  kubenova_prefer_current_node_toolchain
  if ! command -v node >/dev/null 2>&1; then
    echo "[错误] component=$component" >&2
    echo "原因: 缺少 Node.js 运行时。" >&2
    echo "下一步: 安装 Linux/Ubuntu 原生 Node.js 后重试，不要使用 Windows 侧 node/npm/npx。" >&2
    exit 1
  fi
}

kubenova_require_node_package_tools() {
  local component="${1:-node-package-tools}"
  local node_dir npm_dir npx_dir
  kubenova_require_node_runtime "$component"

  if ! command -v npm >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
    echo "[错误] component=$component" >&2
    echo "原因: 缺少 npm 或 npx。" >&2
    echo "下一步: 安装包含 npm/npx 的 Linux Node.js 发行包后重试。" >&2
    exit 1
  fi

  node_dir="$(kubenova_node_dir)"
  npm_dir="$(kubenova_tool_dir npm)"
  npx_dir="$(kubenova_tool_dir npx)"
  if [[ "$npm_dir" != "$node_dir" || "$npx_dir" != "$node_dir" ]]; then
    echo "[错误] component=$component" >&2
    echo "原因: Node 工具链不一致。" >&2
    echo "  node: $(command -v node)" >&2
    echo "  npm:  $(command -v npm)" >&2
    echo "  npx:  $(command -v npx)" >&2
    echo "下一步: 调整 PATH，确保 node/npm/npx 来自同一个 Linux 目录；不要混用 /mnt/* 下的 Windows npm/npx。" >&2
    exit 1
  fi
}
