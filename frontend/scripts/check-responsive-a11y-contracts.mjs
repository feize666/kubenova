#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

function requireTokens(path, tokens) {
  const content = read(path);
  for (const token of tokens) {
    if (!content.includes(token)) {
      failures.push(`${path}: missing ${token}`);
    }
  }
}

function forbidTokens(path, tokens) {
  const content = read(path);
  for (const token of tokens) {
    if (content.includes(token)) {
      failures.push(`${path}: forbidden ${token}`);
    }
  }
}

requireTokens("src/app/globals.css", [
  ".shell-skip-link:focus-visible",
  ".kn-focus-ring:focus-visible",
  ".ant-btn:focus-visible",
  ".ant-dropdown-trigger:focus-visible",
  "@media (prefers-reduced-motion: reduce)",
  ".ops-drawer-shell__wrapper",
  "width: 100vw !important",
  ".ops-modal-shell__footer-actions",
  ".ops-filter-bar__main",
  ".resource-table-toolbar",
  ".resource-table .ant-table-cell-fix-right",
  "@media (max-width: 720px)",
  "@media (max-width: 640px)",
  ".resource-table-global-search",
  "overflow-x: auto",
  "position: sticky",
  ".ai-assistant-chat-surface .ant-layout-sider",
  ".ai-assistant-chat-surface > .ops-surface__header",
  ".ops-frame-shell__actions",
]);

requireTokens("scripts/ui-tech-smoke.mjs", [
  "UI_TECH_ARTIFACT_DIR",
  "name: \"tablet\", width: 820, height: 1180",
  "overlayChecks",
  "assertOverlayVisible",
  "scope-popover",
  "search-popover",
  "column-popover",
  "create-modal",
  "row-dropdown-yaml",
  "yaml-drawer",
  "ai-settings-drawer",
  "ai-alert-drawer",
]);

requireTokens("src/components/shell-layout.tsx", [
  "shell-skip-link",
  "href=\"#kubenova-main-content\"",
  "id=\"kubenova-main-content\"",
  "tabIndex={-1}",
  "aria-label",
]);

requireTokens("src/components/ops/ops-button.tsx", [
  "aria-label",
  "disabledReason",
  "aria-disabled",
]);

requireTokens("src/components/ops/ops-filter-chip.tsx", [
  "aria-label",
  "closeLabel",
  "aria-disabled",
  "disabled={disabled}",
]);

requireTokens("src/components/ops/ops-filter-bar.tsx", [
  "aria-label=\"已启用过滤条件\"",
  "closeLabel={`移除",
  "ops-filter-bar__active-label",
  "ops-filter-bar__active-value",
]);

requireTokens("src/components/ops/ops-state.tsx", [
  "role={kind === \"error\" || kind === \"degraded\" ? \"alert\" : \"status\"}",
  "aria-live",
  "aria-hidden=\"true\"",
]);

requireTokens("src/components/ops/ops-action-dropdown.tsx", [
  "aria-label={ariaLabel}",
]);

requireTokens("src/components/ops/ops-drawer-shell.tsx", [
  "returnFocusRef",
  "afterOpenChange",
]);

requireTokens("src/components/ops/ops-confirm-modal.tsx", [
  "aria-label={`输入 ${requiredText} 以确认操作`}",
]);

requireTokens("src/components/resource-yaml-drawer.tsx", [
  "body: { padding: 24, overflow: \"auto\" }",
  "<Space wrap>",
  "aria-label=\"YAML 内容\"",
  "whiteSpace: \"pre\"",
]);

requireTokens("src/components/resource-table/index.tsx", [
  "scroll ?? { x:",
  "getStandardResourceTableScrollX",
  "resource-table-shell",
  "rowKey={nextRowKey}",
  "emptyText",
]);

requireTokens("src/components/resource-table-toolbar.tsx", [
  "aria-label=\"搜索\"",
  "aria-label=\"过滤\"",
  "aria-label=\"清空搜索和过滤\"",
  "aria-label=\"列设置\"",
]);

requireTokens("src/app/network/topology/page.tsx", [
  "role=\"button\"",
  "tabIndex={0}",
  "onKeyDown",
  "event.key === \"Enter\"",
  "event.key === \" \"",
  "STATUS_LABEL",
  "@media (prefers-reduced-motion: reduce)",
  "@media (max-width: 720px)",
]);

requireTokens("src/app/logs/page.tsx", [
  "aria-label=\"查找日志\"",
  "aria-label=\"清除日志\"",
  "aria-label=\"下载日志\"",
  "aria-label=\"重新接入日志\"",
  "aria-label=\"显示上一个实例日志\"",
  "aria-label=\"显示时间戳\"",
  "aria-label=\"实时跟随日志\"",
  "aria-pressed={searchCaseSensitive}",
  "aria-pressed={searchRegex}",
  "ResizeObserver",
  ".headlamp-search-flag:focus-visible",
  "reconnectNow",
  "@media (max-width: 768px)",
  ".logs-terminal-host",
]);

requireTokens("src/app/terminal/page.tsx", [
  "TerminalConnectionStatus",
  "VISUAL_STATUS_LABEL",
  "VISUAL_STATUS_TONE",
  "VISUAL_FRAME_STATE",
  "@media (max-width: 720px)",
  ".terminal-workbench-container-select",
]);

requireTokens("src/app/ai-assistant/page.tsx", [
  "aria-label",
  "onKeyDown={handleInputEnter}",
  "role=\"button\"",
  "tabIndex={0}",
  "aria-current",
  "HIGH_RISK_ACTIONS",
  "Modal.confirm",
  "OpsDrawerShell",
  "OpsSurface",
]);

forbidTokens("src/components/ops/ops-modal-shell.tsx", ["keyboard={false}"]);
forbidTokens("src/components/ops/ops-drawer-shell.tsx", ["keyboard={false}"]);
forbidTokens("src/app/ai-assistant/page.tsx", ["<Card", "<Drawer"]);
forbidTokens("src/app/network/topology/page.tsx", ["keyboard={false}"]);

if (failures.length > 0) {
  console.error("[check-responsive-a11y-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-responsive-a11y-contracts] PASS: responsive, focus, labels, reduced-motion, drawer, modal, logs, terminal, and AI contracts verified.");
