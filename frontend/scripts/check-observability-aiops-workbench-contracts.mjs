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
    required: ["OpsSurface", "OpsDrawerShell", "ResourcePageHeader", "ResourceTable", "OpsIconActionButton", "OpsCommandPreview"],
    forbidden: ["cyber-panel", "<Drawer"],
  },
  {
    path: "src/app/inspection/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "OpsModalShell", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["cyber-panel", "<Modal"],
  },
  {
    path: "src/app/logs/page.tsx",
    required: [
      "OpsFrameShell",
      "OpsSurface",
      "logs-toolbar-card.ops-surface",
      "logs-terminal-card.ops-surface",
      "reconnectNow",
    ],
    forbidden: ["cyber-panel", "<Card", ".ant-card"],
  },
  {
    path: "src/app/terminal/page.tsx",
    required: ["OpsFrameShell", "OpsIconActionButton", "TerminalConnectionStatus", "reconnect"],
    forbidden: ["cyber-panel", "<Card", "<Drawer"],
  },
  {
    path: "src/app/system/update/page.tsx",
    required: ["OpsPageHeader", "OpsSurface", "BusinessDetailDrawer", "ResourceTable"],
    forbidden: ["cyber-panel", "<Card"],
  },
  {
    path: "src/app/ai-assistant/page.tsx",
    required: ["OpsSurface", "OpsDrawerShell", "OpsIconActionButton", "OpsCommandPreview", "Modal.confirm", "HIGH_RISK_ACTIONS"],
    forbidden: ["cyber-panel", "<Card", "<Drawer", "<pre"],
  },
  {
    path: "src/app/dashboard/page.tsx",
    required: ["BootstrapScreen", "router.replace"],
    forbidden: ["cyber-panel", "<Card"],
  },
  {
    path: "src/app/monitoring/page.tsx",
    required: ["BootstrapScreen", "router.replace", "/observability"],
    forbidden: ["cyber-panel", "<Card"],
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

const allowedLegacyRoutes = [
  {
    path: "src/app/login/page.tsx",
    required: ["OpsSurface", "login-card", "控制面服务暂不可达", "KubeNova"],
    forbidden: ["<Card"],
    reason: "Login form now uses the shared OpsSurface container while authentication behavior and API probe warning are unchanged",
  },
];

for (const item of allowedLegacyRoutes) {
  const content = read(item.path);
  for (const token of item.required) {
    if (!content.includes(token)) {
      failures.push(`${item.path}: deferred whitelist stale; missing ${token} (${item.reason})`);
    }
  }
  for (const token of item.forbidden ?? []) {
    if (content.includes(token)) {
      failures.push(`${item.path}: forbidden legacy token ${token}`);
    }
  }
  if (content.includes("cyber-panel")) {
    failures.push(`${item.path}: forbidden legacy token cyber-panel`);
  }
}

if (failures.length > 0) {
  console.error("[check-observability-aiops-workbench-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-observability-aiops-workbench-contracts] PASS: observability, AIOps, inspection, logs, terminal, login, update contracts verified.");
