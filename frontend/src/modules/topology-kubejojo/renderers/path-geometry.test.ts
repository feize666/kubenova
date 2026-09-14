import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { buildOrthogonalRelationshipPath, orthogonalPathMidpoint } from "./path-geometry.ts";

test("Dagre relationship geometry renders a smooth cubic route", () => {
  const path = buildOrthogonalRelationshipPath([{
    startPoint: { x: 0, y: 44 },
    bendPoints: [{ x: 96, y: 44 }, { x: 96, y: 132 }],
    endPoint: { x: 192, y: 132 },
  }], { x: 12, y: 8 });

  assert.match(path, /^M 12,52 C /);
  assert.match(path, /C /);
  assert.doesNotMatch(path, /NaN|undefined/);
  assert.doesNotMatch(path, /NaN|undefined/);
});

test("non-orthogonal legacy points are normalized to a smooth route", () => {
  const path = buildOrthogonalRelationshipPath([{
    startPoint: { x: 0, y: 0 },
    bendPoints: [{ x: 54, y: 12 }, { x: 96, y: 54 }],
    endPoint: { x: 192, y: 88 },
  }], { x: 0, y: 0 });

  assert.match(path, /C\s/);
  assert.match(path, /^M 0,0 C /);
  assert.doesNotMatch(path, /NaN|undefined/);
});

test("orthogonal label midpoint follows the route length", () => {
  const midpoint = orthogonalPathMidpoint([{
    startPoint: { x: 0, y: 0 },
    bendPoints: [{ x: 100, y: 0 }, { x: 100, y: 100 }],
    endPoint: { x: 200, y: 100 },
  }], { x: 12, y: 8 });

  assert.deepEqual(midpoint, { x: 112, y: 58 });
});

test("empty relationship geometry is safe", () => {
  assert.equal(buildOrthogonalRelationshipPath([], { x: 0, y: 0 }), "");
  assert.deepEqual(orthogonalPathMidpoint([], { x: 4, y: 6 }), { x: 4, y: 6 });
});
