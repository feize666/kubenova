#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const singlePanelRoutes = [
  "src/app/workloads/deployments/page.tsx",
  "src/app/workloads/pods/page.tsx",
  "src/app/namespaces/page.tsx",
  "src/app/clusters/nodes/page.tsx",
];

for (const path of singlePanelRoutes) {
  const content = read(path);
  for (const token of ["<OpsSurface variant=\"panel\" padding=\"sm\">", "ResourcePageHeader", "ResourceTable"]) {
    if (!content.includes(token)) {
      failures.push(`${path}: missing deployment-aligned single panel token ${token}`);
    }
  }
  for (const token of ["pods-workbench-card", "<OpsSurface variant=\"toolbar\"", "<OpsSurface variant=\"panel\" padding=\"none\">"]) {
    if (content.includes(token)) {
      failures.push(`${path}: forbidden split/legacy resource page surface ${token}`);
    }
  }
}

const clusterPage = read("src/app/clusters/page.tsx");
for (const token of ["resource-page-header__title-suffix", "aria-label=\"创建集群\""]) {
  if (!clusterPage.includes(token)) {
    failures.push(`src/app/clusters/page.tsx: missing cluster title-aligned add button token ${token}`);
  }
}
if (clusterPage.includes("primaryAction={<ResourceAddButton")) {
  failures.push("src/app/clusters/page.tsx: cluster add button must align after title, not in right primaryAction");
}

const nodesPage = read("src/app/clusters/nodes/page.tsx");
if (!nodesPage.includes("style={{ marginBottom: 12 }}")) {
  failures.push("src/app/clusters/nodes/page.tsx: Node header must keep deployment-aligned spacing before filters");
}

const css = read("src/app/globals.css");
for (const token of [".pods-workbench-card"]) {
  if (css.includes(token)) {
    failures.push(`src/app/globals.css: forbidden Pod-specific gray toolbar styling ${token}`);
  }
}

if (failures.length > 0) {
  console.error("[check-resource-page-surface-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-resource-page-surface-contracts] PASS: Pod, Deployment, Namespace, and Node page surfaces align to the deployment table pattern.");
