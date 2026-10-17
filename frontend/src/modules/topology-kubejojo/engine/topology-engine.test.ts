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
import { clearKubejojoLayoutCache, collapseKubejojoGraph, containerLayoutOptions, getKubejojoAccessPathOrder, getKubejojoLayoutPolicy, getKubejojoSelectionPath, getKubejojoWeight, groupKubejojoGraph, isTopologyRootKind, KUBEJOJO_COLLAPSE_THRESHOLD, KUBEJOJO_LAYOUT_METRICS, layoutKubejojoGraph, partitionKubejojoRelations, projectTopologyDisplayMode, projectTopologyRoot, resolveTopologyRoot, containerRelations, filterTopologyGraph, parseTopologyUrlState, serializeTopologyUrlState, toElkGraph, type KubejojoGraphNode, type KubejojoRelation, type KubejojoResource } from "./index.ts";

test("domain filtering removes dangling edges and restores them", () => {
  const resources = [
    { id: "pod", kind: "Pod", source: "workloads" },
    { id: "svc", kind: "Service", source: "network" },
  ];
  const relations = [{ id: "r", source: "pod", target: "svc", type: "ROUTES_TO" as const }];
  const hidden = filterTopologyGraph(resources, relations, new Set(["workloads"]));
  assert.deepEqual(hidden.resources.map((r) => r.id), ["pod"]);
  assert.equal(hidden.relations.length, 0);
  const restored = filterTopologyGraph(resources, relations, new Set(["workloads", "network"]));
  assert.equal(restored.relations.length, 1);
});

test("topology URL state round-trips namespace, domains, search and groupBy", () => {
  const state = parseTopologyUrlState("?namespace=prod&domains=workloads,network&search=api%20v1&groupBy=node");
  assert.deepEqual(serializeTopologyUrlState(state), "namespace=prod&domains=workloads%2Cnetwork&search=api+v1&groupBy=node");
});

test("only workload resources can start a topology scene", () => {
  assert.equal(isTopologyRootKind("Deployment"), true);
  assert.equal(isTopologyRootKind("StatefulSet"), true);
  assert.equal(isTopologyRootKind("DaemonSet"), true);
  assert.equal(isTopologyRootKind("Namespace"), false);
  assert.equal(isTopologyRootKind("Service"), false);
  assert.equal(isTopologyRootKind("Pod"), false);
  assert.equal(isTopologyRootKind("ConfigMap"), false);
});

test("root resolution requires a workload kind and exact identity", () => {
  const resources = [
    { id: "deploy-api", kind: "Deployment", name: "api", namespace: "prod" },
    { id: "service-api", kind: "Service", name: "api", namespace: "prod" },
  ];
  assert.equal(resolveTopologyRoot(resources, "Namespace", "prod", "prod"), null);
  assert.equal(resolveTopologyRoot(resources, "Deployment", "api", "prod")?.id, "deploy-api");
  assert.equal(resolveTopologyRoot(resources, "Deployment", "api", "staging"), null);
});

test("workload root projection keeps the full connected chain without making a namespace root", () => {
  const resources = [
    { id: "deploy-api", kind: "Deployment", name: "api" },
    { id: "rs-api", kind: "ReplicaSet", name: "api-rs" },
    { id: "pod-api", kind: "Pod", name: "api-0" },
    { id: "svc-api", kind: "Service", name: "api" },
    { id: "endpoint-api", kind: "EndpointSlice", name: "api-1" },
    { id: "other-deploy", kind: "Deployment", name: "other" },
  ];
  const relations = [
    { id: "deploy-rs", source: "deploy-api", target: "rs-api", type: "OWNS" as const },
    { id: "rs-pod", source: "rs-api", target: "pod-api", type: "OWNS" as const },
    { id: "svc-pod", source: "svc-api", target: "pod-api", type: "SELECTS" as const },
    { id: "svc-endpoint", source: "svc-api", target: "endpoint-api", type: "BACKENDS" as const },
    { id: "unrelated", source: "other-deploy", target: "other-deploy", type: "OWNS" as const },
  ];
  const projection = projectTopologyRoot(resources, relations, "deploy-api");
  assert.deepEqual(
    projection.resources.map((resource) => resource.id).sort(),
    ["deploy-api", "rs-api", "pod-api", "svc-api", "endpoint-api"].sort(),
  );
  assert.deepEqual(
    projection.relations.map((relation) => relation.id).sort(),
    ["deploy-rs", "rs-pod", "svc-pod", "svc-endpoint"].sort(),
  );
  assert.equal(projectTopologyRoot(resources, relations, "missing").resources.length, 0);
});

test("workload root projection does not cross shared resources into another workload", () => {
  const resources = [
    { id: "deploy-a", kind: "Deployment", name: "api-a", namespace: "prod" },
    { id: "rs-a", kind: "ReplicaSet", name: "api-a-rs", namespace: "prod" },
    { id: "pod-a", kind: "Pod", name: "api-a-0", namespace: "prod" },
    { id: "deploy-b", kind: "Deployment", name: "api-b", namespace: "prod" },
    { id: "rs-b", kind: "ReplicaSet", name: "api-b-rs", namespace: "prod" },
    { id: "pod-b", kind: "Pod", name: "api-b-0", namespace: "prod" },
    { id: "shared-service", kind: "Service", name: "api", namespace: "prod" },
    { id: "shared-config", kind: "ConfigMap", name: "shared", namespace: "prod" },
  ];
  const relations = [
    { id: "owns-a-rs", source: "deploy-a", target: "rs-a", type: "OWNS" as const },
    { id: "owns-a-pod", source: "rs-a", target: "pod-a", type: "OWNS" as const },
    { id: "owns-b-rs", source: "deploy-b", target: "rs-b", type: "OWNS" as const },
    { id: "owns-b-pod", source: "rs-b", target: "pod-b", type: "OWNS" as const },
    { id: "selects-a", source: "shared-service", target: "pod-a", type: "SELECTS" as const },
    { id: "selects-b", source: "shared-service", target: "pod-b", type: "SELECTS" as const },
    { id: "config-a", source: "pod-a", target: "shared-config", type: "USES_CONFIG" as const },
    { id: "config-b", source: "pod-b", target: "shared-config", type: "USES_CONFIG" as const },
  ];

  const projection = projectTopologyRoot(resources, relations, "deploy-a");
  assert.deepEqual(
    projection.resources.map((resource) => resource.id).sort(),
    ["deploy-a", "rs-a", "pod-a", "shared-service", "shared-config"].sort(),
  );
  assert.equal(projection.relations.some((relation) => relation.id.endsWith("-b")), false);
});

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

function collectNodeIds(root: KubejojoGraphNode): string[] {
  return [root.id, ...(root.nodes ?? []).flatMap(collectNodeIds)];
}

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

test("resource-kind priorities follow Headlamp partition ordering", () => {
  const weight = (kind: string) => getKubejojoAccessPathOrder({
    id: kind,
    resource: { id: kind, kind, name: kind },
  });
  assert.ok(weight("Deployment") > weight("ReplicaSet"));
  assert.ok(weight("ReplicaSet") > weight("Pod"));
  assert.ok(weight("Pod") > weight("Service"));
  assert.ok(weight("Service") > weight("EndpointSlice"));
  assert.equal(weight("Endpoints"), weight("EndpointSlice"));
  assert.equal(weight("TCPRoute"), weight("HTTPRoute"));
  assert.ok(weight("GatewayClass") > weight("Gateway"));
  assert.ok(weight("Pod") > weight("PersistentVolumeClaim"));
  assert.ok(weight("PersistentVolumeClaim") > weight("StorageClass"));
  assert.ok(weight("StorageClass") > weight("PersistentVolume"));
  assert.ok(weight("HorizontalPodAutoscaler") > weight("Deployment"));
});

test("groups collapse above the Headlamp threshold and reveal their chain on focus", () => {
  const grouped = groupKubejojoGraph(
    progressiveDisclosureResources,
    progressiveDisclosureRelations,
    "namespace",
  );
  const demoGroupId = "group:namespace:demo";
  const opsGroupId = "group:namespace:ops";

  // demo holds 4 resources with internal relationships, so it starts collapsed.
  const global = collapseKubejojoGraph(grouped);
  assert.deepEqual(global.nodes?.map((node) => [node.id, node.collapsed]), [
    [demoGroupId, true],
    [opsGroupId, false],
  ]);

  const focused = collapseKubejojoGraph(grouped, demoGroupId);
  // Focusing a group promotes its children to the canvas root, so the members are
  // reachable one level down inside their component rather than as a flat row.
  const demoIds = new Set(collectNodeIds(focused));
  assert.ok(demoIds.has("deployment"));
  assert.ok(demoIds.has("service"));
  assert.ok(demoIds.has("pod"));
  assert.ok(demoIds.has("config"));
  assert.equal(demoIds.has(demoGroupId), false);

  const expanded = collapseKubejojoGraph(grouped, null, true);
  assert.equal(findGraphNode(expanded, demoGroupId)?.collapsed, false);
});

test("collapse threshold is Headlamp's ten children or any inner relationship", () => {
  assert.equal(KUBEJOJO_COLLAPSE_THRESHOLD, 10);

  const small = Array.from({ length: KUBEJOJO_COLLAPSE_THRESHOLD }, (_, index) => ({
    id: `pod-${String(index).padStart(2, "0")}`,
    kind: "Pod",
    name: `api-${index}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const atThreshold = collapseKubejojoGraph(groupKubejojoGraph(small, [], "namespace"));
  assert.equal(
    atThreshold.nodes?.[0]?.collapsed,
    false,
    "ten children is still within the threshold",
  );

  const overThreshold = collapseKubejojoGraph(groupKubejojoGraph([
    ...small,
    { id: "pod-extra", kind: "Pod", name: "api-extra", namespace: "prod", instanceName: "api" },
  ], [], "namespace"));
  assert.equal(overThreshold.nodes?.[0]?.collapsed, true);

  const withRelation = collapseKubejojoGraph(groupKubejojoGraph(
    [
      { id: "deploy", kind: "Deployment", name: "api", namespace: "prod", instanceName: "api" },
      { id: "pod-a", kind: "Pod", name: "api-0", namespace: "prod", instanceName: "api" },
    ],
    [{ id: "owns", source: "deploy", target: "pod-a", type: "OWNS" }],
    "namespace",
  ));
  assert.equal(withRelation.nodes?.[0]?.collapsed, true);
});

test("unscheduled Pods stay visible under a sentinel group and never vanish", () => {
  const grouped = groupKubejojoGraph([
    { id: "pending", kind: "Pod", name: "api-pending", namespace: "prod", instanceName: "api" },
    { id: "running", kind: "Pod", name: "api-running", namespace: "prod", instanceName: "api", nodeName: "worker-1" },
  ], [], "node");

  const labels = (grouped.nodes ?? []).map((node) => node.label ?? "");
  assert.equal(labels.length, 2);
  assert.deepEqual([...labels].sort(), ["worker-1", "未调度"].sort());
});

test("large namespaces keep component summaries and reveal every resource when drilled into", async () => {
  const pods: KubejojoResource[] = Array.from({ length: 129 }, (_, index) => ({
    id: `connected-pod-${String(index).padStart(3, "0")}`,
    kind: "Pod",
    name: `api-${String(index).padStart(3, "0")}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const connectedResources: KubejojoResource[] = [
    { id: "connected-deployment", kind: "Deployment", name: "api", namespace: "prod", instanceName: "api" },
    { id: "connected-rs", kind: "ReplicaSet", name: "api-rs", namespace: "prod", instanceName: "api" },
    ...pods,
  ];
  const relations: KubejojoRelation[] = [
    { id: "deployment-rs", source: "connected-deployment", target: "connected-rs", type: "OWNS" },
    ...pods.map((pod) => ({ id: `relation-${pod.id}`, source: "connected-rs", target: pod.id, type: "OWNS" as const })),
  ];
  const grouped = groupKubejojoGraph(connectedResources, relations, "namespace");
  const groupId = "group:namespace:prod";
  const focused = collapseKubejojoGraph(grouped, groupId, false);

  const component = focused.nodes?.find((node) => node.groupKind === "component");
  assert.ok(component?.collapsed, "entering a namespace does not expand every workload");
  const summary = await layoutKubejojoGraph(focused, 1.6);
  assert.deepEqual(summary.nodes.map((node) => node.id), [component.id]);
  assert.equal(summary.edges.length, 0, "internal edges stay inside the folded component");

  const expanded = collapseKubejojoGraph(grouped, component.id);
  const podStack = expanded.nodes?.find((node) => node.groupKind === "stack");
  assert.ok(podStack?.collapsed, "repeated Pods stay stacked after entering the workload component");
  assert.equal(podStack.nodes?.length, 129);
  const summaryLayout = await layoutKubejojoGraph(expanded, 1.6);
  assert.deepEqual(summaryLayout.nodes.map((node) => node.id).sort(), ["connected-deployment", "connected-rs", podStack.id].sort());
  assert.equal(summaryLayout.edges.length, 2, "many ownership links collapse to one counted relation");
  assert.ok(summaryLayout.edges.some((edge) => edge.data?.count === 129));

  const details = collapseKubejojoGraph(grouped, podStack.id);
  const layout = await layoutKubejojoGraph(details, 1.6);
  assert.deepEqual(layout.nodes.map((node) => node.id).sort(), connectedResources.map((node) => node.id).sort());
  assert.deepEqual(layout.edges.map((edge) => edge.id).sort(), relations.map((edge) => edge.id).sort());
});

test("Pod stacks bundle repeated Service relationships and restore every edge on drilldown", async () => {
  const pods: KubejojoResource[] = Array.from({ length: 12 }, (_, index) => ({
    id: `pod-${String(index).padStart(2, "0")}`,
    kind: "Pod",
    name: `api-${String(index).padStart(2, "0")}`,
    namespace: "prod",
    instanceName: "api",
  }));
  const resources: KubejojoResource[] = [
    { id: "deployment", kind: "Deployment", name: "api", namespace: "prod", instanceName: "api" },
    { id: "replicaset", kind: "ReplicaSet", name: "api-rs", namespace: "prod", instanceName: "api" },
    ...pods,
    { id: "service-a", kind: "Service", name: "api-a", namespace: "prod", instanceName: "api" },
    { id: "service-b", kind: "Service", name: "api-b", namespace: "prod", instanceName: "api" },
  ];
  const relations: KubejojoRelation[] = [
    { id: "deployment-rs", source: "deployment", target: "replicaset", type: "OWNS" },
    ...pods.map((pod) => ({ id: `rs-${pod.id}`, source: "replicaset", target: pod.id, type: "OWNS" as const })),
    ...pods.flatMap((pod, index) => [
      ...(index % 2 === 0 ? [{ id: `a-${pod.id}`, source: "service-a", target: pod.id, type: "SELECTS" as const }] : []),
      ...(index % 3 !== 1 ? [{ id: `b-${pod.id}`, source: "service-b", target: pod.id, type: "SELECTS" as const }] : []),
    ]),
  ];
  const grouped = groupKubejojoGraph(resources, relations, "namespace");
  const component = grouped.nodes?.[0]?.nodes?.find((node) => node.groupKind === "component");
  assert.ok(component);

  const summary = collapseKubejojoGraph(grouped, component.id);
  const stack = summary.nodes?.find((node) => node.groupKind === "stack");
  assert.ok(stack?.collapsed);
  assert.equal(stack.nodes?.length, pods.length);
  const compressed = await layoutKubejojoGraph(summary, 1.6);
  assert.equal(compressed.edges.length, 3);
  assert.equal(new Set(compressed.edges.map((edge) => `${edge.source}->${edge.target}`)).size, compressed.edges.length);
  assert.equal(compressed.edges.find((edge) => edge.data?.count === 12)?.data?.relationIds?.length, 12);
  assert.equal(compressed.edges.find((edge) => edge.data?.count === 14)?.data?.relationIds?.length, 14);

  const expanded = collapseKubejojoGraph(grouped, stack.id);
  const full = await layoutKubejojoGraph(expanded, 1.6);
  assert.equal(full.nodes.filter((node) => node.id.startsWith("pod-")).length, pods.length);
  assert.equal(full.edges.length, 23, "expanding one stack restores every represented Pod edge while keeping Service context grouped");
  assert.equal(
    full.edges.flatMap((edge) => edge.data?.relationIds ?? []).filter((id) => id.startsWith("a-") || id.startsWith("b-")).length,
    14,
    "every original Service selector relation remains represented after expanding Pods",
  );
});

test("expanded stack IDs are independent and can be folded together", () => {
  const podStack = { id: "stack:pods", label: "Pod", groupKind: "stack" as const, collapsedPreferred: true,
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `pod-${index}`, resource: { id: `pod-${index}`, kind: "Pod", name: `pod-${index}` } })) };
  const serviceStack = { id: "stack:services", label: "Service", groupKind: "stack" as const, collapsedPreferred: true,
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `service-${index}`, resource: { id: `service-${index}`, kind: "Service", name: `service-${index}` } })) };
  const component = { id: "component:api", label: "api", groupKind: "component" as const, nodes: [podStack, serviceStack] };
  const graph = { id: "root", nodes: [component] };
  const partial = collapseKubejojoGraph(graph, component.id, false, new Set([podStack.id]));
  const partialIds = new Set(collectNodeIds(partial));
  const serviceAfter = partial.nodes?.find(node => node.id === serviceStack.id);
  assert.ok(partialIds.has("pod-0"), "expanded Pod stack members become visible peers");
  assert.equal(partialIds.has(podStack.id), false);
  assert.equal(serviceAfter?.collapsed, true);
  const multiple = collapseKubejojoGraph(graph, component.id, false, new Set([podStack.id, serviceStack.id]));
  const multipleIds = new Set(collectNodeIds(multiple));
  assert.ok(multipleIds.has("pod-0"));
  assert.ok(multipleIds.has("service-0"));
  assert.equal(multipleIds.has(podStack.id), false);
  assert.equal(multipleIds.has(serviceStack.id), false);
  const folded = collapseKubejojoGraph(graph, component.id, false, new Set());
  const foldedStacks = folded.nodes ?? [];
  assert.ok(foldedStacks.every(node => node.groupKind !== "stack" || node.collapsed));
});

test("expand-all promotes every stack before ELK routes its relationships", () => {
  const podStack = {
    id: "stack:pods",
    groupKind: "stack" as const,
    collapsedPreferred: true,
    nodes: [
      { id: "pod-0", resource: { id: "pod-0", kind: "Pod", name: "api-0" } },
      { id: "pod-1", resource: { id: "pod-1", kind: "Pod", name: "api-1" } },
    ],
  };
  const serviceStack = {
    id: "stack:services",
    groupKind: "stack" as const,
    collapsedPreferred: true,
    nodes: [
      { id: "service-0", resource: { id: "service-0", kind: "Service", name: "api" } },
    ],
  };
  const component = {
    id: "component:api",
    groupKind: "component" as const,
    nodes: [podStack, serviceStack],
    edges: [
      { id: "select-0", source: "pod-0", target: "service-0", type: "SELECTS" as const },
      { id: "select-1", source: "pod-1", target: "service-0", type: "SELECTS" as const },
    ],
  };
  const expanded = collapseKubejojoGraph(
    { id: "root", nodes: [component] },
    component.id,
    true,
  );
  const directChildren = new Set((expanded.nodes ?? []).map(node => node.id));
  assert.ok(directChildren.has("pod-0"));
  assert.ok(directChildren.has("service-0"));
  assert.equal(directChildren.has(podStack.id), false);
  assert.equal(directChildren.has(serviceStack.id), false);
  const projected = containerRelations(expanded);
  assert.deepEqual(projected.map(edge => edge.source).sort(), ["pod-0", "pod-1"]);
  assert.ok(projected.every(edge => edge.target === "service-0"));
});

test("expanded stacks promote members so ELK routes relations to individual resources", async () => {
  const pods = Array.from({ length: 4 }, (_, index) => ({
    id: `pod-${index}`,
    resource: { id: `pod-${index}`, kind: "Pod", name: `api-${index}` },
  }));
  const services = Array.from({ length: 2 }, (_, index) => ({
    id: `service-${index}`,
    resource: { id: `service-${index}`, kind: "Service", name: `api-${index}` },
  }));
  const podStack = { id: "stack:pods", groupKind: "stack" as const, collapsedPreferred: true, nodes: pods };
  const serviceStack = { id: "stack:services", groupKind: "stack" as const, collapsedPreferred: true, nodes: services };
  const replicaSet = { id: "replicaset", resource: { id: "replicaset", kind: "ReplicaSet", name: "api-rs" } };
  const endpoints = [0, 1].map(index => ({ id: `endpoints-${index}`, resource: { id: `endpoints-${index}`, kind: "Endpoints", name: `api-${index}` } }));
  const relations: KubejojoRelation[] = [
    ...pods.map((pod, index) => ({ id: `owner-${index}`, source: "replicaset", target: pod.id, type: "OWNS" as const })),
    ...pods.flatMap((pod, podIndex) => services.map((service, serviceIndex) => ({
      id: `select-${podIndex}-${serviceIndex}`, source: pod.id, target: service.id, type: "SELECTS" as const,
    }))),
    ...services.map((service, index) => ({
      id: `publish-${index}`, source: service.id, target: endpoints[index].id, type: "PUBLISHES" as const,
    })),
  ];
  const component = {
    id: "component:api",
    groupKind: "component" as const,
    nodes: [replicaSet, podStack, serviceStack, ...endpoints],
    edges: relations,
  };
  const graph = { id: "root", nodes: [component] };
  const expanded = collapseKubejojoGraph(
    graph,
    component.id,
    false,
    new Set([podStack.id, serviceStack.id]),
  );
  const directChildren = new Set((expanded.nodes ?? []).map(node => node.id));
  assert.ok(directChildren.has("pod-0"), "expanded Pod members become peers in the component layout");
  assert.ok(directChildren.has("service-0"), "expanded Service members become peers in the component layout");
  assert.equal(directChildren.has(podStack.id), false);
  assert.equal(directChildren.has(serviceStack.id), false);

  const projected = containerRelations(expanded);
  assert.equal(projected.filter(edge => edge.relation.type === "OWNS").length, 4);
  assert.equal(projected.filter(edge => edge.relation.type === "SELECTS").length, 8);
  assert.ok(projected.filter(edge => edge.relation.type === "SELECTS").every(edge =>
    edge.source.startsWith("pod-") && edge.target.startsWith("service-"),
  ), "Pod-to-Service edges must attach to the concrete resource cards, not stack containers");

  const layout = await layoutKubejojoGraph(expanded, 1.6);
  assert.equal(layout.edges.filter(edge => edge.data?.relationIds?.some(id => id.startsWith("select-"))).length, 8);
  assert.ok(layout.edges.filter(edge => edge.data?.relationIds?.some(id => id.startsWith("select-"))).every(edge =>
    edge.source.startsWith("pod-") && edge.target.startsWith("service-"),
  ));
});

test("configuration relationships stay on one side and never merge workloads", () => {
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
  assert.deepEqual(
    partitioned.overlays.map((edge) => edge.id),
    ["config-a", "config-b", "sa-a", "sa-b", "scope-only"],
  );

  const grouped = groupKubejojoGraph(resources, relations, "namespace");
  const group = grouped.nodes?.[0];
  assert.ok(group?.nodes?.every((node) => node.groupKind === "component"), "namespace entries must all be component summaries");
  const components = group?.nodes?.filter((node) => node.nodes?.some((member) => member.resource?.kind === "Deployment")) ?? [];
  assert.equal(components.length, 2, "each workload keeps its own component");
  assert.deepEqual(components.map((component) => component.nodes?.map((node) => node.id).sort()), [
    ["deploy-a", "pod-a"],
    ["deploy-b", "pod-b"],
  ]);
  // The configuration and service-account relationships still travel with the
  // group, so opening it shows the complete dependency picture.
  assert.deepEqual(
    group?.edges?.map((edge) => edge.id),
    ["config-a", "config-b", "owns-a", "owns-b", "sa-a", "sa-b", "scope-only"],
  );
});

test("full association mode renders configuration edges while core mode keeps the access path", async () => {
  const resources: KubejojoResource[] = [
    { id: "deploy", kind: "Deployment", name: "api", namespace: "prod", instanceName: "api" },
    { id: "pod", kind: "Pod", name: "api-0", namespace: "prod", instanceName: "api" },
    { id: "config", kind: "ConfigMap", name: "api-config", namespace: "prod", instanceName: "api" },
  ];
  const relations: KubejojoRelation[] = [
    { id: "owns", source: "deploy", target: "pod", type: "OWNS" },
    { id: "uses-config", source: "pod", target: "config", type: "USES_CONFIG" },
  ];

  const coreProjection = projectTopologyDisplayMode(resources, relations, "core");
  const fullProjection = projectTopologyDisplayMode(resources, relations, "full");
  const coreGraph = collapseKubejojoGraph(
    groupKubejojoGraph(coreProjection.resources, coreProjection.relations, "namespace"),
    "group:namespace:prod",
    true,
  );
  const fullGraph = collapseKubejojoGraph(
    groupKubejojoGraph(fullProjection.resources, fullProjection.relations, "namespace"),
    "group:namespace:prod",
    true,
  );
  clearKubejojoLayoutCache();
  const coreLayout = await layoutKubejojoGraph(coreGraph, 1.6);
  clearKubejojoLayoutCache();
  const fullLayout = await layoutKubejojoGraph(fullGraph, 1.6);

  assert.deepEqual(coreLayout.edges.map((edge) => edge.id), ["owns"]);
  assert.deepEqual(fullLayout.edges.map((edge) => edge.id).sort(), ["owns", "uses-config"]);
  assert.equal(coreLayout.nodes.some((node) => node.id === "config"), false);
  assert.equal(fullLayout.nodes.some((node) => node.id === "config"), true);
});

test("selection paths follow the grouping tree and stay deterministic", () => {
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

  assert.deepEqual(forward, reversed, "input order must not change the graph");
  assert.deepEqual(
    getKubejojoSelectionPath(forward, "pod").map(({ id, kind, resourceCount }) => ({ id, kind, resourceCount })),
    [
      { id: "root", kind: "root", resourceCount: 5 },
      { id: "group:namespace:demo", kind: "scope", resourceCount: 4 },
      { id: "component:deployment", kind: "component", resourceCount: 3 },
      { id: "pod", kind: "resource", resourceCount: 1 },
    ],
  );
  // A ConfigMap reached through USES_CONFIG is an overlay, not a structural
  // member, so it stays a sibling of the component instead of joining it.
  assert.deepEqual(
    getKubejojoSelectionPath(forward, "config").map(({ id, kind }) => ({ id, kind })),
    [
      { id: "root", kind: "root" },
      { id: "group:namespace:demo", kind: "scope" },
      { id: "component:config", kind: "component" },
      { id: "config", kind: "resource" },
    ],
  );
  assert.deepEqual(getKubejojoSelectionPath(forward, "missing").map((item) => item.id), ["root"]);
});

test("layout policy uses Headlamp layered layout for connected node-link graphs", () => {
  assert.deepEqual(getKubejojoLayoutPolicy(true, 1.8), {
    algorithm: "layered",
    aspectRatio: 1.8,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(true, 0.72), {
    algorithm: "layered",
    aspectRatio: 0.72,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(false, 0.72), {
    algorithm: "rectpacking",
    aspectRatio: 0.72,
  });
  assert.deepEqual(getKubejojoLayoutPolicy(false, 0), {
    algorithm: "rectpacking",
    aspectRatio: 1.6,
  });
});

test("connected Node-Link graphs use horizontal partitions and ELK spline routing", () => {
  const layered = containerLayoutOptions(true);
  assert.equal(layered["elk.algorithm"], "layered");
  assert.equal(layered["elk.direction"], "RIGHT");
  assert.equal(layered["elk.partitioning.activate"], "true");
  const graph = toElkGraph({
    id: "root",
    nodes: [
      { id: "deployment", resource: { id: "deployment", kind: "Deployment", name: "api" } },
      { id: "pod", resource: { id: "pod", kind: "Pod", name: "api-0" } },
    ],
    edges: [{ id: "owns", source: "deployment", target: "pod", type: "OWNS" }],
  });
  assert.equal(graph.children?.find(node => node.id === "deployment")?.layoutOptions?.["elk.partitioning.partition"], "-980");
  assert.equal(graph.children?.find(node => node.id === "pod")?.layoutOptions?.["elk.partitioning.partition"], "-800");
  assert.equal(layered["elk.edgeRouting"], "SPLINES");

  const packed = containerLayoutOptions(false);
  assert.equal(packed["elk.algorithm"], "rectpacking");
  assert.equal(packed["elk.direction"], undefined);
});

test("one card size is shared by layout, CSS and the renderer", () => {
  assert.deepEqual(KUBEJOJO_LAYOUT_METRICS, {
    nodeWidth: 220,
    nodeHeight: 70,
    nodeSpacing: 60,
    groupPadding: 16,
    packedNodeSpacing: 20,
    packedPaddingTop: 48,
    packedPaddingSide: 24,
  });
});

test("container relationships are only laid out at the level that owns both endpoints", () => {
  const graph: KubejojoGraphNode = {
    id: "root",
    nodes: [
      {
        id: "component:a",
        groupKind: "component",
        nodes: [
          { id: "a", resource: { id: "a", kind: "Deployment", name: "a" } },
          { id: "a-pod", resource: { id: "a-pod", kind: "Pod", name: "a-0" } },
        ],
        edges: [
          { id: "inner", source: "a", target: "a-pod", type: "OWNS" },
          { id: "shared", source: "a-pod", target: "config", type: "USES_CONFIG" },
        ],
      },
      { id: "config", resource: { id: "config", kind: "ConfigMap", name: "cfg" } },
    ],
    edges: [
      { id: "inner", source: "a", target: "a-pod", type: "OWNS" },
      { id: "shared", source: "a-pod", target: "config", type: "USES_CONFIG" },
    ],
  };

  // The component owns the relationship between its own two children, so it is
  // laid out (and drawn) there rather than duplicated at the root.
  const component = graph.nodes![0];
  assert.deepEqual(
    containerRelations(component).map((drawn) => [drawn.relation.id, drawn.source, drawn.target]),
    [["inner", "a", "a-pod"]],
  );
  // At the root the same edge belongs to that one child, while the dependency on
  // the sibling ConfigMap is projected onto it so ELK can route it.
  assert.deepEqual(
    containerRelations(graph).map((drawn) => [drawn.relation.id, drawn.source, drawn.target]),
    [["shared", "component:a", "config"]],
  );
});

test("layered Node-Link layout keeps the workload graph complete and stable across input order", async () => {
  const resources: KubejojoResource[] = [
    { id: "ingress", kind: "Ingress", name: "public", namespace: "demo" },
    { id: "service", kind: "Service", name: "api", namespace: "demo" },
    { id: "endpoints", kind: "EndpointSlice", name: "api-random", namespace: "demo" },
    { id: "pod-a", kind: "Pod", name: "api-a", namespace: "demo" },
    { id: "pod-b", kind: "Pod", name: "api-b", namespace: "demo" },
    { id: "replica-set", kind: "ReplicaSet", name: "api-rs", namespace: "demo" },
    { id: "deployment", kind: "Deployment", name: "api", namespace: "demo" },
  ];
  const relations: KubejojoRelation[] = [
    { id: "ingress-service", source: "ingress", target: "service", type: "ROUTES_TO" },
    { id: "service-endpoints", source: "service", target: "endpoints", type: "PUBLISHES" },
    { id: "endpoints-pod-a", source: "endpoints", target: "pod-a", type: "RESOLVES" },
    { id: "endpoints-pod-b", source: "endpoints", target: "pod-b", type: "RESOLVES" },
    { id: "replica-set-pod-a", source: "replica-set", target: "pod-a", type: "OWNS" },
    { id: "replica-set-pod-b", source: "replica-set", target: "pod-b", type: "OWNS" },
    { id: "deployment-replica-set", source: "deployment", target: "replica-set", type: "OWNS" },
  ];
  const graph = (nodes: KubejojoResource[], edges: KubejojoRelation[]): KubejojoGraphNode => ({
    id: "root",
    label: "root",
    nodes: nodes.map((resource) => ({
      id: resource.id,
      label: resource.name,
      subtitle: resource.kind,
      resource,
    })),
    edges,
  });
  const positions = async (nodes: KubejojoResource[], edges: KubejojoRelation[]) => {
    const layout = await layoutKubejojoGraph(graph(nodes, edges), 1.6);
    return new Map(layout.nodes.map((node) => [node.id, node.position]));
  };

  const forward = await positions(resources, relations);
  const reversed = await positions([...resources].reverse(), [...relations].reverse());
  assert.deepEqual([...forward.keys()].sort(), resources.map((item) => item.id).sort());
  const serviceEdge = (await layoutKubejojoGraph(graph(resources, relations), 1.6)).edges
    .find((edge) => edge.id === "ingress-service");
  assert.equal(serviceEdge?.source, "service");
  assert.equal(serviceEdge?.target, "ingress");
  const endpointEdge = (await layoutKubejojoGraph(graph(resources, relations), 1.6)).edges
    .find((edge) => edge.id === "endpoints-pod-a");
  assert.equal(endpointEdge?.source, "pod-a");
  assert.equal(endpointEdge?.target, "endpoints");
  const publishEdge = (await layoutKubejojoGraph(graph(resources, relations), 1.6)).edges
    .find((edge) => edge.id === "service-endpoints");
  assert.equal(publishEdge?.source, "service");
  assert.equal(publishEdge?.target, "endpoints");
  const ownershipEdge = (await layoutKubejojoGraph(graph(resources, relations), 1.6)).edges
    .find((edge) => edge.id === "deployment-replica-set");
  assert.equal(ownershipEdge?.source, "deployment");
  assert.equal(ownershipEdge?.target, "replica-set");
  assert.equal(ownershipEdge?.data?.label, "拥有");
  assert.ok(ownershipEdge?.data?.labelPosition, "ELK must provide a collision-aware label position");
  assert.deepEqual(reversed, forward, "API result order must not change the rendered layout");
});

test("a single-resource chain stays centered on one horizontal row", async () => {
  const kinds = ["Deployment", "ReplicaSet", "Pod", "Service", "Endpoints"];
  const graph: KubejojoGraphNode = {
    id: "single-chain",
    nodes: kinds.map(kind => ({ id: kind, resource: { id: kind, kind, name: kind } })),
    edges: kinds.slice(1).map((kind, index) => ({ id: `${kinds[index]}-${kind}`, source: kinds[index], target: kind, type: "OWNS" })),
  };
  const layout = await layoutKubejojoGraph(graph, 1.6);
  const byId = new Map(layout.nodes.map(node => [node.id, node]));
  const centerY = byId.get("Pod")!.position.y + 35;
  for (const edge of layout.edges) {
    const section = edge.data!.sections![0];
    assert.ok(byId.get(edge.source)!.position.x < byId.get(edge.target)!.position.x);
    assert.ok(Math.abs(section.startPoint.y - centerY) < 1, `${edge.id} starts at the card center`);
    assert.ok(Math.abs(section.endPoint.y - centerY) < 1, `${edge.id} ends at the card center`);
    assert.ok((section.bendPoints ?? []).every(point => Math.abs(point.y - centerY) < 1), `${edge.id} has no artificial detour`);
  }
});

test("layered layout keeps every focused access-path node and edge collision-free", async () => {
  const kinds = ["Deployment", "ReplicaSet", "Pod", "Pod", "Service", "EndpointSlice", "Ingress"];
  const ids = ["deploy", "rs", "pod-a", "pod-b", "svc", "slice", "ingress"];
  const edges: KubejojoRelation[] = [
    { id: "d-r", source: "deploy", target: "rs", type: "OWNS" },
    { id: "r-a", source: "rs", target: "pod-a", type: "OWNS" },
    { id: "r-b", source: "rs", target: "pod-b", type: "OWNS" },
    { id: "s-a", source: "svc", target: "pod-a", type: "SELECTS" },
    { id: "s-b", source: "svc", target: "pod-b", type: "SELECTS" },
    { id: "s-e", source: "svc", target: "slice", type: "PUBLISHES" },
    { id: "e-a", source: "slice", target: "pod-a", type: "RESOLVES" },
    { id: "e-b", source: "slice", target: "pod-b", type: "RESOLVES" },
    { id: "i-s", source: "ingress", target: "svc", type: "ROUTES_TO" },
  ];
  const graph: KubejojoGraphNode = {
    id: "root",
    nodes: ids.map((id, index) => ({ id, resource: { id, kind: kinds[index], name: id } })),
    edges,
  };
  const layout = await layoutKubejojoGraph(graph, 1.6);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.deepEqual([...byId.keys()].sort(), ids.slice().sort());
  for (const [left, right] of [["deploy", "rs"], ["rs", "pod-a"], ["rs", "pod-b"], ["pod-a", "svc"], ["pod-b", "svc"], ["svc", "slice"], ["svc", "ingress"]]) {
    assert.ok(byId.get(left)!.position.x + 220 < byId.get(right)!.position.x, `${left} precedes ${right} horizontally`);
  }
  assert.equal(byId.get("pod-a")!.position.x, byId.get("pod-b")!.position.x, "Pods remain in one column");
  for (let left = 0; left < layout.nodes.length; left += 1) {
    for (let right = left + 1; right < layout.nodes.length; right += 1) {
      const a = layout.nodes[left];
      const b = layout.nodes[right];
      const overlaps = a.position.x < b.position.x + Number(b.style?.width)
        && a.position.x + Number(a.style?.width) > b.position.x
        && a.position.y < b.position.y + Number(b.style?.height)
        && a.position.y + Number(a.style?.height) > b.position.y;
      assert.equal(overlaps, false, `${a.id} and ${b.id} do not overlap`);
    }
  }
  const ingressRoute = layout.edges.find((edge) => edge.id === "i-s")!;
  assert.equal(ingressRoute.data?.relationIds?.[0], "i-s", "Ingress-to-Service route keeps its source relationship");
  assert.equal(layout.edges.length, edges.length);
  for (const edge of layout.edges) {
    const sections = edge.data?.sections ?? [];
    assert.ok(sections.length, `${edge.id} keeps its route`);
    const first = sections[0].startPoint;
    const last = sections.at(-1)!.endPoint;
    for (const [id, point] of [[edge.source, first], [edge.target, last]] as const) {
      const node = byId.get(id)!;
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y),
        `${edge.id} remains attached to ${id}`);
    }
  }
});

test("multi-Pod overlapping Service selectors keep a deterministic non-overlapping layout", async () => {
  for (const podCount of [1, 5, 20]) {
    const pods: KubejojoResource[] = Array.from({ length: podCount }, (_, index) => ({
      id: `pod-${String(index).padStart(2, "0")}`,
      kind: "Pod",
      name: `api-${String(index).padStart(2, "0")}`,
      namespace: "prod",
    }));
    const resources: KubejojoResource[] = [
      { id: "deployment", kind: "Deployment", name: "api", namespace: "prod" },
      { id: "replicaset", kind: "ReplicaSet", name: "api-rs", namespace: "prod" },
      ...pods,
      { id: "service-a", kind: "Service", name: "api-primary", namespace: "prod" },
      { id: "service-b", kind: "Service", name: "api-canary", namespace: "prod" },
      { id: "endpoints-a", kind: "Endpoints", name: "api-primary", namespace: "prod" },
      { id: "endpoints-b", kind: "EndpointSlice", name: "api-canary", namespace: "prod" },
      { id: "ingress", kind: "Ingress", name: "api", namespace: "prod" },
    ];
    const edges: KubejojoRelation[] = [
      { id: "deployment-rs", source: "deployment", target: "replicaset", type: "OWNS" },
      ...pods.map((pod) => ({ id: `rs-${pod.id}`, source: "replicaset", target: pod.id, type: "OWNS" as const })),
      ...pods.flatMap((pod, index) => [
        ...(index % 2 === 0 ? [{ id: `a-${pod.id}`, source: "service-a", target: pod.id, type: "SELECTS" as const }] : []),
        ...(index % 3 !== 1 ? [{ id: `b-${pod.id}`, source: "service-b", target: pod.id, type: "SELECTS" as const }] : []),
      ]),
      { id: "service-a-endpoints", source: "service-a", target: "endpoints-a", type: "PUBLISHES" },
      { id: "service-b-endpoints", source: "service-b", target: "endpoints-b", type: "PUBLISHES" },
      { id: "ingress-a", source: "ingress", target: "service-a", type: "ROUTES_TO" },
      { id: "ingress-b", source: "ingress", target: "service-b", type: "ROUTES_TO" },
    ];
    const graph = (nodes: KubejojoResource[], relations: KubejojoRelation[]): KubejojoGraphNode => ({
      id: "root",
      nodes: nodes.map((resource) => ({ id: resource.id, label: resource.name, resource })),
      edges: relations,
    });
    const forward = await layoutKubejojoGraph(graph(resources, edges), 1.6);
    const reverse = await layoutKubejojoGraph(graph([...resources].reverse(), [...edges].reverse()), 1.6);
    const byId = new Map(forward.nodes.map((node) => [node.id, node]));
    assert.deepEqual(
      reverse.nodes.map((node) => [node.id, node.position]),
      forward.nodes.map((node) => [node.id, node.position]),
      `layout order is stable with ${podCount} Pods`,
    );
    assert.equal(forward.edges.length, edges.length, "every Kubernetes relation remains visible");
    assert.deepEqual([...byId.keys()].sort(), resources.map((resource) => resource.id).sort());
    for (let left = 0; left < forward.nodes.length; left += 1) {
      for (let right = left + 1; right < forward.nodes.length; right += 1) {
        const a = forward.nodes[left];
        const b = forward.nodes[right];
        const ax2 = a.position.x + (a.style?.width as number);
        const ay2 = a.position.y + (a.style?.height as number);
        const bx2 = b.position.x + (b.style?.width as number);
        const by2 = b.position.y + (b.style?.height as number);
        const overlapX = a.position.x < bx2 && ax2 > b.position.x;
        const overlapY = a.position.y < by2 && ay2 > b.position.y;
        assert.ok(!(overlapX && overlapY), `${a.id} and ${b.id} do not overlap`);
      }
    }
  }
});

test("layered layout is deterministic and lets ELK route fan-out at card boundaries", async () => {
  const pods: KubejojoResource[] = ["pod-a", "pod-b", "pod-c", "pod-d", "pod-e", "pod-f"].map((name) => ({
    id: name,
    kind: "Pod",
    name,
    namespace: "prod",
  }));
  const services: KubejojoResource[] = [
    { id: "service-a", kind: "Service", name: "api-a", namespace: "prod" },
    { id: "service-b", kind: "Service", name: "api-b", namespace: "prod" },
  ];
  const resources: KubejojoResource[] = [
    { id: "replicaset", kind: "ReplicaSet", name: "api-rs", namespace: "prod" },
    ...pods,
    ...services,
  ];
  const relations: KubejojoRelation[] = [
    ...pods.map((pod) => ({ id: `owner-${pod.id}`, source: "replicaset", target: pod.id, type: "OWNS" as const })),
    ...["pod-a", "pod-c", "pod-e"].map((pod) => ({ id: `a-${pod}`, source: "service-a", target: pod, type: "SELECTS" as const })),
    ...["pod-b", "pod-c", "pod-d"].map((pod) => ({ id: `b-${pod}`, source: "service-b", target: pod, type: "SELECTS" as const })),
  ];
  const graph = (orderedResources: KubejojoResource[], orderedRelations: KubejojoRelation[]): KubejojoGraphNode => ({
    id: "root",
    nodes: orderedResources.map((resource) => ({ id: resource.id, resource })),
    edges: orderedRelations,
  });
  const layout = await layoutKubejojoGraph(graph(resources, relations), 1.6);
  const elk = toElkGraph(graph(resources, relations));
  const elkById = new Map(elk.children?.map((child) => [child.id, child]));
  const reversed = await layoutKubejojoGraph(graph([...resources].reverse(), [...relations].reverse()), 1.6);
  assert.deepEqual(
    reversed.nodes.map((node) => [node.id, node.position]),
    layout.nodes.map((node) => [node.id, node.position]),
    "layered positions must not depend on API response order",
  );
  const pod = elkById.get("pod-c")!;
  const service = elkById.get("service-a")!;
  assert.equal(pod.layoutOptions?.["elk.partitioning.partition"], "-800");
  assert.equal(service.layoutOptions?.["elk.partitioning.partition"], "-790");
  assert.equal(pod.ports, undefined, "do not force ports to unrelated vertical positions");
  const placed = new Map(layout.nodes.map(node => [node.id, node]));
  for (const edge of layout.edges) {
    const section = edge.data!.sections![0];
    const from = placed.get(edge.source)!;
    const to = placed.get(edge.target)!;
    assert.ok(Math.abs(section.startPoint.x - (from.position.x + 220)) <= 1, `${edge.id} leaves the right card boundary`);
    assert.ok(Math.abs(section.endPoint.x - to.position.x) <= 1, `${edge.id} enters the left card boundary`);
  }
});

test("layered layout preserves storage and configuration dependency links", async () => {
  const resources: KubejojoResource[] = [
    { id: "pod", kind: "Pod", name: "api-0", namespace: "demo" },
    { id: "replica-set", kind: "ReplicaSet", name: "api-rs", namespace: "demo" },
    { id: "deployment", kind: "Deployment", name: "api", namespace: "demo" },
    { id: "pvc", kind: "PersistentVolumeClaim", name: "api-data", namespace: "demo" },
    { id: "config", kind: "ConfigMap", name: "api-config", namespace: "demo" },
    { id: "secret", kind: "Secret", name: "api-secret", namespace: "demo" },
  ];
  const relations: KubejojoRelation[] = [
    { id: "deployment-replica-set", source: "deployment", target: "replica-set", type: "OWNS" },
    { id: "replica-set-pod", source: "replica-set", target: "pod", type: "OWNS" },
    { id: "mount", source: "deployment", target: "pvc", type: "MOUNTS" },
    { id: "config", source: "deployment", target: "config", type: "USES_CONFIG" },
    { id: "secret", source: "deployment", target: "secret", type: "USES_SECRET" },
  ];
  const layout = await layoutKubejojoGraph({
    id: "root",
    nodes: resources.map((resource) => ({ id: resource.id, resource })),
    edges: relations,
  }, 1.6);
  assert.deepEqual(layout.nodes.map((node) => node.id).sort(), resources.map((resource) => resource.id).sort());
  assert.deepEqual(layout.edges.map((edge) => edge.id).sort(), relations.map((relation) => relation.id).sort());
});

test("capacity aggregates preserve the dominant resource stage", async () => {
  const services = Array.from({ length: 250 }, (_, index) => ({
    id: `service-${index}`,
    kind: "Service",
    namespace: "demo",
    instanceName: "api",
  }));
  const pods = Array.from({ length: 400 }, (_, index) => ({
    id: `pod-${index}`,
    kind: "Pod",
    namespace: "demo",
    instanceName: "api",
  }));
  const relations = services.map((service, index) => ({
    id: `route-${index}`,
    source: service.id,
    target: pods[index].id,
    type: "ROUTES_TO" as const,
  }));
  const projected = applyTopologyCapacity([...services, ...pods], relations, "defaultCanvas");
  const projectedResources = projected.resources as KubejojoResource[];
  const projectedRelations = projected.relations as KubejojoRelation[];
  const serviceAggregate = projectedResources.find((resource) => resource.aggregation?.membersByKind.Service);
  const podAggregate = projectedResources.find((resource) => resource.aggregation?.membersByKind.Pod);

  assert.ok(serviceAggregate?.aggregation);
  assert.ok(podAggregate?.aggregation);
  // Aggregates retain resource-kind priority as metadata; Force owns node positioning.
  const serviceWeight = getKubejojoAccessPathOrder({ id: serviceAggregate!.id, resource: serviceAggregate! });
  const podWeight = getKubejojoAccessPathOrder({ id: podAggregate!.id, resource: podAggregate! });
  assert.equal(serviceWeight, getKubejojoWeight({ id: "svc", resource: { id: "svc", kind: "Service", name: "svc" } }));
  assert.equal(podWeight, getKubejojoWeight({ id: "pod", resource: { id: "pod", kind: "Pod", name: "pod" } }));
  assert.ok(serviceWeight < podWeight, "Pod aggregates retain higher semantic priority than Service aggregates");
  assert.equal(getKubejojoAccessPathOrder({ id: podAggregate!.id, resource: podAggregate! }) > getKubejojoAccessPathOrder({ id: serviceAggregate!.id, resource: serviceAggregate! }), true);
  const layout = await layoutKubejojoGraph({
    id: "root",
    nodes: projectedResources.map((resource) => ({ id: resource.id, resource })),
    edges: projectedRelations,
  }, 1.6);
  assert.ok(layout.nodes.some((node) => node.id === podAggregate!.id));
  assert.ok(layout.nodes.some((node) => node.id === serviceAggregate!.id));
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
