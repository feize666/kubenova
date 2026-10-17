import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseKubejojoGraph,
  groupKubejojoGraph,
  layoutKubejojoGraph,
  type KubejojoResource,
  type KubejojoRelation,
} from "./index";

test("both endpoint types join the Service Node-Link component", async () => {
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
  for (const node of nodes.values()) {
    assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
  }
  const cards = [...nodes.values()];
  for (let left = 0; left < cards.length; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left];
      const b = cards[right];
      const overlaps = a.position.x < b.position.x + Number(b.style?.width)
        && a.position.x + Number(a.style?.width) > b.position.x
        && a.position.y < b.position.y + Number(b.style?.height)
        && a.position.y + Number(a.style?.height) > b.position.y;
      assert.equal(overlaps, false, `${a.id} and ${b.id} do not overlap`);
    }
  }
  assert.deepEqual(
    layout.edges.map((edge) => [edge.source, edge.target]).sort(),
    [
      ["svc", "ep"],
      ["svc", "slice"],
    ],
  );
});
