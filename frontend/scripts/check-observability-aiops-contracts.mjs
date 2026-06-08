#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const contracts = [
  {
    path: "src/app/observability/page.tsx",
    required: ["OpsSurface", "OpsDrawerShell", "ResourcePageHeader", "ResourceTable"],
    forbidden: ["cyber-panel", "<Drawer"],
  },
  {
    path: "src/app/aiops/page.tsx",
    required: ["OpsSurface", "OpsDrawerShell", "ResourcePageHeader", "ResourceTable"],
    forbidden: ["cyber-panel", "<Drawer"],
  },
  {
    path: "src/app/inspection/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "OpsModalShell", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["<Modal"],
  },
  {
    path: "src/app/logs/page.tsx",
    required: ["OpsFrameShell", "OpsSurface", "logs-terminal-card", "logs-toolbar-card"],
    forbidden: ["<Card"],
  },
  {
    path: "src/app/system/update/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["<Card"],
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

const assistant = read("src/app/ai-assistant/page.tsx");
if (!assistant.includes("Modal.confirm") || !assistant.includes("confirmHighRiskAction")) {
  failures.push("src/app/ai-assistant/page.tsx: high-risk confirm whitelist stale");
}

if (failures.length > 0) {
  console.error("[check-observability-aiops-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-observability-aiops-contracts] PASS: observability, AIOps, inspection, logs, and update contracts verified.");
