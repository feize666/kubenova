#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const table = read("src/components/resource-table/index.tsx");
for (const token of [
  "state?:",
  "filtered-empty",
  "HeadlampResourceTable",
  "StandardResourceTable",
  "getStableResourceRowKey",
  "isInteractiveEventTarget",
  "data-resource-table-stop-navigation",
  "resource-table-resource-link",
  "resource-table-navigable-cell",
  "onResourceNavigate",
  "ResourceDetailDrawer",
  "resource-table--state-loading",
  "OpsFilteredEmptyState",
  "OpsEmptyState",
  "OpsLoadingState",
  "OpsErrorState",
  "OpsPermissionState",
  "OpsState",
  "resource-table--state-",
]) {
  if (!table.includes(token)) {
    failures.push(`src/components/resource-table/index.tsx: missing ${token}`);
  }
}

for (const route of ["src/app/aiops/page.tsx", "src/app/observability/page.tsx"]) {
  const source = read(route);
  if (!source.includes("ResourceTable")) {
    failures.push(`${route}: route-local tables were not normalized to ResourceTable`);
  }
  if (/import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*"antd"/s.test(source)) {
    failures.push(`${route}: still imports antd Table`);
  }
}

const css = read("src/app/globals.css");
for (const token of [
  ".resource-table .ant-table-thead",
  ".resource-table .ant-table-tbody > tr",
  "min-height: 44px",
  ".resource-table .ant-table-tbody > tr.ant-table-row-selected",
  ".resource-table .ant-table-cell-fix-right",
  ".resource-table-actions-cell",
  "--resource-table-action-column-width",
  ".resource-table--state-loading",
  ".resource-table--state-empty",
  ".resource-table--state-filtered-empty",
  ".resource-table--state-error",
  ".resource-table--state-degraded",
]) {
  if (!css.includes(token)) {
    failures.push(`src/app/globals.css: missing table style token ${token}`);
  }
}

if (failures.length > 0) {
  console.error("[check-resource-table-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-resource-table-contracts] PASS: ResourceTable states, route normalization, and table CSS contracts verified.");
