#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [
  "src/components/ops/ops-button.tsx",
  "src/components/ops/ops-action-dropdown.tsx",
  "src/app/logs/page.tsx",
  "src/app/network/topology/page.tsx",
  "src/components/resource-table-toolbar.tsx",
];

const failures = [];

for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("<OpsIconActionButton")) {
      continue;
    }
    const tagLines = [lines[index]];
    const firstLineComplete = lines[index].includes(" />") || lines[index].trim().endsWith("/>");
    for (let next = index + 1; !firstLineComplete && next < lines.length; next += 1) {
      tagLines.push(lines[next]);
      if (lines[next].trim() === "/>" || lines[next].includes("</OpsIconActionButton>")) {
        break;
      }
    }
    const tag = tagLines.join("\n");
    if (/opsVariant=["']icon["']/.test(tag) && !/\baria-label=/.test(tag) && !/\btitle=/.test(tag)) {
      failures.push(`${file}: icon-only OpsIconActionButton missing aria-label/title`);
    }
  }
}

const actionDropdownSource = readFileSync(join(root, "src/components/ops/ops-action-dropdown.tsx"), "utf8");
if (!/aria-label=\{ariaLabel\}/.test(actionDropdownSource)) {
  failures.push("src/components/ops/ops-action-dropdown.tsx: action trigger no longer binds ariaLabel");
}
if (!/aria-label=\{props\["aria-label"\]/.test(readFileSync(join(root, "src/components/ops/ops-button.tsx"), "utf8"))) {
  failures.push("src/components/ops/ops-button.tsx: OpsIconActionButton no longer forwards aria-label fallback");
}

if (failures.length > 0) {
  console.error("[check-ops-actions-a11y] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`[check-ops-actions-a11y] PASS: checked ${files.length} files for icon-only labels and dropdown trigger labels.`);
