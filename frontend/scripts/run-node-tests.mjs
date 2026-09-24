#!/usr/bin/env node
/**
 * Runs the Node-based source test suites.
 *
 * The suites are written against the same specifiers the app uses
 * (`@/...`, extensionless relative imports), which Node cannot resolve on its
 * own. This runner registers a small resolver hook, then delegates to
 * `node --test` so the suites exercise the real modules instead of a copy.
 *
 * Usage: node scripts/run-node-tests.mjs [path ...]
 * Default paths: every `src/**\/*.test.ts` file.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
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

const result = spawnSync(
  process.execPath,
  [
    "--import",
    join(scriptDir, "node-test-resolver.mjs"),
    "--experimental-strip-types",
    "--test",
    ...targets.map((target) => relative(frontendDir, target)),
  ],
  { cwd: frontendDir, stdio: "inherit" },
);

process.exit(result.status ?? 1);
