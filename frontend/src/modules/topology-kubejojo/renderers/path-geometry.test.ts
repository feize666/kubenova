import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { buildRelationshipPath, relationshipPathMidpoint } from "./path-geometry.ts";

test("an ELK spline is painted as one cubic curve", () => {
  const path = buildRelationshipPath([{
    startPoint: { x: 0, y: 44 },
    bendPoints: [{ x: 96, y: 44 }, { x: 96, y: 132 }],
    endPoint: { x: 192, y: 132 },
  }], { x: 12, y: 8 });

  // Headlamp's exact command shape: one move, then one cubic through both
  // ELK control points.
  assert.equal(path, "M 12,52 C 108,52 108,140 204,140");
  assert.doesNotMatch(path, /NaN|undefined/);
});

test("a spline without control points still renders as the same curve family", () => {
  const path = buildRelationshipPath([{
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 300, y: 60 },
  }], { x: 0, y: 0 });

  assert.equal(path, "M 0,0 C 100,0 200,60 300,60");
  assert.doesNotMatch(path, /NaN|undefined/);
});

test("consecutive sections sharing an endpoint stay one stroke", () => {
  const path = buildRelationshipPath([
    { startPoint: { x: 0, y: 0 }, bendPoints: [{ x: 50, y: 0 }, { x: 100, y: 0 }], endPoint: { x: 100, y: 0 } },
    { startPoint: { x: 100, y: 0 }, bendPoints: [{ x: 150, y: 0 }, { x: 200, y: 0 }], endPoint: { x: 200, y: 0 } },
  ], { x: 0, y: 0 });

  assert.equal(path.match(/M /g)?.length, 1, "a continuous rail must not restart");
});

test("long ELK obstacle routes collapse to one separated rail", () => {
  const path = buildRelationshipPath([{
    startPoint: { x: 0, y: 40 },
    bendPoints: [
      { x: 40, y: 42 }, { x: 80, y: 44 }, { x: 120, y: 46 },
      { x: 160, y: 48 }, { x: 200, y: 50 },
    ],
    endPoint: { x: 320, y: 260 },
  }], { x: 0, y: 0 });

  assert.equal(path.match(/C /g)?.length, 3);
  assert.doesNotMatch(path, /NaN|undefined/);
});

test("the label anchor follows the cubic curve", () => {
  const midpoint = relationshipPathMidpoint([{
    startPoint: { x: 0, y: 0 },
    bendPoints: [{ x: 100, y: 0 }, { x: 100, y: 100 }],
    endPoint: { x: 200, y: 100 },
  }], { x: 12, y: 8 });

  assert.deepEqual(midpoint, { x: 112, y: 58 });
});

test("empty relationship geometry is safe", () => {
  assert.equal(buildRelationshipPath([], { x: 0, y: 0 }), "");
  assert.deepEqual(relationshipPathMidpoint([], { x: 4, y: 6 }), { x: 4, y: 6 });
});
