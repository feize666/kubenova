import test from "node:test";
import assert from "node:assert/strict";

import { handbookChapters, searchHandbook } from "./content";

test("handbook is shared and every chapter states its permission boundary", () => {
  assert.ok(handbookChapters.length >= 12);
  assert.ok(handbookChapters.every(chapter => chapter.permission.trim().length > 0));
  assert.ok(handbookChapters.some(chapter => chapter.id === "access"));
  assert.ok(handbookChapters.some(chapter => chapter.id === "ai"));
});
test("handbook search matches operational terms across chapter steps and notes", () => {
  assert.deepEqual(searchHandbook("Endpoints TLS").map(chapter => chapter.id), ["network"]);
  assert.ok(searchHandbook("AI 确认").some(chapter => chapter.id === "ai"));
  assert.equal(searchHandbook("不存在的功能").length, 0);
});
