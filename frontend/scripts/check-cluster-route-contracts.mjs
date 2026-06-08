#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const contracts = [
  {
    path: "src/app/clusters/page.tsx",
    required: ["OpsPageHeader", "OpsDrawerShell", "openOpsConfirm", "ResourceTable", "ClusterDetailDrawer", "OpsModalShell"],
    forbidden: ["Modal.confirm", "<Drawer"],
  },
  {
    path: "src/app/namespaces/page.tsx",
    required: ["OpsSurface", "ResourcePageHeader", "ResourceClusterNamespaceFilters", "ResourceTable", "ResourceDetailDrawer", "ResourceYamlDrawer", "OpsModalShell"],
    forbidden: ["cyber-panel", "<Card"],
  },
  {
    path: "src/app/clusters/nodes/page.tsx",
    required: ["OpsSurface", "OpsEmptyState", "ResourcePageHeader", "ResourceFilterToolbar", "ResourceTable", "ResourceDetailDrawer"],
    forbidden: ["cyber-panel", "<Card", "Empty.PRESENTED_IMAGE_SIMPLE"],
  },
];

for (const contract of contracts) {
  const content = read(contract.path);
  for (const token of contract.required) {
    if (!content.includes(token)) {
      failures.push(`${contract.path}: missing ${token}`);
    }
  }
  for (const token of contract.forbidden) {
    if (content.includes(token)) {
      failures.push(`${contract.path}: forbidden legacy token ${token}`);
    }
  }
}

const css = read("src/app/globals.css");
if (!css.includes(".cluster-health-drawer__body")) {
  failures.push("src/app/globals.css: missing cluster health drawer body style");
}

if (failures.length > 0) {
  console.error("[check-cluster-route-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-cluster-route-contracts] PASS: cluster, namespace, and node route contracts verified.");
