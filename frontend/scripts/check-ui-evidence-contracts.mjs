#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceRoot = "/case/temp/kubenova-ui-ux-pro-max";
const failures = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function requireTokens(path, tokens) {
  const content = read(path);
  for (const token of tokens) {
    if (!content.includes(token)) {
      failures.push(`${path}: missing ${token}`);
    }
  }
}

const expectedImages = [
  "gpt-image2_20260608_093011_1.png",
  "gpt-image2_20260608_093410_1.png",
  "gpt-image2_20260608_094034_1.png",
  "gpt-image2_20260608_094404_1.png",
];

for (const filename of expectedImages) {
  const path = join(evidenceRoot, filename);
  if (!existsSync(path)) {
    failures.push(`${path}: missing generated UI image`);
    continue;
  }
  const size = statSync(path).size;
  if (size < 100_000) {
    failures.push(`${path}: generated UI image unexpectedly small (${size} bytes)`);
  }
}

const evidenceReport = join(evidenceRoot, "evidence.md");
if (!existsSync(evidenceReport)) {
  failures.push(`${evidenceReport}: missing evidence report`);
} else {
  const report = readFileSync(evidenceReport, "utf8");
  for (const token of [
    "GPT Image 2 Outputs",
    "AbortError: This operation was aborted",
    "<route>__<theme>__<viewport>__<state>.png",
    "/case/temp",
  ]) {
    if (!report.includes(token)) {
      failures.push(`${evidenceReport}: missing ${token}`);
    }
  }
}

requireTokens("../.codex/specs/full-site-ui-refresh/design.md", [
  "gpt-image2_20260608_093011_1.png",
  "gpt-image2_20260608_093410_1.png",
  "gpt-image2_20260608_094034_1.png",
  "gpt-image2_20260608_094404_1.png",
  "/case/temp/kubenova-ui-ux-pro-max/evidence.md",
]);

requireTokens("scripts/ui-tech-smoke.mjs", [
  "UI_TECH_SAVE_ARTIFACTS",
  "UI_TECH_ARTIFACT_DIR",
  "UI_TECH_THEMES",
  "--themes black,white",
  "name: \"tablet\", width: 820, height: 1180",
  "screenshotFilename",
  "<route>__<theme>__<viewport>__<state>",
  "/case/temp/kubenova/ui-tech-smoke",
  "addInitScript",
  "scope-popover",
  "column-popover",
  "create-modal",
  "ai-settings-drawer",
  "ai-alert-drawer",
]);

if (failures.length > 0) {
  console.error("[check-ui-evidence-contracts] FAIL");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[check-ui-evidence-contracts] PASS: generated images, evidence report, retry prompts, and smoke artifact contracts verified.");
