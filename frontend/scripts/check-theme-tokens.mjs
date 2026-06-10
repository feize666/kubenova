#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const globalsPath = path.join(projectRoot, "src/app/globals.css");
const themeContextPath = path.join(projectRoot, "src/components/theme-context.tsx");

const requiredCssTokens = [
  "--kn-bg",
  "--kn-sider",
  "--kn-surface",
  "--kn-surface-raised",
  "--kn-surface-overlay",
  "--kn-surface-subtle",
  "--kn-border",
  "--kn-border-strong",
  "--kn-border-hover",
  "--kn-text",
  "--kn-text-secondary",
  "--kn-text-muted",
  "--kn-text-faint",
  "--kn-primary",
  "--kn-primary-hover",
  "--kn-primary-subtle",
  "--kn-accent",
  "--kn-accent-subtle",
  "--kn-success",
  "--kn-warning",
  "--kn-danger",
  "--kn-info",
  "--kn-radius-sm",
  "--kn-radius-md",
  "--kn-radius-lg",
  "--kn-control-height",
  "--kn-shadow-subtle",
  "--kn-shadow-overlay",
  "--kn-focus-ring",
  "--kn-focus-ring-danger",
  "--kn-font-sans",
  "--kn-font-mono",
  "--kn-motion-fast",
  "--kn-motion-base",
  "--kn-motion-slow",
  "--kn-motion-ease",
  "--kn-motion-ease-out",
];

const requiredCompatibilityTokens = [
  "--color-bg",
  "--color-sider",
  "--color-card",
  "--color-card-high",
  "--color-border",
  "--color-primary",
  "--ops-bg",
  "--ops-surface",
  "--ops-surface-muted",
  "--ops-surface-overlay",
  "--ops-surface-subtle",
  "--ops-overlay-bg",
  "--ops-overlay-border",
  "--ops-border-hover",
  "--ops-text",
  "--ops-text-muted",
  "--ops-text-faint",
  "--ops-accent",
  "--ops-accent-hover",
  "--ops-accent-subtle",
  "--ops-accent-2",
  "--ops-control-height",
  "--ops-control-radius",
  "--ops-surface-raised",
  "--ops-border-subtle",
  "--ops-border-strong",
  "--ops-focus-ring",
  "--ops-motion-fast",
  "--ops-motion-base",
  "--ops-motion-slow",
];

const requiredMotionValues = [
  ["--kn-motion-fast", "120ms"],
  ["--kn-motion-base", "180ms"],
  ["--kn-motion-slow", "260ms"],
];

const requiredAntdComponents = [
  "Button",
  "Table",
  "Drawer",
  "Modal",
  "Input",
  "Select",
  "Dropdown",
  "Popover",
  "Tabs",
  "Card",
  "Alert",
  "Tag",
];

function extractRuleBlock(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) {
    return "";
  }
  const open = css.indexOf("{", start);
  if (open === -1) {
    return "";
  }
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}

function collectMissingTokens(block, tokens, label) {
  return tokens
    .filter((token) => !new RegExp(`${token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:`).test(block))
    .map((token) => `${label} missing ${token}`);
}

function collectUnexpectedTokenValues(block, entries, label) {
  const failures = [];
  for (const [token, expectedValue] of entries) {
    const pattern = new RegExp(`${token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*${expectedValue.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*;`);
    if (!pattern.test(block)) {
      failures.push(`${label} expected ${token}: ${expectedValue}`);
    }
  }
  return failures;
}

const globalsCss = fs.readFileSync(globalsPath, "utf8");
const themeContext = fs.readFileSync(themeContextPath, "utf8");
const darkBlock = extractRuleBlock(globalsCss, ':root,\n[data-theme="dark"]');
const lightBlock = extractRuleBlock(globalsCss, '[data-theme="light"]');

const failures = [
  ...collectMissingTokens(darkBlock, requiredCssTokens, "dark theme"),
  ...collectMissingTokens(lightBlock, requiredCssTokens, "light theme"),
  ...collectMissingTokens(darkBlock, requiredCompatibilityTokens, "dark compatibility"),
  ...collectMissingTokens(lightBlock, requiredCompatibilityTokens, "light compatibility"),
  ...collectUnexpectedTokenValues(darkBlock, requiredMotionValues, "dark motion"),
  ...collectUnexpectedTokenValues(lightBlock, requiredMotionValues, "light motion"),
];

for (const component of requiredAntdComponents) {
  if (!new RegExp(`\\b${component}\\s*:`).test(themeContext)) {
    failures.push(`AntD theme missing component token: ${component}`);
  }
}

if (!globalsCss.includes(".kn-atlas-bg")) failures.push("missing .kn-atlas-bg utility");
if (!globalsCss.includes(".kn-panel")) failures.push("missing .kn-panel utility");
if (!globalsCss.includes(".kn-focus-ring")) failures.push("missing .kn-focus-ring utility");
if (!globalsCss.includes(".kn-signal-line")) failures.push("missing .kn-signal-line utility");
if (!globalsCss.includes(".ops-motion-frame")) failures.push("missing .ops-motion-frame utility");
if (!globalsCss.includes("--ops-motion-frame-duration: var(--ops-motion-base)")) failures.push("missing ops motion base duration");
if (!globalsCss.includes(".ops-motion-frame--duration-fast")) failures.push("missing ops motion fast duration class");
if (!globalsCss.includes(".ops-motion-frame--duration-slow")) failures.push("missing ops motion slow duration class");
if (!globalsCss.includes(".ops-motion-frame[data-state=\"active\"]")) failures.push("missing ops motion active state");

const motionFrameStart = globalsCss.indexOf(".ops-motion-frame");
const motionFrameEnd = globalsCss.indexOf(".ops-inspector-shell__motion");
const motionFrameCss =
  motionFrameStart === -1 || motionFrameEnd === -1 ? "" : globalsCss.slice(motionFrameStart, motionFrameEnd);
for (const forbidden of ["backdrop-filter", "radial-gradient", "box-shadow", "animation:"]) {
  if (motionFrameCss.includes(forbidden)) {
    failures.push(`ops motion frame contains decorative or layout-heavy style: ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error(`[check-theme-tokens] FAIL\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(
  `[check-theme-tokens] PASS: ${requiredCssTokens.length} semantic tokens, ${requiredCompatibilityTokens.length} compatibility tokens, ${requiredAntdComponents.length} AntD component groups.`,
);
