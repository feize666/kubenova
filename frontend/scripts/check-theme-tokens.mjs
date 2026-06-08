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
  "--ops-control-height",
  "--ops-control-radius",
  "--ops-surface-raised",
  "--ops-border-subtle",
  "--ops-border-strong",
  "--ops-focus-ring",
  "--ops-bg",
  "--ops-surface",
  "--ops-text",
  "--ops-accent",
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

const globalsCss = fs.readFileSync(globalsPath, "utf8");
const themeContext = fs.readFileSync(themeContextPath, "utf8");
const darkBlock = extractRuleBlock(globalsCss, ':root,\n[data-theme="dark"]');
const lightBlock = extractRuleBlock(globalsCss, '[data-theme="light"]');

const failures = [
  ...collectMissingTokens(darkBlock, requiredCssTokens, "dark theme"),
  ...collectMissingTokens(lightBlock, requiredCssTokens, "light theme"),
  ...collectMissingTokens(darkBlock, requiredCompatibilityTokens, "dark compatibility"),
  ...collectMissingTokens(lightBlock, requiredCompatibilityTokens, "light compatibility"),
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

if (failures.length > 0) {
  console.error(`[check-theme-tokens] FAIL\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(
  `[check-theme-tokens] PASS: ${requiredCssTokens.length} semantic tokens, ${requiredCompatibilityTokens.length} compatibility tokens, ${requiredAntdComponents.length} AntD component groups.`,
);
