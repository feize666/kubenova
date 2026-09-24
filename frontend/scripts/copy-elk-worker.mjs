/**
 * Publishes the ELK layout worker as a static asset.
 *
 * The worker owns the expensive layered layout, so the browser main thread
 * stays responsive while a large resource map is being computed. Serving it
 * from `public/` keeps the URL stable across `next dev` and the standalone
 * production server, where bundler-specific `?url` imports are unavailable.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");

let source;
try {
  source = require.resolve("elkjs/lib/elk-worker.min.js");
} catch {
  console.warn("[elk-worker] elkjs is not installed; skipping worker publish.");
  process.exit(0);
}

const target = resolve(frontendDir, "public/vendor/elk-worker.min.js");
mkdirSync(dirname(target), { recursive: true });

const sourceSize = statSync(source).size;
try {
  if (statSync(target).size === sourceSize) {
    process.exit(0);
  }
} catch {
  // Missing target: publish below.
}

writeFileSync(target, readFileSync(source));
console.log(`[elk-worker] published ${sourceSize} bytes to public/vendor/elk-worker.min.js`);
