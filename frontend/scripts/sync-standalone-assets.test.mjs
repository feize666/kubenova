import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

for (const distDir of [".next", ".next-isolated-verification"]) {
  test(`standalone serves matching static assets for ${distDir}`, async () => {
    const tempRoot = new URL("../../tmp/", import.meta.url);
    await mkdir(tempRoot, { recursive: true });
    const root = await mkdtemp(new URL("standalone-assets-", tempRoot));
    try {
      await mkdir(path.join(root, "scripts"));
      await cp(new URL("./sync-standalone-assets.mjs", import.meta.url), path.join(root, "scripts/sync-standalone-assets.mjs"));
      await mkdir(path.join(root, distDir, "static/chunks"), { recursive: true });
      await mkdir(path.join(root, distDir, "standalone"), { recursive: true });
      await mkdir(path.join(root, "public/vendor"), { recursive: true });
      await writeFile(path.join(root, distDir, "standalone/server.js"), "// standalone entry");
      await writeFile(path.join(root, distDir, "static/chunks/app.js"), "matching-build");
      await writeFile(path.join(root, "public/vendor/elk-worker.min.js"), "layout-worker");
      const result = spawnSync(process.execPath, ["scripts/sync-standalone-assets.mjs"], {
        cwd: root, env: { ...process.env, KUBENOVA_NEXT_DIST_DIR: distDir }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(root, distDir, "standalone", distDir, "static/chunks/app.js"), "utf8"), "matching-build");
      assert.equal(await readFile(path.join(root, distDir, "standalone/public/vendor/elk-worker.min.js"), "utf8"), "layout-worker");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
