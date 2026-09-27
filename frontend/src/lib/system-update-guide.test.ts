import assert from "node:assert/strict";
import test from "node:test";
import { buildUpdateGuide } from "./system-update-guide";

test("upgrade guides reject untrusted tags rather than producing shell commands", () => {
  for (const tag of ["", "v1.1;id", "$(id)", "../v1.1", "v1.1-dev"]) {
    assert.equal(buildUpdateGuide(tag, "compose"), "");
  }
});

test("Compose upgrades back up existing data before applying one tag and verifying health", () => {
  const script = buildUpdateGuide("v1.1", "compose");
  assert.ok(script.includes("pg_dump"));
  assert.ok(script.indexOf("pg_dump") < script.indexOf("compose-release.sh up --tag v1.1"));
  assert.ok(script.includes("set -euo pipefail"));
  assert.ok(script.includes("/api/health/ready"));
  assert.ok(!script.includes("down -v"));
});

test("systemd upgrades verify the archive before extracting into a new version directory", () => {
  const script = buildUpdateGuide("v1.2.3", "systemd");
  assert.ok(script.indexOf("sha256sum -c") < script.indexOf("tar -xzf"));
  assert.ok(script.includes("releases/v1.2.3"));
  assert.ok(script.includes("prod.sh switch v1.2.3"));
  assert.ok(script.includes("test ! -e"));
  assert.ok(!script.includes("rm -rf"));
});
