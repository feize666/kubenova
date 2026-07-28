import assert from "node:assert/strict";
import test from "node:test";
import { collapseTopologyGraph, getConnectedComponents, groupTopologyGraph, setTopologyGroupCollapsed } from "./grouping";
import { makeTopologyGraph } from "./model";
import { projectTopologyGraph } from "./projection";

const resources = [
  { id: "deploy", label: "api", kind: "Deployment", namespace: "platform", instance: "api", nodeName: "worker-a" },
  { id: "pod-a", label: "api-1", kind: "Pod", namespace: "platform", instance: "api", nodeName: "worker-a" },
  { id: "pod-b", label: "api-2", kind: "Pod", namespace: "platform", instance: "api", nodeName: "worker-b" },
  { id: "service", label: "api", kind: "Service", namespace: "platform" },
  { id: "lonely", label: "orphan", kind: "ConfigMap", namespace: "ops" },
];
const relations = [
  { id: "owner-a", source: "deploy", target: "pod-a" },
  { id: "owner-b", source: "deploy", target: "pod-b" },
  { id: "select-a", source: "service", target: "pod-a" },
  { id: "select-b", source: "service", target: "pod-b" },
];

test("connected components retain isolated resources", () => {
  const components = getConnectedComponents(makeTopologyGraph(resources, relations));
  assert.equal(components.length, 2);
  assert.equal(components.find((node) => node.id === "lonely")?.label, "orphan");
});

test("namespace grouping nests connected components", () => {
  const root = groupTopologyGraph(makeTopologyGraph(resources, relations), "namespace");
  assert.deepEqual(root.children?.map((node) => node.id), ["namespace:platform", "namespace:ops"]);
  assert.equal(root.children?.[0].children?.[0].id, "component:deploy");
});

test("collapse and expand update groups without mutating the source tree", () => {
  const root = groupTopologyGraph(makeTopologyGraph(resources, relations), "namespace");
  const collapsed = setTopologyGroupCollapsed(root, "namespace:platform", true);
  assert.equal(root.children?.[0].collapsed, undefined);
  assert.equal(collapsed.children?.[0].collapsed, true);
  assert.equal(collapseTopologyGraph(root, { expandAll: true }).children?.[0].collapsed, false);
});

test("projection aggregates relations at collapsed group boundaries and marks focus", () => {
  const root = {
    id: "topology-root",
    children: [
      { id: "left", label: "left", collapsed: true, children: [{ id: "left-a" }, { id: "left-b" }] },
      { id: "right", label: "right", collapsed: true, children: [{ id: "right-a" }] },
    ],
    edges: [
      { id: "one", source: "left-a", target: "right-a" },
      { id: "two", source: "left-b", target: "right-a" },
    ],
  };
  const projection = projectTopologyGraph(root, "left");
  assert.equal(projection.nodes.length, 2);
  assert.equal(projection.nodes.find((node) => node.id === "left")?.data.viewState, "focused");
  assert.equal(projection.edges.length, 1);
  const edge = projection.edges[0];
  assert.ok(edge?.data);
  assert.equal(edge.data.aggregated, true);
  assert.equal(edge.data.relations.length, 2);
  assert.equal(projectTopologyGraph(root, "left-a").nodes.find((node) => node.id === "left")?.data.viewState, "focused");
});
