#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const surfaceRoutes = [
  "src/app/network/services/page.tsx",
  "src/app/network/ingress/page.tsx",
  "src/app/network/ingressroute/page.tsx",
  "src/app/network/endpoints/page.tsx",
  "src/app/network/endpointslices/page.tsx",
  "src/app/network/networkpolicy/page.tsx",
  "src/app/network/gateway-api/page.tsx",
  "src/app/storage/pv/page.tsx",
  "src/app/storage/pvc/page.tsx",
  "src/app/storage/sc/page.tsx",
  "src/app/configs/configmaps/page.tsx",
  "src/app/configs/secrets/page.tsx",
  "src/app/configs/serviceaccounts/page.tsx",
];

for (const path of surfaceRoutes) {
  const content = read(path);
  for (const token of ["OpsSurface", "ResourcePageHeader", "ResourceTable"]) {
    if (!content.includes(token)) {
      failures.push(`${path}: missing ${token}`);
    }
  }
  for (const legacy of ["cyber-panel", "<Card", "Modal.confirm"]) {
    if (content.includes(legacy)) {
      failures.push(`${path}: forbidden legacy token ${legacy}`);
    }
  }
}

const modalShellRoutes = [
  "src/app/network/services/page.tsx",
  "src/app/network/ingress/page.tsx",
  "src/app/network/ingressroute/page.tsx",
  "src/app/network/endpoints/page.tsx",
  "src/app/network/endpointslices/page.tsx",
  "src/app/network/networkpolicy/page.tsx",
  "src/app/storage/pv/page.tsx",
  "src/app/storage/pvc/page.tsx",
  "src/app/storage/sc/page.tsx",
  "src/app/configs/configmaps/page.tsx",
  "src/app/configs/secrets/page.tsx",
  "src/app/configs/serviceaccounts/page.tsx",
];

for (const path of modalShellRoutes) {
  const content = read(path);
  if (!content.includes("OpsModalShell")) {
    failures.push(`${path}: missing OpsModalShell for representative forms`);
  }
  if (content.includes("<Modal")) {
    failures.push(`${path}: resource route modal must use OpsModalShell, not raw antd Modal`);
  }
}

const pvc = read("src/app/storage/pvc/page.tsx");
if (!pvc.includes("openOpsConfirm") || !pvc.includes("删除 PVC")) {
  failures.push("src/app/storage/pvc/page.tsx: missing shared PVC destructive confirm");
}

if (failures.length > 0) {
  console.error("[check-network-storage-config-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-network-storage-config-contracts] PASS: network, storage, and config route contracts verified.");
