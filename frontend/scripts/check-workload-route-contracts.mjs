#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const workloadRoutes = [
  "pods",
  "deployments",
  "replicasets",
  "daemonsets",
  "statefulsets",
  "jobs",
  "cronjobs",
];

for (const route of workloadRoutes) {
  const path = `src/app/workloads/${route}/page.tsx`;
  const content = read(path);
  for (const token of [
    "OpsSurface",
    "ResourcePageHeader",
    "ResourceScopeFilterButton",
    "ResourceTable",
    "ResourceDetailDrawer",
    "ResourceYamlDrawer",
  ]) {
    if (!content.includes(token)) {
      failures.push(`${path}: missing workload shared contract ${token}`);
    }
  }
  if (!content.includes("buildResourceActionMenuItems") && !content.includes("OpsActionDropdown")) {
    failures.push(`${path}: missing shared row action model`);
  }
  for (const legacy of ['Card className="cyber-panel"', "cyber-panel", "Modal.confirm"]) {
    if (content.includes(legacy)) {
      failures.push(`${path}: forbidden legacy surface ${legacy}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[check-workload-route-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-workload-route-contracts] PASS: workload route shared UI contracts verified.");
