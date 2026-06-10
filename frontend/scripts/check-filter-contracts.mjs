#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const opsIndex = read("src/components/ops/index.ts");
if (!opsIndex.includes("OpsFilterBar") || !opsIndex.includes("OpsFilterBarItem")) {
  failures.push("src/components/ops/index.ts: OpsFilterBar exports missing");
}

const toolbar = read("src/components/resource-filter-toolbar.tsx");
for (const token of [
  "OpsFilterBar",
  "activeFilters",
  "data-resource-filter-toolbar",
  "data-active-filter-count",
  "resource-filter-toolbar--has-active-filters",
  "data-resource-filter-item",
  "data-width={width}",
  "resource-keyword-search",
  "aria-label=\"关键词搜索\"",
  "onClearSearch",
]) {
  if (!toolbar.includes(token)) {
    failures.push(`src/components/resource-filter-toolbar.tsx: missing ${token}`);
  }
}

const scopeFilters = read("src/components/resource-cluster-namespace-filters.tsx");
for (const key of ["cluster", "namespace", "keyword"]) {
  if (!scopeFilters.includes(`key: \"${key}\"`) && !scopeFilters.includes(`key: "${key}"`)) {
    failures.push(`src/components/resource-cluster-namespace-filters.tsx: active filter ${key} missing`);
  }
}
for (const token of ["window.queueMicrotask(onSearch)", "onClearSearch={onSearch}"]) {
  if (!scopeFilters.includes(token)) {
    failures.push(`src/components/resource-cluster-namespace-filters.tsx: missing ${token}`);
  }
}

const actionBar = read("src/components/resource-action-bar.tsx");
for (const token of [
  "parseResourceFilterQuery",
  "ParsedResourceFilterQuery",
  "labelExpressionMode: \"equals\"",
  "missingLabelsMatch",
]) {
  if (!actionBar.includes(token)) {
    failures.push(`src/components/resource-action-bar.tsx: missing filter grammar token ${token}`);
  }
}

const chip = read("src/components/ops/ops-filter-chip.tsx");
if (!chip.includes("closeLabel") || !chip.includes("aria-label={closeLabel}")) {
  failures.push("src/components/ops/ops-filter-chip.tsx: closable chip label contract missing");
}
if (!chip.includes("aria-disabled")) {
  failures.push("src/components/ops/ops-filter-chip.tsx: disabled state contract missing");
}

const button = read("src/components/ops/ops-button.tsx");
if (!button.includes("accessibleLabel") || !button.includes("aria-label={accessibleLabel}")) {
  failures.push("src/components/ops/ops-button.tsx: filter trigger accessible label fallback missing");
}

const css = read("src/app/globals.css");
for (const token of [
  ".ops-filter-bar__controls",
  ".ops-filter-bar__actions",
  ".ops-filter-bar__active",
  ".resource-filter-toolbar--has-active-filters",
  ".resource-keyword-search",
  ".resource-filter-toolbar-item-fill",
]) {
  if (!css.includes(token)) {
    failures.push(`src/app/globals.css: missing filter CSS token ${token}`);
  }
}

if (failures.length > 0) {
  console.error("[check-filter-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-filter-contracts] PASS: shared filter bar, active chips, disabled state, and trigger labels verified.");
