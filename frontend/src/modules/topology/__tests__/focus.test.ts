import assert from "node:assert/strict";
import test from "node:test";
import type { TopologyGraph } from "../contract";
import { DEFAULT_TOPOLOGY_FOCUS_STATE, getTopologyNeighborhood, topologyFocusReducer } from "../focus";

const graph: TopologyGraph = {
  resources: [
    { id: "a", label: "a", kind: "Deployment", source: "workloads", status: "healthy" },
    { id: "b", label: "b", kind: "Pod", source: "workloads", status: "healthy" },
    { id: "c", label: "c", kind: "Service", source: "network", status: "healthy" },
    { id: "isolated", label: "isolated", kind: "Secret", source: "configuration", status: "unknown" },
  ],
  relations: [
    { id: "a-b", source: "a", target: "b", role: "owner" },
    { id: "b-c", source: "b", target: "c", role: "selector" },
  ],
};

test("getTopologyNeighborhood respects traversal depth and supports bidirectional neighbors", () => {
  assert.deepEqual(Array.from(getTopologyNeighborhood(graph, "b", 1)).sort(), ["a", "b", "c"]);
  assert.deepEqual(Array.from(getTopologyNeighborhood(graph, "a", 2)).sort(), ["a", "b", "c"]);
  assert.deepEqual(Array.from(getTopologyNeighborhood(graph, "missing", 2)), []);
});

test("topologyFocusReducer clamps depth and clears only the selected node", () => {
  const focused = topologyFocusReducer(DEFAULT_TOPOLOGY_FOCUS_STATE, { type: "focus", nodeId: "b", depth: 20 });
  assert.deepEqual(focused, { focusedNodeId: "b", depth: 8 });
  assert.deepEqual(topologyFocusReducer(focused, { type: "clear" }), { focusedNodeId: null, depth: 8 });
});
