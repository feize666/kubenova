import assert from "node:assert/strict";
import test from "node:test";
import { parseSidebarPreference, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from "./sidebar-preference";

test("sidebar starts expanded and ignores malformed saved values", () => {
  for (const value of [null, "", "false", "1", "undefined", "{}"])
    assert.equal(parseSidebarPreference(value), false);
  assert.equal(parseSidebarPreference("true"), true);
});

test("both shells share a compact icon rail and expanded width", () => {
  assert.equal(SIDEBAR_WIDTH, 248);
  assert.equal(SIDEBAR_COLLAPSED_WIDTH, 72);
});
