import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { getCenteredTopologyViewport } from "./viewport.ts";

test("fit viewport centers a short graph horizontally and vertically", () => {
  const viewport = getCenteredTopologyViewport(
    { x: 100, y: 40, width: 400, height: 160 },
    { width: 1200, height: 800 },
    { minZoom: 0.2, maxZoom: 1, padding: 28 },
  );
  assert.deepEqual(viewport, { x: 300, y: 280, zoom: 1 });
});

test("fit viewport scales large graphs and keeps their center on the canvas center", () => {
  const viewport = getCenteredTopologyViewport(
    { x: 50, y: 20, width: 2000, height: 1000 },
    { width: 1000, height: 600 },
    { minZoom: 0.2, maxZoom: 1, padding: 50 },
  );
  assert.ok(viewport);
  assert.equal(viewport.zoom, 0.45);
  assert.equal((50 + 1000) * viewport.zoom + viewport.x, 500);
  assert.equal((20 + 500) * viewport.zoom + viewport.y, 300);
});

test("actual-size viewport keeps zoom at one while centering node bounds", () => {
  assert.deepEqual(
    getCenteredTopologyViewport(
      { x: 240, y: 180, width: 300, height: 100 },
      { width: 900, height: 500 },
      { zoom: 1, minZoom: 1, maxZoom: 1 },
    ),
    { x: 60, y: 20, zoom: 1 },
  );
});

test("invalid empty bounds do not produce a viewport", () => {
  assert.equal(
    getCenteredTopologyViewport(
      { x: 0, y: 0, width: 0, height: 100 },
      { width: 800, height: 600 },
    ),
    null,
  );
});
