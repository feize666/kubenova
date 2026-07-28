import assert from "node:assert/strict";
import test from "node:test";
import { layoutTopologyGraph } from "../layout";

test("layoutTopologyGraph is deterministic regardless of input order", () => {
  const nodes = [
    { id: "service", width: 240, height: 72 },
    { id: "deployment", width: 240, height: 72 },
    { id: "pod", width: 240, height: 72 },
  ];
  const edges = [
    { id: "pod-service", source: "pod", target: "service" },
    { id: "deployment-pod", source: "deployment", target: "pod" },
  ];
  assert.deepEqual(
    Array.from(layoutTopologyGraph(nodes, edges).entries()),
    Array.from(layoutTopologyGraph([...nodes].reverse(), [...edges].reverse()).entries()),
  );
});
