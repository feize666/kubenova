import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseKubejojoGraph,
  groupKubejojoGraph,
  layoutKubejojoGraph,
  type KubejojoResource,
  type KubejojoRelation,
} from "./index";

test("both endpoint types join the Service component and render to its right", async () => {
  const resources: KubejojoResource[] = [
    { id: "svc", name: "api", kind: "Service", namespace: "apps" },
    { id: "ep", name: "api", kind: "Endpoints", namespace: "apps" },
    {
      id: "slice",
      name: "api-slice",
      kind: "EndpointSlice",
      namespace: "apps",
    },
  ];
  const relations: KubejojoRelation[] = [
    { id: "s-e", source: "svc", target: "ep", type: "PUBLISHES" },
    { id: "s-s", source: "svc", target: "slice", type: "PUBLISHES" },
  ];
  const graph = groupKubejojoGraph(resources, relations, "namespace");
  const overview = collapseKubejojoGraph(graph, "group:namespace:apps");
  assert.deepEqual(
    overview.nodes?.map((node) => node.id),
    ["component:svc"],
  );
  const scene = collapseKubejojoGraph(graph, "component:svc");
  assert.deepEqual(scene.nodes?.map((node) => node.id).sort(), [
    "ep",
    "slice",
    "svc",
  ]);
  const layout = await layoutKubejojoGraph(scene, 1.6);
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.ok(nodes.get("svc")!.position.x < nodes.get("ep")!.position.x);
  assert.equal(nodes.get("ep")!.position.x, nodes.get("slice")!.position.x);
  assert.deepEqual(
    layout.edges.map((edge) => [edge.source, edge.target]).sort(),
    [
      ["svc", "ep"],
      ["svc", "slice"],
    ],
  );
});
