import { cp, access, mkdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";

// This file lives in frontend/scripts; its parent is the frontend root.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const nextDir = path.join(root, process.env.KUBENOVA_NEXT_DIST_DIR || ".next");
const staticDir = path.join(nextDir, "static");
const standaloneDir = path.join(nextDir, "standalone");

try {
  await access(staticDir, constants.R_OK);
  await access(path.join(standaloneDir, "server.js"), constants.R_OK);
} catch {
  // A non-standalone build or a failed build has nothing to synchronize.
  process.exit(0);
}

await mkdir(path.join(standaloneDir, ".next"), { recursive: true });
await cp(staticDir, path.join(standaloneDir, ".next", "static"), { recursive: true, force: true });
const publicDir = path.join(root, "public");
try {
  await access(publicDir, constants.R_OK);
  await cp(publicDir, path.join(standaloneDir, "public"), { recursive: true, force: true });
} catch {
  // public is optional; Next's static chunks are the required runtime assets.
}
