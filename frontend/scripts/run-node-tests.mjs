#!/usr/bin/env node
/**
 * Runs the Node-based source test suites.
 *
 * The suites are written against the same specifiers the app uses
 * (`@/...`, extensionless relative imports), which Node cannot resolve on its
 * own. This runner uses tsx for TypeScript, JSX and path alias support, then
 * delegates to `node --test` so suites exercise the actual React components.
 *
 * Usage: node scripts/run-node-tests.mjs [path ...]
 * Default paths: every `src/**\/*.test.ts` file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");
const srcDir = join(frontendDir, "src");

function collectTestFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectTestFiles(full);
    return /\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const requested = process.argv.slice(2);
const targets = requested.length
  ? requested.map((path) => resolve(frontendDir, path))
  : collectTestFiles(srcDir);

if (!targets.length) {
  console.error("[node-tests] no test files found");
  process.exit(1);
}

const invalidTargets = targets.filter((target) => !existsSync(target) || !statSync(target).isFile());
if (invalidTargets.length) {
  for (const target of invalidTargets) console.error(`[node-tests] test target is not a file: ${relative(frontendDir, target)}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    ...targets.map((target) => relative(frontendDir, target)),
  ],
  { cwd: frontendDir, stdio: "inherit" },
);

process.exit(result.status ?? 1);
