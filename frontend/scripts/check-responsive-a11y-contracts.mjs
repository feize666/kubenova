#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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
  "text-size-adjust: 100%",
  "-webkit-text-size-adjust: 100%",
  ".kn-focus-ring:focus-visible",
  ".ant-btn:focus-visible",
  ".ant-dropdown-trigger:focus-visible",
  "@media (prefers-reduced-motion: reduce)",
  ".ops-drawer-shell__wrapper",
  "width: 100vw !important",
  ".ops-modal-shell__footer-actions",
  ".ops-filter-bar__main",
  ".resource-table-toolbar",
  ".resource-table-mobile-list",
  ".resource-table-mobile-list + .ant-table-wrapper .ant-table-container",
  ".resource-table .ant-table-cell-fix-right",
  ".shell-mobile-nav-trigger.ops-icon-action-button.ant-btn",
  ".shell-mobile-search-trigger.ops-icon-action-button.ant-btn",
  ".shell-mobile-scope",
  ".shell-mobile-nav-dropdown .ant-dropdown-menu",
  ".shell-mobile-search-panel",
  "max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
  ".ops-modal-shell.ant-modal",
  ".ops-confirm-modal.ant-modal",
  ".ant-dropdown .ant-dropdown-menu",
  ".ant-popover .ant-popover-inner-content",
  "@media (max-width: 720px)",
  "@media (max-width: 640px)",
  ".resource-table-global-search",
  "overflow-x: auto",
  "position: sticky",
  ".ai-assistant-chat-surface .ant-layout-sider",
  ".ai-assistant-chat-surface > .ops-surface__header",
  ".ops-frame-shell__actions",
  ".ops-motion-frame",
  '.ops-motion-frame--slide-up[data-state="inactive"]',
  '.ops-motion-frame--scale[data-state="inactive"]',
  '.ops-motion-frame[data-state="active"]',
  ".ops-mobile-resource-card",
  ".ops-mobile-resource-card__meta",
  ".ops-mobile-resource-card__actions",
  ".ops-mobile-resource-card.is-selected",
  ".ops-mobile-resource-card.is-disabled",
  ".ops-command-preview",
  ".ops-command-preview--approval",
  ".ops-command-preview--danger",
  ".ops-command-preview__body",
  ".ops-command-preview__tools",
  "transition-duration: 1ms;",
  "will-change: auto;",
]);

requireTokens("scripts/ui-tech-smoke.mjs", [
  "UI_TECH_ARTIFACT_DIR",
  'name: "tablet", width: 820, height: 1180',
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
  'href="#kubenova-main-content"',
  'id="kubenova-main-content"',
  "tabIndex={-1}",
  "aria-label",
  "shell-mobile-nav-trigger",
  "shell-mobile-global-search",
  "shell-mobile-search-trigger",
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
  'aria-label="已启用过滤条件"',
  "closeLabel={`移除",
  "ops-filter-bar__active-label",
  "ops-filter-bar__active-value",
]);

requireTokens("src/components/ops/ops-state.tsx", [
  'role={kind === "error" || kind === "degraded" ? "alert" : "status"}',
  "aria-live",
  'aria-hidden="true"',
]);

requireTokens("src/components/ops/ops-action-dropdown.tsx", [
  "aria-label={ariaLabel}",
]);

requireTokens("src/components/ops/index.ts", [
  "OpsCommandPreview",
  "OpsInspectorShell",
  "OpsMotionFrame",
  "OpsMobileResourceCard",
  "type OpsCommandPreviewKind",
  "type OpsCommandPreviewProps",
  "type OpsCommandPreviewTone",
  "type OpsInspectorFact",
  "type OpsInspectorShellProps",
  "type OpsInspectorShellVariant",
  "type OpsMotionDuration",
  "type OpsMotionFrameProps",
  "type OpsMotionKind",
  "type OpsMobileResourceCardMeta",
  "type OpsMobileResourceCardProps",
]);

requireTokens("src/components/ops/ops-inspector-shell.tsx", [
  "data-ops-inspector-shell",
  "ops-inspector-shell__header",
  "ops-inspector-shell__facts",
  "ops-inspector-shell__state",
  "OpsMotionFrame",
  "OpsState",
]);

requireTokens("src/components/ops/ops-motion-frame.tsx", [
  "data-ops-motion-frame",
  'data-state={active ? "active" : "inactive"}',
  "Math.max(0, delayMs)",
  "OpsMotionKind",
]);

requireTokens("src/components/ops/ops-mobile-resource-card.tsx", [
  "data-ops-mobile-resource-card",
  'data-resource-table-stop-navigation="true"',
  "aria-disabled={disabled || undefined}",
  "onKeyDown={handleKeyDown}",
  'event.key === "Enter"',
  'event.key === " "',
  "OpsStatusTag",
  "type OpsStatusTone",
]);

requireTokens("src/components/ops/ops-command-preview.tsx", [
  "data-ops-command-preview",
  "data-kind={kind}",
  "data-tone={tone}",
  "OpsCommandPreviewKind",
  "OpsCommandPreviewTone",
  "navigator.clipboard.writeText",
  'aria-label={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : copyLabel}',
  'data-resource-table-stop-navigation="true"',
  "tabIndex={0}",
]);

requireTokens("src/components/ops/ops-drawer-shell.tsx", [
  "returnFocusRef",
  "afterOpenChange",
]);

requireTokens("src/components/ops/ops-confirm-modal.tsx", [
  "aria-label={`输入 ${requiredText} 以确认操作`}",
]);

requireTokens("src/components/resource-table/index.tsx", [
  "getStandardResourceTableScrollX",
  "x: getStandardResourceTableScrollX",
  "resource-table-shell",
  "renderMobileResourceCards",
  "OpsMobileResourceCard",
  "data-resource-table-mobile-list",
  "rowKey={nextRowKey}",
  "emptyText",
]);

requireTokens("src/components/resource-table-toolbar.tsx", [
  'aria-label="搜索资源"',
  'aria-label="过滤"',
  'aria-label="清空搜索和过滤"',
  'aria-label="列设置"',
]);

requireTokens("src/app/network/topology/page.tsx", [
  "OpsLoadingState",
  "OpsEmptyState",
  "OpsErrorState",
  "KubejojoTopologyCanvas",
  "resourceStatus",
]);

// The topology route now delegates node activation to the Kubejojo renderer.
// Keep the accessibility contract on the component that owns the interactive
// node instead of pinning it to the route-level composition file.
requireTokens("src/modules/topology-kubejojo/renderers/TopologyNodes.tsx", [
  'role="button"',
  "tabIndex={0}",
  "onKeyDown={activateOnKeyboard}",
  'event.key !== "Enter"',
  'event.key !== " "',
]);

requireTokens("src/app/globals.css", [
  "Topology workbench extracted route styles",
  ".resource-map-shell",
  ".resource-map-canvas-state",
  ".resource-map-rail",
  "@media (prefers-reduced-motion: reduce)",
  "@media (max-width: 720px)",
]);

requireTokens("src/app/ai-assistant/page.tsx", [
  "aria-label",
  "onKeyDown={handleInputEnter}",
  'role="button"',
  "tabIndex={0}",
  "aria-current",
  "confirmHighRiskAction",
  "requiresApproval",
  "Modal.confirm",
  "OpsCommandPreview",
  "getMarkdownCodePreviewKind",
  "formatHighRiskActionPreview",
  "OpsDrawerShell",
  "OpsSurface",
]);

forbidTokens("src/components/ops/ops-modal-shell.tsx", ["keyboard={false}"]);
forbidTokens("src/components/ops/ops-drawer-shell.tsx", ["keyboard={false}"]);
forbidTokens("src/components/ops/ops-motion-frame.tsx", [
  "setTimeout",
  "requestAnimationFrame",
  "useEffect",
]);
forbidTokens("src/components/ops/ops-mobile-resource-card.tsx", [
  "setTimeout",
  "requestAnimationFrame",
  "useEffect",
]);
forbidTokens("src/components/ops/ops-command-preview.tsx", [
  "setTimeout",
  "requestAnimationFrame",
  "useEffect",
]);
forbidTokens("src/app/ai-assistant/page.tsx", ["<Card", "<Drawer", "<pre"]);
forbidTokens("src/app/network/topology/page.tsx", [
  "keyboard={false}",
  "<style jsx global>",
]);

if (failures.length > 0) {
  console.error("[check-responsive-a11y-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

// These surfaces now delegate to real editors and workbenches. Validate their
// rendered keyboard/viewport behavior instead of obsolete route source tokens.
execFileSync(process.execPath, ["--test",
  "src/components/resource-yaml-drawer.test.mjs",
  "src/components/resource-table/table-keyboard-browser.test.mjs",
  "src/components/runtime-workbench/logs-workbench.test.mjs",
  "src/components/runtime-workbench/terminal-workbench.test.mjs",
], { cwd: root, stdio: "inherit", env: process.env });

console.log(
  "[check-responsive-a11y-contracts] PASS: responsive, focus, labels, reduced-motion, drawer, modal, logs, terminal, and AI contracts verified.",
);
