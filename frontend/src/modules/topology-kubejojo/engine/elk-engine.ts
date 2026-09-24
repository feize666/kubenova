// Explicit file suffixes keep Node's type stripper and the bundler in
// agreement about which build of each ELK entry point to load.
import ELKWorkerApi from "elkjs/lib/elk-api.js";
import ELKBundled from "elkjs/lib/elk.bundled.js";

import type { ElkEngine } from "./elk-layout";

/**
 * Path of the layout worker published by `scripts/copy-elk-worker.mjs`.
 *
 * A stable URL lets the same worker serve `next dev` and the standalone
 * production server, where bundler-specific `?url` imports are unavailable.
 */
export const ELK_WORKER_URL = "/vendor/elk-worker.min.js";

let engine: ElkEngine | undefined;
let workerUnavailable = false;

function createWorkerEngine(): ElkEngine | undefined {
  if (typeof Worker === "undefined") return undefined;
  try {
    return new ELKWorkerApi({ workerUrl: ELK_WORKER_URL }) as unknown as ElkEngine;
  } catch {
    // A blocked worker (CSP, offline asset) must not break the resource map.
    return undefined;
  }
}

/**
 * Returns the first working ELK engine and reuses it afterwards.
 *
 * The worker keeps the main thread free during layout; the bundled engine is
 * the fallback for environments without Worker support.
 */
export function getElkEngine(): ElkEngine {
  if (engine) return engine;
  if (!workerUnavailable) {
    const candidate = createWorkerEngine();
    if (candidate) {
      engine = candidate;
      return engine;
    }
    workerUnavailable = true;
  }
  engine = new ELKBundled() as unknown as ElkEngine;
  return engine;
}
