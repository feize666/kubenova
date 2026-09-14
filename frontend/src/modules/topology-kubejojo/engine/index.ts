import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

import type {
  TopologyRendererEdgeData,
  TopologyRendererGraphNode,
  TopologyRendererNodeData,
  TopologyElkPoint,
  TopologyElkSection,
} from "../renderers";
import type { CapacityResourceAggregation, TopologyCapacityMetadata } from "./capacity";
import {
  getKubejojoRelationSemantics,
  type KubejojoLegacyRelationRole,
  type KubejojoRelationType,
  type KubejojoStableIdentity,
} from "./relations";
import { bezierPathMidpoint } from "../renderers/path-geometry";

export * from "./capacity";
export * from "./relations";
export * from "./topology-entry";
export * from "./viewport";

export type KubejojoResource = TopologyRendererGraphNode["resource"] & {
  id: string;
  namespace?: string | null;
  instanceName?: string | null;
  nodeName?: string | null;
  weight?: number;
  identity?: KubejojoStableIdentity;
  identityKey?: string;
  aggregation?: CapacityResourceAggregation;
};

export type KubejojoRelationRole = KubejojoLegacyRelationRole;
export type KubejojoRelation = {
  id: string;
  source: string;
  target: string;
  label?: string;
  role?: KubejojoRelationRole;
  type?: KubejojoRelationType;
  direction?: "outbound" | "inbound";
  ports?: string[];
  evidence?: string[];
  confidence?: number;
};
export type KubejojoGroupBy = "namespace" | "instance" | "node";
export type KubejojoGroupKind = "scope" | "component" | "isolated";
export type KubejojoGraphNode = Omit<TopologyRendererGraphNode, "resource" | "nodes" | "children"> & {
  resource?: KubejojoResource;
  nodes?: KubejojoGraphNode[];
  edges?: KubejojoRelation[];
  overlayEdges?: KubejojoRelation[];
  weight?: number;
  groupKind?: KubejojoGroupKind;
  collapsedPreferred?: boolean;
  capacity?: TopologyCapacityMetadata;
};

const WEIGHTS: Record<string, number> = {
  Ingress: 1040,
  Gateway: 1030,
  Deployment: 980,
  StatefulSet: 960,
  DaemonSet: 960,
  CronJob: 960,
  ReplicaSet: 940,
  Job: 920,
  Service: 880,
  EndpointSlice: 850,
  Endpoints: 840,
  Pod: 820,
  NetworkPolicy: 810,
  PersistentVolumeClaim: 780,
  PersistentVolume: 770,
  ConfigMap: 760,
  Secret: 760,
};
/**
 * Stable visual order for the operator-facing access path. ELK still computes
 * the actual coordinates, however these stages keep the main chain readable:
 * workload controller -> runtime -> Service -> Endpoint(s) -> ingress/gateway.
 * Storage, configuration and policy resources intentionally live on side
 * stages so they cannot interrupt the request path.
 */
const ACCESS_PATH_ORDER: Record<string, number> = {
  Deployment: 10,
  StatefulSet: 10,
  DaemonSet: 10,
  Job: 10,
  CronJob: 10,
  ReplicationController: 10,
  ReplicaSet: 20,
  Pod: 30,
  Service: 40,
  EndpointSlice: 50,
  Endpoints: 50,
  GatewayClass: 58,
  Ingress: 60,
  IngressRoute: 60,
  Gateway: 60,
  HTTPRoute: 60,
  GRPCRoute: 60,
  TCPRoute: 60,
  TLSRoute: 60,
  UDPRoute: 60,
  NetworkPolicy: 70,
  HorizontalPodAutoscaler: 72,
  VerticalPodAutoscaler: 72,
  PersistentVolumeClaim: 80,
  PersistentVolume: 82,
  StorageClass: 84,
  ConfigMap: 90,
  Secret: 92,
  ServiceAccount: 94,
};
// Unknown/extension resources are side branches by default. Keeping them out
// of the 10-60 access stages prevents an unrecognised policy or CRD from
// splitting the canonical workload-to-ingress chain.
const UNKNOWN_ACCESS_PATH_ORDER = 70;
const DEFAULT_ASPECT_RATIO = 1.6;

export const KUBEJOJO_LAYOUT_METRICS = Object.freeze({
  nodeWidth: 350,
  nodeHeight: 110,
  groupWidth: 390,
  groupHeight: 154,
  layeredNodeSpacing: 78,
  layeredLayerSpacing: 96,
  layeredEdgeNodeSpacing: 56,
  layeredEdgeSpacing: 28,
  packedNodeSpacing: 28,
});

export type KubejojoLayoutPolicy = {
  algorithm: "dagre" | "rectpacking";
  direction: "RIGHT" | "DOWN";
  aspectRatio: number;
};

export type KubejojoSelectionPathItem = {
  id: string;
  label: string;
  subtitle?: string;
  kind: "root" | KubejojoGroupKind | "resource";
  resourceCount: number;
};

const leaves = (node: KubejojoGraphNode): KubejojoGraphNode[] => node.nodes?.length ? node.nodes.flatMap(leaves) : [node];
const weight = (node: KubejojoGraphNode) => {
  const candidate = node.weight ?? node.resource?.weight ?? WEIGHTS[node.resource?.kind ?? ""] ?? 500;
  return Number.isFinite(candidate) ? candidate : 500;
};
const each = (node: KubejojoGraphNode, fn: (item: KubejojoGraphNode) => void) => { fn(node); node.nodes?.forEach((item) => each(item, fn)); };
const compareNodes = (left: KubejojoGraphNode, right: KubejojoGraphNode) => weight(right) - weight(left) || left.id.localeCompare(right.id, "en");

export function getKubejojoAccessPathOrder(node: KubejojoGraphNode): number {
  const resource = node.resource;
  const explicitKind = resource?.aggregation?.semanticKey.kind;
  if (explicitKind && explicitKind !== "Aggregate") return ACCESS_PATH_ORDER[explicitKind] ?? UNKNOWN_ACCESS_PATH_ORDER;
  const members = Object.entries(resource?.aggregation?.membersByKind ?? {});
  if (members.length > 0) {
    const total = members.reduce((sum, [, count]) => sum + count, 0);
    if (total > 0) {
      return Math.round(members.reduce((sum, [kind, count]) => sum + (ACCESS_PATH_ORDER[kind] ?? UNKNOWN_ACCESS_PATH_ORDER) * count, 0) / total);
    }
  }
  return ACCESS_PATH_ORDER[resource?.kind ?? ""] ?? UNKNOWN_ACCESS_PATH_ORDER;
}

const compareLayoutNodes = (left: KubejojoGraphNode, right: KubejojoGraphNode) =>
  getKubejojoAccessPathOrder(left) - getKubejojoAccessPathOrder(right)
  || left.resource?.name?.localeCompare(right.resource?.name ?? "", "en")
  || left.id.localeCompare(right.id, "en");

function visualEdgeEndpoints(
  edge: KubejojoRelation,
  resourcesById: ReadonlyMap<string, KubejojoResource>,
): { source: string; target: string } {
  // API relations keep their Kubernetes semantics (for example Service
  // publishes EndpointSlice and EndpointSlice resolves Pod). The canvas uses
  // the operator-facing left-to-right access path, so reverse an edge only
  // when its API direction points from a later stage to an earlier stage.
  // This gives every visible arrow a consistent direction without mutating
  // the relation payload used for evidence and navigation.
  const source = resourcesById.get(edge.source);
  const target = resourcesById.get(edge.target);
  if (source && target) {
    const sourceStage = getKubejojoAccessPathOrder({ id: source.id, resource: source });
    const targetStage = getKubejojoAccessPathOrder({ id: target.id, resource: target });
    if (sourceStage > targetStage) return { source: edge.target, target: edge.source };
  }
  return { source: edge.source, target: edge.target };
}

function visualEdgeLabel(edge: KubejojoRelation): string {
  return getKubejojoRelationSemantics(edge.type, edge.role, edge.label).label;
}

function normalizeAspectRatio(aspectRatio: number) {
  return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT_RATIO;
}

export function getKubejojoLayoutPolicy(hasEdges: boolean, aspectRatio: number): KubejojoLayoutPolicy {
  const normalizedAspectRatio = normalizeAspectRatio(aspectRatio);
  return {
    algorithm: hasEdges ? "dagre" : "rectpacking",
    direction: "RIGHT",
    aspectRatio: normalizedAspectRatio,
  };
}

export function getKubejojoPartition(node: KubejojoGraphNode) {
  // A partition represents a semantic stage in the access path. Resources in
  // the same stage share a column and fan out vertically.
  return getKubejojoAccessPathOrder(node);
}

export function makeKubejojoGraph(resources: KubejojoResource[]) {
  return [...resources].sort((left, right) => {
    const leftKey = left.identityKey ?? left.id;
    const rightKey = right.identityKey ?? right.id;
    return leftKey.localeCompare(rightKey, "en");
  }).map((resource) => ({
    id: resource.id,
    label: resource.name,
    subtitle: resource.kind,
    resource,
    weight: resource.weight,
  }));
}

export function isKubejojoBackboneRelation(relation: KubejojoRelation): boolean {
  const domain = getKubejojoRelationSemantics(relation.type, relation.role, relation.label).domain;
  return domain === "workload" || domain === "network" || domain === "storage";
}

export function partitionKubejojoRelations(relations: KubejojoRelation[]) {
  const backbone: KubejojoRelation[] = [];
  const overlays: KubejojoRelation[] = [];
  relations.forEach((relation) => {
    (isKubejojoBackboneRelation(relation) ? backbone : overlays).push(relation);
  });
  return {
    backbone: backbone.sort((left, right) => left.id.localeCompare(right.id, "en")),
    overlays: overlays.sort((left, right) => left.id.localeCompare(right.id, "en")),
  };
}

function components(
  nodes: KubejojoGraphNode[],
  backboneRelations: KubejojoRelation[],
  overlayRelations: KubejojoRelation[],
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, string[]>();
  backboneRelations.forEach((edge) => {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  });
  const seen = new Set<string>();

  return nodes.flatMap<KubejojoGraphNode>((start) => {
    if (seen.has(start.id)) return [];
    const ids = new Set<string>();
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      ids.add(id);
      [...(adjacent.get(id) ?? [])].sort((left, right) => left.localeCompare(right, "en")).forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      });
    }
    const items = [...ids]
      .flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
      .sort(compareNodes);
    const edges = backboneRelations
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    const overlayEdges = overlayRelations
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    return items.length === 1
      ? items
      : [{
        id: `component:${items[0].id}`,
        label: items[0].label ?? "关联组件",
        subtitle: `${items.length} 个关联资源`,
        nodes: items,
        edges,
        overlayEdges,
        weight: weight(items[0]),
        groupKind: "component" as const,
        collapsedPreferred: true,
      }];
  });
}

function componentScope(
  component: KubejojoGraphNode,
  groupBy: KubejojoGroupBy,
) {
  const resourceNodes = leaves(component).filter((node) => node.resource);
  const representative = resourceNodes.find((node) => node.resource?.kind === "Pod") ?? resourceNodes[0];
  const resource = representative?.resource;
  if (groupBy === "namespace") return resource?.namespace?.trim() || "集群级资源";
  if (groupBy === "node") return resource?.nodeName?.trim() || "未调度 / 集群级";
  return resource?.instanceName?.trim() || "未归属实例";
}

function scopeSubtitle(groupBy: KubejojoGroupBy) {
  if (groupBy === "namespace") return "命名空间";
  if (groupBy === "node") return "节点";
  return "实例";
}

function groupIsolatedResources(
  scopeId: string,
  componentNodes: KubejojoGraphNode[],
) {
  const connected: KubejojoGraphNode[] = [];
  const isolatedByKind = new Map<string, KubejojoGraphNode[]>();

  componentNodes.forEach((node) => {
    if (node.groupKind === "component" || (node.edges?.length ?? 0) > 0) {
      connected.push(node);
      return;
    }
    const kind = node.resource?.kind?.trim() || "Unknown";
    isolatedByKind.set(kind, [...(isolatedByKind.get(kind) ?? []), node]);
  });

  const isolated = [...isolatedByKind.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([kind, nodes]) => {
      const sortedNodes = [...nodes].sort(compareNodes);
      return {
        id: `isolated:${scopeId}:${encodeURIComponent(kind)}`,
        label: `${kind}（无关联）`,
        subtitle: `${sortedNodes.length} 个无关联资源`,
        nodes: sortedNodes,
        edges: [],
        weight: Math.max(...sortedNodes.map(weight), 0),
        groupKind: "isolated" as const,
        collapsedPreferred: true,
      };
    });

  return [...connected, ...isolated];
}

/**
 * Follow KubeJojo's resource-map hierarchy: calculate connected components
 * first, then use a representative runtime resource as visual context. This
 * avoids severing a PVC/PV or Service/Endpoint path just because its members
 * have different scopes.
 */
export function groupKubejojoGraph(
  resources: KubejojoResource[],
  relations: KubejojoRelation[],
  groupBy: KubejojoGroupBy,
  includeOverlays = false,
): KubejojoGraphNode {
  const partitioned = partitionKubejojoRelations(relations);
  const backbone = includeOverlays ? [...relations].sort((left, right) => left.id.localeCompare(right.id, "en")) : partitioned.backbone;
  const overlays = includeOverlays ? [] : partitioned.overlays;
  const componentsByScope = new Map<string, KubejojoGraphNode[]>();
  components(makeKubejojoGraph(resources), backbone, overlays).forEach((component) => {
    const key = componentScope(component, groupBy);
    componentsByScope.set(key, [...(componentsByScope.get(key) ?? []), component]);
  });
  const root: KubejojoGraphNode = { id: "root", label: "全局拓扑", nodes: [], edges: [] };
  [...componentsByScope.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .forEach(([key, componentNodes]) => {
      const scopeId = `scope:${groupBy}:${key}`;
      const scopeResourceIds = new Set(componentNodes.flatMap((component) => leaves(component).map((node) => node.id)));
      root.nodes!.push({
        id: scopeId,
        label: key,
        subtitle: scopeSubtitle(groupBy),
        nodes: groupIsolatedResources(scopeId, componentNodes),
        edges: [],
        overlayEdges: overlays.filter((edge) => scopeResourceIds.has(edge.source) && scopeResourceIds.has(edge.target)),
        groupKind: "scope",
        collapsedPreferred: true,
        weight: Math.max(...componentNodes.map(weight), 0),
      });
    });

  each(root, (node) => node.nodes?.sort((left, right) => {
    const leftWeight = weight(left) + ((left.edges?.length ?? 0) > 0 ? 10_000 : 0) + (left.nodes?.length ?? 0) * 10;
    const rightWeight = weight(right) + ((right.edges?.length ?? 0) > 0 ? 10_000 : 0) + (right.nodes?.length ?? 0) * 10;
    return rightWeight - leftWeight || left.id.localeCompare(right.id, "en");
  }));
  return root;
}

function findNodePath(
  root: KubejojoGraphNode,
  id?: string | null,
  ancestors: KubejojoGraphNode[] = [],
): KubejojoGraphNode[] | undefined {
  if (!id) return undefined;
  const path = [...ancestors, root];
  if (root.id === id) return path;
  for (const child of root.nodes ?? []) {
    const found = findNodePath(child, id, path);
    if (found) return found;
  }
  return undefined;
}

export function findKubejojoNode(root: KubejojoGraphNode, id?: string | null): KubejojoGraphNode | undefined {
  return findNodePath(root, id)?.at(-1);
}

function representedResourceCount(node: KubejojoGraphNode) {
  return leaves(node).reduce((count, leaf) => {
    if (!leaf.resource) return count;
    return count + (leaf.resource.aggregation?.memberCount ?? 1);
  }, 0);
}

/**
 * Returns a stable root-to-selection path suitable for focus navigation and
 * breadcrumbs. Unknown selections intentionally resolve to the global root.
 */
export function getKubejojoSelectionPath(
  root: KubejojoGraphNode,
  selectedId?: string | null,
): KubejojoSelectionPathItem[] {
  const path = findNodePath(root, selectedId) ?? [root];
  return path.map((node) => ({
    id: node.id,
    label: node.label ?? node.resource?.name ?? node.id,
    subtitle: node.subtitle,
    kind: node.id === "root" ? "root" : node.groupKind ?? "resource",
    resourceCount: representedResourceCount(node),
  }));
}

export function collapseKubejojoGraph(root: KubejojoGraphNode, focusedId?: string | null, expandAll = false): KubejojoGraphNode {
  const resolvedSelection = findKubejojoNode(root, focusedId);
  const selected = resolvedSelection?.id === "root" ? undefined : resolvedSelection;
  const clone = (node: KubejojoGraphNode): KubejojoGraphNode => {
    let collapsed = false;
    if (!expandAll && node.id !== "root") {
      if (!selected) {
        collapsed = node.collapsedPreferred ?? false;
      } else if (selected.groupKind === "scope") {
        // A scope is a real canvas scene, not a second summary level. Reveal
        // every component and isolated bucket so its resource cards and
        // relationship edges are immediately visible after entering it.
        collapsed = false;
      }
    }
    return {
      ...node,
      nodes: node.nodes?.map(clone),
      collapsed,
    };
  };
  const selectedScene = selected?.groupKind === "scope" || selected?.groupKind === "component" || selected?.groupKind === "isolated"
    ? { ...root, nodes: selected.nodes, edges: selected.edges, overlayEdges: selected.overlayEdges }
    : null;
  const visible = selectedScene ?? (selected && selected.id !== "root"
    ? { ...root, nodes: [selected], edges: root.edges }
    : root);
  return clone(visible);
}

type DagreNodeLayout = {
  node: KubejojoGraphNode;
  width: number;
  height: number;
  x: number;
  y: number;
  children?: DagreNodeLayout[];
};

type DagreContainerLayout = {
  children: DagreNodeLayout[];
  width: number;
  height: number;
  edges: KubejojoRelation[];
};

const DAGRE_PADDING = { top: 72, right: 28, bottom: 28, left: 28 };

function nodeSize(node: KubejojoGraphNode) {
  const isGroup = Boolean(node.nodes?.length && !node.collapsed);
  return {
    width: isGroup ? KUBEJOJO_LAYOUT_METRICS.groupWidth : KUBEJOJO_LAYOUT_METRICS.nodeWidth,
    height: isGroup ? KUBEJOJO_LAYOUT_METRICS.groupHeight : KUBEJOJO_LAYOUT_METRICS.nodeHeight,
  };
}

function directChildForId(children: DagreNodeLayout[], id: string): DagreNodeLayout | undefined {
  return children.find((child) => child.node.id === id || leaves(child.node).some((leaf) => leaf.id === id));
}

function orthogonalSection(source: DagreNodeLayout, target: DagreNodeLayout): TopologyElkSection {
  const startPoint: TopologyElkPoint = {
    x: source.x + source.width,
    y: source.y + source.height / 2,
  };
  const endPoint: TopologyElkPoint = {
    x: target.x,
    y: target.y + target.height / 2,
  };
  if (Math.abs(startPoint.y - endPoint.y) < 0.5) {
    return { startPoint, endPoint, bendPoints: [] };
  }
  const midpoint = startPoint.x + Math.max(32, (endPoint.x - startPoint.x) / 2);
  const safeMidpoint = Math.min(endPoint.x - 32, midpoint);
  return {
    startPoint,
    bendPoints: [
      { x: safeMidpoint, y: startPoint.y },
      { x: safeMidpoint, y: endPoint.y },
    ],
    endPoint,
  };
}

function layoutDagreContainer(node: KubejojoGraphNode, aspectRatio: number): DagreContainerLayout {
  const rawChildren = node.collapsed ? [] : (node.nodes ?? []).slice().sort(compareLayoutNodes);
  const childLayouts = rawChildren.map((child) => layoutDagreNode(child, aspectRatio));
  const containedIds = new Set(leaves(node).map((child) => child.id));
  const resourcesById = new Map(
    leaves(node)
      .filter((child) => child.resource)
      .map((child) => [child.id, child.resource!] as const),
  );
  const relations = (node.edges ?? [])
    .filter((edge) => containedIds.has(edge.source) && containedIds.has(edge.target))
    .map((edge) => {
      const endpoints = visualEdgeEndpoints(edge, resourcesById);
      return { ...edge, source: endpoints.source, target: endpoints.target };
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!childLayouts.length) return { children: [], width: 0, height: 0, edges: relations };

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    ranker: "network-simplex",
    nodesep: KUBEJOJO_LAYOUT_METRICS.layeredNodeSpacing,
    ranksep: KUBEJOJO_LAYOUT_METRICS.layeredLayerSpacing,
    edgesep: KUBEJOJO_LAYOUT_METRICS.layeredEdgeSpacing,
    marginx: DAGRE_PADDING.left,
    marginy: DAGRE_PADDING.top,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  childLayouts.forEach((child) => {
    graph.setNode(child.node.id, {
      width: child.width,
      height: child.height,
      // Dagre accepts explicit ranks and still optimizes the vertical order.
      // The rank is the canonical workload-to-network stage, so a Service
      // cannot drift underneath the Pod column when an edge crosses stages.
      rank: getKubejojoAccessPathOrder(child.node),
    });
  });
  relations.forEach((edge) => {
    const source = directChildForId(childLayouts, edge.source);
    const target = directChildForId(childLayouts, edge.target);
    if (source && target && source.node.id !== target.node.id) {
      graph.setEdge(source.node.id, target.node.id, {
        minlen: Math.max(1, Math.round((getKubejojoAccessPathOrder(target.node) - getKubejojoAccessPathOrder(source.node)) / 10)),
      }, edge.id);
    }
  });
  dagre.layout(graph);
  const graphLabel = graph.graph() as { width?: number; height?: number };
  const positionedChildren = childLayouts.map((child) => {
    const position = graph.node(child.node.id) as { x: number; y: number };
    return {
      ...child,
      x: position.x - child.width / 2,
      y: position.y - child.height / 2,
    };
  });
  const rankBuckets = new Map<number, DagreNodeLayout[]>();
  positionedChildren.forEach((child) => {
    const rank = getKubejojoAccessPathOrder(child.node);
    rankBuckets.set(rank, [...(rankBuckets.get(rank) ?? []), child]);
  });
  const spineBucket = [...rankBuckets.values()]
    .filter((bucket) => bucket.length > 1)
    .sort((left, right) => right.length - left.length)[0];
  if (spineBucket?.length) {
    const spineCenter = spineBucket.reduce((total, child) => total + child.y + child.height / 2, 0) / spineBucket.length;
    rankBuckets.forEach((bucket, rank) => {
      // Keep the canonical access path on one horizontal spine. Fan-out
      // stages (normally Pods) retain their Dagre-computed vertical stack.
      if (bucket.length !== 1 || rank > ACCESS_PATH_ORDER.Ingress) return;
      bucket[0].y = spineCenter - bucket[0].height / 2;
    });
  }
  return {
    children: positionedChildren,
    width: Math.max(graphLabel.width ?? 0, DAGRE_PADDING.left + DAGRE_PADDING.right + KUBEJOJO_LAYOUT_METRICS.nodeWidth),
    height: Math.max(graphLabel.height ?? 0, DAGRE_PADDING.top + DAGRE_PADDING.bottom + KUBEJOJO_LAYOUT_METRICS.nodeHeight),
    edges: relations,
  };
}

function layoutDagreNode(node: KubejojoGraphNode, aspectRatio: number): DagreNodeLayout {
  const size = nodeSize(node);
  if (node.collapsed || !node.nodes?.length) return { node, ...size, x: 0, y: 0 };
  const container = layoutDagreContainer(node, aspectRatio);
  const children = container.children.map((child) => ({
    ...child,
    x: child.x + DAGRE_PADDING.left,
    y: child.y + DAGRE_PADDING.top,
  }));
  return {
    node,
    width: Math.max(size.width, container.width + DAGRE_PADDING.left + DAGRE_PADDING.right),
    height: Math.max(size.height, container.height + DAGRE_PADDING.top + DAGRE_PADDING.bottom),
    x: 0,
    y: 0,
    children,
  };
}

function collectDagreNodes(
  layout: DagreNodeLayout,
  parent: DagreNodeLayout | undefined,
  origin: TopologyElkPoint,
  nodes: Node<TopologyRendererNodeData>[],
  edges: Edge<TopologyRendererEdgeData>[],
  aspectRatio: number,
) {
  if (layout.node.id !== "root") {
    nodes.push({
      id: layout.node.id,
      type: layout.node.nodes?.length && !layout.node.collapsed ? "topologyGroup" : "topologyObject",
      position: { x: layout.x, y: layout.y },
      parentId: parent?.node.id === "root" ? undefined : parent?.node.id,
      extent: parent && parent.node.id !== "root" ? "parent" : undefined,
      draggable: false,
      selectable: true,
      style: { width: layout.width, height: layout.height },
      data: { graphNode: layout.node },
    });
  }
  const container = layoutDagreContainer(layout.node, aspectRatio);
  const directLayouts = layout.children ?? [];
  (container.edges ?? []).forEach((relation) => {
    const source = directChildForId(directLayouts, relation.source);
    const target = directChildForId(directLayouts, relation.target);
    if (!source || !target || source.node.id === target.node.id) return;
    const semantics = getKubejojoRelationSemantics(relation.type, relation.role, relation.label);
    const section = orthogonalSection(source, target);
    edges.push({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      type: "topologyEdge",
      data: {
        sections: [section],
        parentOffset: origin,
        relationIds: [relation.id],
        role: relation.role,
        relationType: semantics.type,
        relationDomain: semantics.domain,
        label: visualEdgeLabel(relation),
        labelPosition: bezierPathMidpoint([section], origin),
        stroke: semantics.stroke,
        dashed: semantics.dashed,
        ports: relation.ports,
        evidence: relation.evidence,
        confidence: relation.confidence,
      },
    });
  });
  directLayouts.forEach((child) => collectDagreNodes(child, layout, { x: origin.x + child.x, y: origin.y + child.y }, nodes, edges, aspectRatio));
}

export async function layoutKubejojoGraph(root: KubejojoGraphNode, aspectRatio: number): Promise<{
  nodes: Node<TopologyRendererNodeData>[];
  edges: Edge<TopologyRendererEdgeData>[];
}> {
  const resolvedAspectRatio = normalizeAspectRatio(aspectRatio);
  const layout = layoutDagreNode(root, resolvedAspectRatio);
  const nodes: Node<TopologyRendererNodeData>[] = [];
  const edges: Edge<TopologyRendererEdgeData>[] = [];
  collectDagreNodes(layout, undefined, { x: 0, y: 0 }, nodes, edges, resolvedAspectRatio);
  return { nodes, edges };
}
