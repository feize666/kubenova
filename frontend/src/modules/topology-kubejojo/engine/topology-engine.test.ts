import assert from "node:assert/strict";
import test from "node:test";

// Explicit extensions let Node's built-in type stripper run these tests without a new dependency.
// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { normalizeTopologyGraphResponse } from "../../../lib/api/topology-graph.ts";
// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { applyTopologyCapacity, projectTopologyNeighborhood, TOPOLOGY_CAPACITY_LIMITS } from "./capacity.ts";
// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { getKubejojoRelationSemantics, makeKubejojoRelationId, makeKubejojoStableId } from "./relations.ts";
// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { collapseKubejojoGraph, getKubejojoLayoutPolicy, getKubejojoPartition, getKubejojoSelectionPath, groupKubejojoGraph, KUBEJOJO_LAYOUT_METRICS, layoutKubejojoGraph, partitionKubejojoRelations, type KubejojoGraphNode, type KubejojoRelation, type KubejojoResource } from "./index.ts";

const progressiveDisclosureResources: KubejojoResource[] = [
  { id: "deployment", kind: "Deployment", name: "checkout", namespace: "demo", instanceName: "checkout" },
  { id: "pod", kind: "Pod", name: "checkout-0", namespace: "demo", instanceName: "checkout" },
  { id: "service", kind: "Service", name: "checkout", namespace: "demo", instanceName: "checkout" },
  { id: "config", kind: "ConfigMap", name: "feature-flags", namespace: "demo", instanceName: "checkout" },
  { id: "secret", kind: "Secret", name: "registry", namespace: "ops", instanceName: "platform" },
];

const progressiveDisclosureRelations: KubejojoRelation[] = [
  { id: "owns", source: "deployment", target: "pod", type: "OWNS" },
  { id: "routes", source: "service", target: "pod", type: "ROUTES_TO" },
  { id: "uses-config", source: "pod", target: "config", type: "USES_CONFIG" },
];

function findGraphNode(root: KubejojoGraphNode, id: string): KubejojoGraphNode | undefined {
  if (root.id === id) return root;
  for (const child of root.nodes ?? []) {
    const found = findGraphNode(child, id);
    if (found) return found;
  }
  return undefined;
}

test("Graph V1 snapshots normalize into the V2 contract", () => {
  const snapshot = normalizeTopologyGraphResponse({
    timestamp: "2026-07-27T01:02:03.000Z",
    resources: [
      {
        id: "record-pod",
        recordId: "record-pod",
        source: "workloads",
        clusterId: "ack-a",
        namespace: "demo",
        kind: "Pod",
        name: "api-0",
        status: "healthy",
        instanceName: "api",
        nodeName: "worker-1",
        summary: "ready",
        detailLines: [],
        tags: ["app=api"],
        warnings: 0,
      },
      {
        id: "record-gateway",
        recordId: "record-gateway",
        source: "gateway",
        clusterId: "ack-a",
        namespace: "demo",
        kind: "Gateway",
        name: "public",
        status: "healthy",
        instanceName: null,
        nodeName: null,
        summary: "",
        detailLines: [],
        tags: [],
        warnings: 0,
      },
    ],
    relations: [{
      id: "legacy-owner",
      role: "owner",
      source: "deploy",
      target: "record-pod",
      label: "owns",
      direction: "outbound",
      evidence: ["metadata.ownerReferences"],
      ports: ["http:80"],
    }],
    coverage: {
      sources: {
        workloads: { records: 1, complete: true },
        network: { records: 2, complete: true },
        storage: { records: 0, complete: true },
        configuration: { records: 0, complete: true },
        gateway: { records: 1, complete: true },
      },
      warningRecords: 0,
    },
  });

  assert.equal(snapshot.schemaVersion, "2.0");
  assert.equal(snapshot.revision, "legacy:2026-07-27T01:02:03.000Z");
  assert.equal(snapshot.freshness.status, "fresh");
  assert.equal(snapshot.resources.find((resource) => resource.kind === "Gateway")?.source, "network");
  assert.equal(snapshot.resources.find((resource) => resource.kind === "Pod")?.identityKey, "ack-a:core:Pod:demo:api-0");
  assert.equal(snapshot.relations[0].type, "OWNS");
  assert.deepEqual(snapshot.relations[0].evidenceDetails, [{ kind: "unknown", detail: "metadata.ownerReferences" }]);
  assert.equal(snapshot.coverage.sources.network.records, 3);
  assert.equal(snapshot.coverage.sources.workloads.status, "complete");
});

test("typed relation semantics cover the four initial topology domains", () => {
  assert.deepEqual(
    ["OWNS", "ROUTES_TO", "BINDS", "USES_SECRET"].map((type) =>
      getKubejojoRelationSemantics(type as "OWNS" | "ROUTES_TO" | "BINDS" | "USES_SECRET").domain),
    ["workload", "network", "storage", "configuration"],
  );
  assert.equal(getKubejojoRelationSemantics(undefined, "policy").type, "GOVERNS");
  assert.equal(getKubejojoRelationSemantics(undefined, "config", "secretKeyRef").type, "USES_SECRET");
});

test("progressive disclosure folds scope, then component, then reveals resources", () => {
  const grouped = groupKubejojoGraph(
    progressiveDisclosureResources,
    progressiveDisclosureRelations,
    "namespace",
  );
  const scopeId = "scope:namespace:demo";
  const componentId = "component:deployment";
  const isolatedId = `isolated:${scopeId}:ConfigMap`;

  const global = collapseKubejojoGraph(grouped);
  assert.deepEqual(global.nodes?.map((node) => [node.id, node.collapsed]), [
    [scopeId, true],
    ["scope:namespace:ops", true],
  ]);

  const focusedScope = collapseKubejojoGraph(grouped, scopeId);
  assert.deepEqual(focusedScope.nodes?.map((node) => node.id), [scopeId]);
  assert.equal(focusedScope.nodes?.[0].collapsed, false);
  assert.equal(findGraphNode(focusedScope, componentId)?.collapsed, true);
  assert.equal(findGraphNode(focusedScope, isolatedId)?.collapsed, true);
  assert.equal(findGraphNode(focusedScope, "config")?.collapsed, false);
  assert.deepEqual(focusedScope.nodes?.[0].overlayEdges?.map((edge) => edge.id), ["uses-config"]);

  const focusedComponent = collapseKubejojoGraph(grouped, componentId);
  assert.deepEqual(focusedComponent.nodes?.map((node) => node.id), [componentId]);
  assert.equal(focusedComponent.nodes?.[0].collapsed, false);
  assert.deepEqual(
    focusedComponent.nodes?.[0].nodes?.map((node) => [node.id, node.collapsed]),
    [["deployment", false], ["service", false], ["pod", false]],
  );

  const focusedIsolated = collapseKubejojoGraph(grouped, isolatedId);
  assert.deepEqual(focusedIsolated.nodes?.map((node) => node.id), [isolatedId]);
  assert.equal(focusedIsolated.nodes?.[0].collapsed, false);
  assert.deepEqual(focusedIsolated.nodes?.[0].nodes?.map((node) => node.id), ["config"]);

  const expanded = collapseKubejojoGraph(grouped, null, true);
  assert.equal(findGraphNode(expanded, scopeId)?.collapsed, false);
  assert.equal(findGraphNode(expanded, componentId)?.collapsed, false);
  assert.equal(findGraphNode(expanded, isolatedId)?.collapsed, false);

  const globalFromRootSelection = collapseKubejojoGraph(grouped, "root");
  assert.equal(findGraphNode(globalFromRootSelection, scopeId)?.collapsed, true);
});

test("scope focus reveals component summaries before resource graphs", async () => {
  const connectedResources: KubejojoResource[] = Array.from({ length: 130 }, (_, index) => ({
    id: `connected-${String(index).padStart(3, "0")}`,
    kind: index === 0 ? "Deployment" : "Pod",
    name: index === 0 ? "api" : `api-${String(index).padStart(3, "0")}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const isolatedReplicaSets: KubejojoResource[] = Array.from({ length: 122 }, (_, index) => ({
    id: `isolated-rs-${String(index).padStart(3, "0")}`,
    kind: "ReplicaSet",
    name: `api-${String(index).padStart(3, "0")}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const isolatedConfigMaps: KubejojoResource[] = Array.from({ length: 35 }, (_, index) => ({
    id: `isolated-config-${String(index).padStart(3, "0")}`,
    kind: "ConfigMap",
    name: `config-${String(index).padStart(3, "0")}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const relations: KubejojoRelation[] = Array.from({ length: 339 }, (_, index) => ({
    id: `relation-${String(index).padStart(3, "0")}`,
    source: connectedResources[index % connectedResources.length].id,
    target: connectedResources[(index + 1) % connectedResources.length].id,
    type: "OWNS",
  }));
  const scopeId = "scope:namespace:prod";
  const grouped = groupKubejojoGraph(
    [...connectedResources, ...isolatedReplicaSets, ...isolatedConfigMaps],
    relations,
    "namespace",
  );

  assert.deepEqual(collapseKubejojoGraph(grouped).nodes?.map((node) => [node.id, node.collapsed]), [
    [scopeId, true],
  ]);

  const focusedScope = collapseKubejojoGraph(grouped, scopeId);
  const scope = focusedScope.nodes?.[0];
  const connectedComponent = scope?.nodes?.find((node) => node.groupKind === "component");
  const isolatedGroups = scope?.nodes?.filter((node) => node.groupKind === "isolated") ?? [];

  assert.equal(connectedComponent?.nodes?.length, 130);
  assert.equal(connectedComponent?.collapsed, true);
  assert.deepEqual(
    isolatedGroups.map((node) => [node.label, node.nodes?.length, node.collapsed]),
    [
      ["ReplicaSet（无关联）", 122, true],
      ["ConfigMap（无关联）", 35, true],
    ],
  );

  const layout = await layoutKubejojoGraph(focusedScope, 1.6);
  assert.equal(layout.edges.length, 0, "scope focus must not expand component edges prematurely");
  assert.ok(layout.nodes.some((node) => node.id === `isolated:${scopeId}:ReplicaSet`));
  assert.ok(!layout.nodes.some((node) => node.id === isolatedReplicaSets[0].id));

  const focusedComponent = collapseKubejojoGraph(grouped, connectedComponent!.id);
  const componentLayout = await layoutKubejojoGraph(focusedComponent, 1.6);
  assert.ok(componentLayout.edges.length > 0, "component focus must reveal the resource relationship graph");
  assert.ok(componentLayout.nodes.some((node) => node.id === connectedResources[0].id));
});

test("configuration relations stay as overlays and do not merge backbone components", () => {
  const resources: KubejojoResource[] = [
    { id: "deploy-a", kind: "Deployment", name: "api-a", namespace: "prod" },
    { id: "pod-a", kind: "Pod", name: "api-a-0", namespace: "prod" },
    { id: "deploy-b", kind: "Deployment", name: "api-b", namespace: "prod" },
    { id: "pod-b", kind: "Pod", name: "api-b-0", namespace: "prod" },
    { id: "shared-config", kind: "ConfigMap", name: "shared", namespace: "prod" },
    { id: "default-sa", kind: "ServiceAccount", name: "default", namespace: "prod" },
  ];
  const relations: KubejojoRelation[] = [
    { id: "owns-a", source: "deploy-a", target: "pod-a", type: "OWNS" },
    { id: "owns-b", source: "deploy-b", target: "pod-b", type: "OWNS" },
    { id: "config-a", source: "pod-a", target: "shared-config", type: "USES_CONFIG" },
    { id: "config-b", source: "pod-b", target: "shared-config", type: "USES_CONFIG" },
    { id: "sa-a", source: "pod-a", target: "default-sa", type: "USES_SERVICE_ACCOUNT" },
    { id: "sa-b", source: "pod-b", target: "default-sa", type: "USES_SERVICE_ACCOUNT" },
    { id: "scope-only", source: "deploy-a", target: "deploy-b", type: "GROUPS" },
  ];

  const partitioned = partitionKubejojoRelations(relations);
  assert.deepEqual(partitioned.backbone.map((edge) => edge.id), ["owns-a", "owns-b"]);
  assert.deepEqual(partitioned.overlays.map((edge) => edge.id), ["config-a", "config-b", "sa-a", "sa-b", "scope-only"]);

  const grouped = groupKubejojoGraph(resources, relations, "namespace");
  const scope = grouped.nodes?.[0];
  const components = scope?.nodes?.filter((node) => node.groupKind === "component") ?? [];
  assert.equal(components.length, 2);
  assert.deepEqual(components.map((component) => component.nodes?.map((node) => node.id).sort()), [
    ["deploy-a", "pod-a"],
    ["deploy-b", "pod-b"],
  ]);
  assert.deepEqual(scope?.overlayEdges?.map((edge) => edge.id), ["config-a", "config-b", "sa-a", "sa-b", "scope-only"]);
  assert.deepEqual(
    scope?.nodes?.filter((node) => node.groupKind === "isolated").map((node) => node.label),
    ["ConfigMap（无关联）", "ServiceAccount（无关联）"],
  );

  const neighborhood = groupKubejojoGraph(resources, relations, "namespace", true);
  const neighborhoodScope = neighborhood.nodes?.[0];
  const neighborhoodComponents = neighborhoodScope?.nodes?.filter((node) => node.groupKind === "component") ?? [];
  assert.equal(neighborhoodComponents.length, 1);
  assert.deepEqual(
    neighborhoodComponents[0]?.edges?.map((edge) => edge.id),
    ["config-a", "config-b", "owns-a", "owns-b", "sa-a", "sa-b", "scope-only"],
  );
});

test("selection paths and grouped identities remain deterministic", () => {
  const forward = groupKubejojoGraph(
    progressiveDisclosureResources,
    progressiveDisclosureRelations,
    "namespace",
  );
  const reversed = groupKubejojoGraph(
    [...progressiveDisclosureResources].reverse(),
    [...progressiveDisclosureRelations].reverse(),
    "namespace",
  );

  assert.deepEqual(forward, reversed);
  assert.deepEqual(
    getKubejojoSelectionPath(forward, "pod").map(({ id, kind, resourceCount }) => ({ id, kind, resourceCount })),
    [
      { id: "root", kind: "root", resourceCount: 5 },
      { id: "scope:namespace:demo", kind: "scope", resourceCount: 4 },
      { id: "component:deployment", kind: "component", resourceCount: 3 },
      { id: "pod", kind: "resource", resourceCount: 1 },
    ],
  );
  assert.deepEqual(
    getKubejojoSelectionPath(forward, "config").map(({ id, kind, resourceCount }) => ({ id, kind, resourceCount })),
    [
      { id: "root", kind: "root", resourceCount: 5 },
      { id: "scope:namespace:demo", kind: "scope", resourceCount: 4 },
      { id: "isolated:scope:namespace:demo:ConfigMap", kind: "isolated", resourceCount: 1 },
      { id: "config", kind: "resource", resourceCount: 1 },
    ],
  );
  assert.deepEqual(getKubejojoSelectionPath(forward, "missing").map((item) => item.id), ["root"]);
});

test("layout policy uses real aspect ratio, edge presence, weight, and stable compact metrics", () => {
  assert.deepEqual(getKubejojoLayoutPolicy(true, 1.8), {
    algorithm: "layered",
    direction: "RIGHT",
    aspectRatio: 1.8,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(true, 0.72), {
    algorithm: "layered",
    direction: "DOWN",
    aspectRatio: 0.72,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(false, 0.72), {
    algorithm: "rectpacking",
    direction: "DOWN",
    aspectRatio: 0.72,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(false, 0), {
    algorithm: "rectpacking",
    direction: "RIGHT",
    aspectRatio: 1.6,
  });
  assert.equal(getKubejojoPartition({ id: "weighted", weight: 73 }), -73);
  assert.equal(getKubejojoPartition({ id: "deployment", resource: progressiveDisclosureResources[0] }), -980);
  assert.deepEqual(KUBEJOJO_LAYOUT_METRICS, {
    nodeWidth: 220,
    nodeHeight: 88,
    groupWidth: 260,
    groupHeight: 132,
    layeredNodeSpacing: 32,
    layeredLayerSpacing: 44,
    packedNodeSpacing: 14,
  });
});

test("capacity limits are exact and over-limit graphs use semantic aggregation", () => {
  const atLimit = Array.from({ length: TOPOLOGY_CAPACITY_LIMITS.defaultCanvas.nodes }, (_, index) => ({
    id: `node-${String(index).padStart(4, "0")}`,
    kind: "Pod",
    namespace: "demo",
    instanceName: "api",
  }));
  const complete = applyTopologyCapacity(atLimit, [], "defaultCanvas");
  assert.equal(complete.capacity.complete, true);
  assert.equal(complete.capacity.strategy, "none");
  assert.deepEqual(complete.capacity.represented, complete.capacity.input);

  const overLimit = [...atLimit, {
    id: "node-overflow",
    kind: "Secret",
    namespace: "demo",
    instanceName: "api",
  }];
  const aggregated = applyTopologyCapacity(overLimit, [], "defaultCanvas");
  assert.ok(aggregated.resources.length <= TOPOLOGY_CAPACITY_LIMITS.defaultCanvas.nodes);
  assert.equal(aggregated.capacity.strategy, "semantic-aggregation");
  assert.deepEqual(aggregated.capacity.omitted, { nodes: 0, edges: 0, byKind: {} });
  assert.equal(
    aggregated.resources.reduce((count, resource) => count + (resource.aggregation?.memberCount ?? 1), 0),
    overLimit.length,
  );
  assert.deepEqual(
    aggregated.resources.find((resource) => resource.aggregation?.membersByKind.Pod === atLimit.length)?.aggregation?.membersByKind,
    { Pod: atLimit.length },
  );

  const reservedForGroups = applyTopologyCapacity(overLimit, [], "defaultCanvas", {
    maxVisibleNodes: 587,
  });
  assert.ok(reservedForGroups.resources.length <= 587);
  assert.equal(reservedForGroups.capacity.limits.nodes, 600);

  const edgeResources = [{ id: "source" }, { id: "target" }];
  const edges = Array.from({ length: TOPOLOGY_CAPACITY_LIMITS.defaultCanvas.edges + 1 }, (_, index) => ({
    id: `edge-${String(index).padStart(4, "0")}`,
    source: "source",
    target: "target",
  }));
  const edgeLimited = applyTopologyCapacity(edgeResources, edges, "defaultCanvas");
  assert.equal(edgeLimited.relations.length, 1);
  assert.equal(edgeLimited.relations[0].aggregation?.memberCount, 2_001);
  assert.equal(edgeLimited.capacity.omitted.edges, 0);
  assert.deepEqual(edgeLimited.capacity.represented, edgeLimited.capacity.input);
});

test("capacity aggregation is deterministic and Kubernetes-derived IDs are stable", () => {
  const resources = [
    { id: "b", kind: "Pod", weight: 10 },
    { id: "a", kind: "Deployment", weight: 10 },
    { id: "c", kind: "Service", weight: 20 },
  ];
  const relations = [
    { id: "z", source: "c", target: "b" },
    { id: "a", source: "c", target: "a" },
  ];
  const forward = applyTopologyCapacity(resources, relations, "defaultCanvas");
  const reversed = applyTopologyCapacity([...resources].reverse(), [...relations].reverse(), "defaultCanvas");
  assert.deepEqual(forward.resources.map((resource) => resource.id), ["c", "a", "b"]);
  assert.deepEqual(forward, reversed);
  assert.equal(makeKubejojoStableId({ clusterId: "ack", uid: "uid-1", kind: "Pod", name: "api" }), "ack:uid:uid-1");
  assert.equal(
    makeKubejojoStableId({ clusterId: "ack", apiVersion: "apps/v1", kind: "Deployment", namespace: "demo", name: "api" }),
    "ack:apps%2Fv1:Deployment:demo:api",
  );
  assert.equal(makeKubejojoRelationId("OWNS", "deploy", "pod"), "OWNS:deploy->pod");

  const largeResources = Array.from({ length: 602 }, (_, index) => ({
    id: `pod-${String(index).padStart(4, "0")}`,
    kind: index % 5 ? "Pod" : "Service",
    namespace: `namespace-${index % 3}`,
    instanceName: `instance-${index % 7}`,
  }));
  const largeRelations = Array.from({ length: 2_100 }, (_, index) => ({
    id: `relation-${String(index).padStart(4, "0")}`,
    source: largeResources[index % largeResources.length].id,
    target: largeResources[(index * 13 + 1) % largeResources.length].id,
    type: index % 2 ? "OWNS" : "SELECTS",
  }));
  const projectedForward = applyTopologyCapacity(largeResources, largeRelations, "defaultCanvas");
  const projectedReverse = applyTopologyCapacity(
    [...largeResources].reverse(),
    [...largeRelations].reverse(),
    "defaultCanvas",
  );
  assert.deepEqual(projectedForward, projectedReverse);
  assert.match(projectedForward.resources.find((resource) => resource.aggregation)?.id ?? "", /^capacity:resource:/);
  assert.match(projectedForward.relations.find((relation) => relation.aggregation)?.id ?? "", /^capacity:relation:/);
  const aggregate = projectedForward.resources.find((resource) => resource.aggregation)?.aggregation;
  assert.ok(aggregate);
  assert.equal(aggregate.representativeId, aggregate.memberIds[0]);
  assert.equal(aggregate.memberIds.length, aggregate.memberCount);
  assert.equal(new Set(aggregate.memberIds).size, aggregate.memberCount);
  assert.deepEqual(
    aggregate.memberIds,
    projectedReverse.resources.find((resource) => resource.aggregation)?.aggregation?.memberIds,
  );
});

test("capacity aggregation preserves the worst member status and warnings", () => {
  const projected = applyTopologyCapacity([
    {
      id: "deployment",
      kind: "Deployment",
      namespace: "demo",
      instanceName: "checkout",
      weight: 980,
      status: "healthy",
      warnings: [],
    },
    {
      id: "pod",
      kind: "Pod",
      namespace: "demo",
      instanceName: "checkout",
      weight: 820,
      status: "critical",
      warnings: ["CrashLoopBackOff"],
    },
  ], [], "defaultCanvas", { maxVisibleNodes: 1 });
  const aggregate = projected.resources[0];

  assert.equal(aggregate.status, "critical");
  assert.deepEqual(aggregate.warnings, ["CrashLoopBackOff"]);

  const numericWarnings = applyTopologyCapacity([
    { id: "service-a", kind: "Service", namespace: "demo", status: "healthy", warnings: 0 },
    { id: "service-b", kind: "Service", namespace: "demo", status: "pending", warnings: 2 },
  ], [], "defaultCanvas", { maxVisibleNodes: 1 }).resources[0];
  assert.equal(numericWarnings.status, "warning");
  assert.equal(numericWarnings.warnings, 2);
});

test("pinned resources survive aggregation and relation endpoints are remapped", () => {
  const resources = Array.from({ length: 602 }, (_, index) => ({
    id: `node-${String(index).padStart(4, "0")}`,
    kind: "Pod",
    namespace: "production",
    instanceName: "checkout",
    marker: `original-${index}`,
  }));
  const pinned = resources.at(-1)!;
  const relations = [
    { id: "pinned-to-member", source: pinned.id, target: resources[0].id, type: "OWNS" },
    { id: "member-to-member", source: resources[0].id, target: resources[1].id, type: "SELECTS" },
  ];
  const projected = applyTopologyCapacity(resources, relations, "defaultCanvas", { pinnedIds: [pinned.id] });
  const aggregate = projected.resources.find((resource) => resource.aggregation);

  assert.equal(projected.resources.find((resource) => resource.id === pinned.id), pinned);
  assert.ok(aggregate);
  assert.equal(aggregate.aggregation?.memberCount, resources.length - 1);
  assert.equal(aggregate.aggregation?.membersByKind.Pod, resources.length - 1);
  assert.ok(projected.relations.some((relation) => relation.source === pinned.id && relation.target === aggregate.id));
  assert.ok(projected.relations.some((relation) => relation.source === aggregate.id && relation.target === aggregate.id));
  assert.equal(
    projected.relations.reduce((count, relation) => count + (relation.aggregation?.memberCount ?? 1), 0),
    relations.length,
  );
  assert.deepEqual(projected.capacity.represented, projected.capacity.input);
  assert.deepEqual(projected.capacity.omitted, { nodes: 0, edges: 0, byKind: {} });
});

test("an over-limit neighborhood preserves its focus resource", () => {
  const focus = { id: "focus", kind: "Deployment", namespace: "production", instanceName: "checkout" };
  const neighbors = Array.from({ length: 400 }, (_, index) => ({
    id: `neighbor-${String(index).padStart(4, "0")}`,
    kind: "Pod",
    namespace: "production",
    instanceName: "checkout",
  }));
  const relations = neighbors.map((neighbor, index) => ({
    id: `focus-edge-${String(index).padStart(4, "0")}`,
    source: focus.id,
    target: neighbor.id,
    type: "OWNS",
  }));
  const projected = projectTopologyNeighborhood([focus, ...neighbors], relations, focus.id, 1);

  assert.equal(projected.resources.find((resource) => resource.id === focus.id), focus);
  assert.ok(projected.resources.length <= TOPOLOGY_CAPACITY_LIMITS.neighborhood.nodes);
  assert.ok(projected.relations.length <= TOPOLOGY_CAPACITY_LIMITS.neighborhood.edges);
  assert.equal(
    projected.resources.reduce((count, resource) => count + (resource.aggregation?.memberCount ?? 1), 0),
    neighbors.length + 1,
  );
  assert.equal(projected.relations[0].aggregation?.memberCount, relations.length);
});

test("every capacity mode stays within budget without silently omitting valid graph members", () => {
  for (const mode of ["backend", "expanded", "defaultCanvas", "neighborhood"] as const) {
    const limits = TOPOLOGY_CAPACITY_LIMITS[mode];
    const resources = Array.from({ length: limits.nodes + 1 }, (_, index) => ({
      id: `${mode}-node-${String(index).padStart(5, "0")}`,
      kind: index % 2 ? "Pod" : "ConfigMap",
      namespace: "capacity-test",
      instanceName: "fixture",
    }));
    const relations = Array.from({ length: limits.edges + 1 }, (_, index) => ({
      id: `${mode}-edge-${String(index).padStart(5, "0")}`,
      source: resources[index % resources.length].id,
      target: resources[(index + 1) % resources.length].id,
      type: index % 2 ? "OWNS" : "USES_CONFIG",
    }));
    const projected = applyTopologyCapacity(resources, relations, mode);
    const representedNodes = projected.resources.reduce(
      (count, resource) => count + (resource.aggregation?.memberCount ?? 1),
      0,
    );
    const representedEdges = projected.relations.reduce(
      (count, relation) => count + (relation.aggregation?.memberCount ?? 1),
      0,
    );

    assert.ok(projected.resources.length <= limits.nodes, `${mode} node budget`);
    assert.ok(projected.relations.length <= limits.edges, `${mode} edge budget`);
    assert.equal(representedNodes, resources.length, `${mode} resource accounting`);
    assert.equal(representedEdges, relations.length, `${mode} relation accounting`);
    assert.deepEqual(projected.capacity.represented, projected.capacity.input);
    assert.equal(projected.capacity.strategy, "semantic-aggregation");
  }
});
