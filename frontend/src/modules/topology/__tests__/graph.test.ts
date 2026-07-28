import assert from "node:assert/strict";
import test from "node:test";
import type { TopologyGraph } from "../contract";
import { getCollapsedGroupIds, buildTopologyView, aggregateTopologyRelations } from "../graph";

const graph: TopologyGraph = {
  resources: [
    { id: "deploy", label: "api", kind: "Deployment", source: "workloads", status: "healthy", namespace: "demo" },
    { id: "pod", label: "api-123", kind: "Pod", source: "workloads", status: "warning", namespace: "demo" },
    { id: "service", label: "api", kind: "Service", source: "network", status: "healthy", namespace: "edge" },
  ],
  relations: [
    { id: "r2", source: "deploy", target: "pod", role: "owner", label: "owns" },
    { id: "r1", source: "deploy", target: "pod", role: "owner", label: "owns" },
    { id: "r3", source: "pod", target: "service", role: "selector" },
  ],
};

test("aggregateTopologyRelations combines duplicate directed relationships deterministically", () => {
  assert.deepEqual(aggregateTopologyRelations([...graph.relations].reverse()), [
    { id: "aggregate:owner:deploy->pod", source: "deploy", target: "pod", role: "owner", label: "owns", relationIds: ["r1", "r2"], count: 2, data: undefined },
    { id: "aggregate:selector:pod->service", source: "pod", target: "service", role: "selector", label: undefined, relationIds: ["r3"], count: 1, data: undefined },
  ]);
});

test("buildTopologyView folds collapsed groups and aggregates their cross-group edges", () => {
  const expanded = buildTopologyView(graph, { groupBy: "namespace" });
  const view = buildTopologyView(graph, { groupBy: "namespace", collapsedGroupIds: getCollapsedGroupIds(expanded.groups) });
  assert.deepEqual(view.nodes.map((node) => node.id), ["group:namespace:demo", "group:namespace:edge"]);
  assert.deepEqual(view.relations.map((relation) => ({ source: relation.source, target: relation.target, role: relation.role, count: relation.count })), [
    { source: "group:namespace:demo", target: "group:namespace:edge", role: "selector", count: 1 },
  ]);
});
