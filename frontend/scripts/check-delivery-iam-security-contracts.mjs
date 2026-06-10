#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const contracts = [
  {
    path: "src/app/users/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "OpsModalShell", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["<Card", "cyber-panel"],
  },
  {
    path: "src/app/users/rbac/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "OpsModalShell", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["cyber-panel"],
  },
  {
    path: "src/app/workloads/helm/page.tsx",
    required: ["OpsSurface", "OpsModalShell", "ResourcePageHeader", "ResourceTable", "ResourceDetailDrawer", "openResourceActionConfirm"],
    forbidden: ['<Card>', "<Modal", "cyber-panel"],
  },
  {
    path: "src/app/workloads/helm/repositories/page.tsx",
    required: ["OpsSurface", "OpsModalShell", "ResourcePageHeader", "ResourceTable", "ResourceDetailDrawer", "openResourceActionConfirm"],
    forbidden: ['<Card>', "<Modal", "cyber-panel"],
  },
  {
    path: "src/components/workloads/autoscaling-console.tsx",
    required: ["OpsSurface", "OpsModalShell", "openOpsConfirm", "ResourceYamlDrawer", "ResourceDetailDrawer"],
    forbidden: ["Modal.confirm"],
  },
  {
    path: "src/app/security/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "BusinessDetailDrawer", "ResourceTable", "ResourceActionDropdown"],
    forbidden: ["cyber-panel"],
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

if (failures.length > 0) {
  console.error("[check-delivery-iam-security-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-delivery-iam-security-contracts] PASS: delivery, IAM, security, and governance contracts verified.");
