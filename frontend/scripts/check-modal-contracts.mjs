#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];

const index = read("src/components/ops/index.ts");
for (const token of ["OpsModalShell", "OpsFormSection"]) {
  if (!index.includes(token)) {
    failures.push(`src/components/ops/index.ts: missing ${token}`);
  }
}

const modalShell = read("src/components/ops/ops-modal-shell.tsx");
for (const token of ["description", "identity", "impact", "footerActions", "ops-form-section"]) {
  if (!modalShell.includes(token)) {
    failures.push(`src/components/ops/ops-modal-shell.tsx: missing ${token}`);
  }
}

const confirm = read("src/components/ops/ops-confirm-modal.tsx");
for (const token of ["requiredText", "impact", "error", "confirmTextMatched", "okButtonProps"]) {
  if (!confirm.includes(token)) {
    failures.push(`src/components/ops/ops-confirm-modal.tsx: missing ${token}`);
  }
}

const css = read("src/app/globals.css");
for (const token of [
  ".ops-modal-shell__heading",
  ".ops-modal-shell__impact",
  ".ops-form-section",
  ".ops-confirm-content__required",
  ".workload-create-workspace__footer",
  ".workload-create-workspace__yaml",
]) {
  if (!css.includes(token)) {
    failures.push(`src/app/globals.css: missing modal/form style ${token}`);
  }
}

const representativeForms = [
  {
    path: "src/app/users/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "confirmLoading", "创建可登录 Kubenova"],
  },
  {
    path: "src/app/users/rbac/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "ServiceAccount 查询", "confirmLoading"],
  },
  {
    path: "src/app/namespaces/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "运维标签", "confirmLoading"],
  },
  {
    path: "src/app/clusters/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "接入配置", "confirmLoading"],
  },
  {
    path: "src/app/storage/pv/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "PVC 引用", "confirmLoading"],
  },
  {
    path: "src/app/storage/pvc/page.tsx",
    tokens: ["OpsModalShell", "OpsFormSection", "扩容目标", "confirmLoading"],
  },
  {
    path: "src/app/workloads/create/page.tsx",
    tokens: ["OpsFormSection", "workload-create-workspace__footer", "workload-create-workspace__yaml", "previewYamlQuery"],
  },
  {
    path: "src/components/workloads/autoscaling-console.tsx",
    tokens: ["OpsModalShell", "配置 HPA/VPA", "confirmLoading", "Form.List"],
  },
];

for (const contract of representativeForms) {
  const content = read(contract.path);
  for (const token of contract.tokens) {
    if (!content.includes(token)) {
      failures.push(`${contract.path}: missing representative form contract ${token}`);
    }
  }
}

const actionBar = read("src/components/resource-action-bar.tsx");
for (const token of ["openOpsConfirm", "danger", "disabledReason"]) {
  if (!actionBar.includes(token)) {
    failures.push(`src/components/resource-action-bar.tsx: missing destructive confirm contract ${token}`);
  }
}

if (failures.length > 0) {
  console.error("[check-modal-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-modal-contracts] PASS: modal shell, form sections, and confirmation contracts verified.");
