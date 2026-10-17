#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const shell = read("src/components/ops/ops-drawer-shell.tsx");
for (const token of [
  "resource",
  "footerActions",
  "returnFocusRef",
  "VARIANT_WIDTH",
  "inspector: 460",
  "drawerWrapperWidth(variant,resolvedWidth,fullscreen)",
  "afterOpenChange",
  "ops-drawer-shell__footer-actions",
]) {
  if (!shell.includes(token)) {
    failures.push(`src/components/ops/ops-drawer-shell.tsx: missing ${token}`);
  }
}

const resourceDetail = read("src/components/resource-detail/resource-detail-drawer.tsx");
for (const token of ["variant=\"resource\"", "state={drawerState}", "OpsLoadingState", "OpsErrorState", "OpsEmptyState"]) {
  if (!resourceDetail.includes(token)) {
    failures.push(`src/components/resource-detail/resource-detail-drawer.tsx: missing ${token}`);
  }
}

const clusterDetail = read("src/components/cluster-detail-drawer.tsx");
for (const token of ["OpsLoadingState", "OpsErrorState", "OpsEmptyState", "OpsDegradedState"]) {
  if (!clusterDetail.includes(token)) {
    failures.push(`src/components/cluster-detail-drawer.tsx: missing ${token}`);
  }
}

const businessDetail = read("src/components/business-detail-drawer.tsx");
for (const token of ["business-detail-drawer__identity", "OpsEmptyState", "OpsFilterChip"]) {
  if (!businessDetail.includes(token)) {
    failures.push(`src/components/business-detail-drawer.tsx: missing ${token}`);
  }
}

const yaml = read("src/components/resource-yaml-drawer.tsx");
for (const token of [
  "<EditorDocument embedded lockContext",
  "<OpsDrawerShell",
  "props.embedded",
  "readOnly",
  "maskSensitive",
  "sensitive&&!visible",
  "disabled={unavailable}",
  "复制",
  "YAML 只读预览",
  "显示敏感",
  "gcTime:0",
]) {
  if (!yaml.includes(token)) {
    failures.push(`src/components/resource-yaml-drawer.tsx: missing ${token}`);
  }
}

const editor = read("src/components/resource-editor/resource-editor-page.tsx");
for (const token of ["dryRun:true", "dryRun:false", "sensitiveVisible", "资源编辑操作", "校验并预览"]) {
  if (!editor.includes(token)) failures.push(`src/components/resource-editor/resource-editor-page.tsx: missing unified YAML editor contract ${token}`);
}

const css = read("src/app/globals.css");
for (const token of [
  ".ops-drawer-shell__header",
  ".ops-drawer-shell__footer",
  ".ops-drawer-shell--inspector",
  ".ops-drawer-shell--editor",
  ".ops-drawer-shell--workbench",
  ".ops-drawer-shell__wrapper",
  ".business-detail-drawer__identity",
]) {
  if (!css.includes(token)) {
    failures.push(`src/app/globals.css: missing drawer style ${token}`);
  }
}

if (failures.length > 0) {
  console.error("[check-drawer-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-drawer-contracts] PASS: drawer variants, footer actions, focus return, and responsive shell contracts verified.");
