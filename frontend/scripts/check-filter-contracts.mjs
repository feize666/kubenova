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
if (!toolbar.includes("OpsFilterBar") || !toolbar.includes("activeFilters")) {
  failures.push("src/components/resource-filter-toolbar.tsx: toolbar not wired to OpsFilterBar activeFilters");
}

const scopeFilters = read("src/components/resource-cluster-namespace-filters.tsx");
for (const key of ["cluster", "namespace", "keyword"]) {
  if (!scopeFilters.includes(`key: \"${key}\"`) && !scopeFilters.includes(`key: "${key}"`)) {
    failures.push(`src/components/resource-cluster-namespace-filters.tsx: active filter ${key} missing`);
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

if (failures.length > 0) {
  console.error("[check-filter-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-filter-contracts] PASS: shared filter bar, active chips, disabled state, and trigger labels verified.");
