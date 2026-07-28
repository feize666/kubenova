import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type {
  TopologyRendererEdgeData,
  TopologyRendererGraphNode,
  TopologyRendererNodeData,
} from "../renderers";
import type { CapacityResourceAggregation, TopologyCapacityMetadata } from "./capacity";
import {
  getKubejojoRelationSemantics,
  type KubejojoLegacyRelationRole,
  type KubejojoRelationType,
  type KubejojoStableIdentity,
} from "./relations";

export * from "./capacity";
export * from "./relations";

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

const elk = new ELK();
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
const DEFAULT_ASPECT_RATIO = 1.6;

export const KUBEJOJO_LAYOUT_METRICS = Object.freeze({
  nodeWidth: 220,
  nodeHeight: 88,
  groupWidth: 260,
  groupHeight: 132,
  layeredNodeSpacing: 32,
  layeredLayerSpacing: 44,
  packedNodeSpacing: 14,
});

export type KubejojoLayoutPolicy = {
  algorithm: "layered" | "rectpacking";
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

function normalizeAspectRatio(aspectRatio: number) {
  return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT_RATIO;
}

export function getKubejojoLayoutPolicy(hasEdges: boolean, aspectRatio: number): KubejojoLayoutPolicy {
  const normalizedAspectRatio = normalizeAspectRatio(aspectRatio);
  return {
    algorithm: hasEdges ? "layered" : "rectpacking",
    direction: normalizedAspectRatio >= 1 ? "RIGHT" : "DOWN",
    aspectRatio: normalizedAspectRatio,
  };
}

export function getKubejojoPartition(node: KubejojoGraphNode) {
  return -weight(node);
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
  if (groupBy === "namespace") return "名称空间";
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
): KubejojoGraphNode {
  const { backbone, overlays } = partitionKubejojoRelations(relations);
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
        // Scope focus reveals the next level only. Components remain summaries
        // until the operator explicitly enters one, avoiding a resource-name matrix.
        collapsed = node.id !== selected.id && (node.collapsedPreferred ?? false);
      }
    }
    return {
      ...node,
      nodes: node.nodes?.map(clone),
      collapsed,
    };
  };
  const visible = selected && selected.id !== "root"
    ? { ...root, nodes: [selected], edges: root.edges }
    : root;
  return clone(visible);
}

type ElkNodeData = ElkNode & {
  id: string;
  type?: string;
  data?: TopologyRendererNodeData;
  children?: ElkNodeData[];
  edges?: Array<ElkExtendedEdge & { data?: KubejojoRelation }>;
};

function toElk(node: KubejojoGraphNode, aspect: number): ElkNodeData {
  const children = node.collapsed ? undefined : node.nodes?.map((child) => toElk(child, aspect));
  const containedIds = new Set(leaves(node).map((child) => child.id));
  // A collapsed node is represented as one visible card. Its child nodes do
  // not exist in this ELK pass, so their internal edges stay inside the
  // component until the operator focuses that component.
  const edges: Array<ElkExtendedEdge & { data?: KubejojoRelation }> = (node.collapsed ? [] : node.edges ?? [])
    .filter((edge) => containedIds.has(edge.source) && containedIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      type: "topologyEdge",
      sources: [edge.source],
      targets: [edge.target],
      labels: [{ text: edge.label || getKubejojoRelationSemantics(edge.type, edge.role).label, width: 76, height: 18 }],
      data: edge,
    }));
  const isGroup = Boolean(node.nodes?.length && !node.collapsed);
  const policy = getKubejojoLayoutPolicy(edges.length > 0, aspect);
  const groupOptions: Record<string, string> = edges.length
    ? {
      "partitioning.activate": "true",
      "elk.algorithm": "layered",
      "elk.direction": policy.direction,
      "elk.edgeRouting": "SPLINES",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.nodeSize.minimum": `(${KUBEJOJO_LAYOUT_METRICS.nodeWidth}.0,${KUBEJOJO_LAYOUT_METRICS.nodeHeight}.0)`,
      "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
      "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.layeredNodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(KUBEJOJO_LAYOUT_METRICS.layeredLayerSpacing),
      "elk.padding": "[left=16, top=60, right=16, bottom=18]",
    }
    : {
      "elk.algorithm": "rectpacking",
      "elk.aspectRatio": String(policy.aspectRatio),
      "elk.rectpacking.widthApproximation.optimizationGoal": "ASPECT_RATIO_DRIVEN",
      "elk.rectpacking.packing.compaction.rowHeightReevaluation": "true",
      "elk.edgeRouting": "SPLINES",
      "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.packedNodeSpacing),
      "elk.padding": "[left=16, top=64, right=16, bottom=18]",
    };
  return {
    id: node.id,
    type: isGroup ? "topologyGroup" : "topologyObject",
    data: { graphNode: node },
    width: isGroup ? KUBEJOJO_LAYOUT_METRICS.groupWidth : KUBEJOJO_LAYOUT_METRICS.nodeWidth,
    height: isGroup ? KUBEJOJO_LAYOUT_METRICS.groupHeight : KUBEJOJO_LAYOUT_METRICS.nodeHeight,
    children,
    edges,
    layoutOptions: isGroup
      ? { ...groupOptions, "partitioning.partition": String(getKubejojoPartition(node)) }
      : { "partitioning.partition": String(getKubejojoPartition(node)) },
  };
}

export async function layoutKubejojoGraph(root: KubejojoGraphNode, aspectRatio: number): Promise<{
  nodes: Node<TopologyRendererNodeData>[];
  edges: Edge<TopologyRendererEdgeData>[];
}> {
  const resolvedAspectRatio = normalizeAspectRatio(aspectRatio);
  const graph = await elk.layout(toElk(root, resolvedAspectRatio), {
    layoutOptions: { "elk.aspectRatio": String(resolvedAspectRatio) },
  }) as ElkNodeData;
  const nodes: Node<TopologyRendererNodeData>[] = [];
  const edges: Edge<TopologyRendererEdgeData>[] = [];
  const visit = (node: ElkNodeData, parent?: ElkNodeData, parentOffset = { x: 0, y: 0 }) => {
    const absolutePosition = { x: parentOffset.x + (node.x ?? 0), y: parentOffset.y + (node.y ?? 0) };
    (node.edges ?? []).forEach((edge) => {
      if (!edge.sections?.length) return;
      const relation = (edge as ElkExtendedEdge & { data?: KubejojoRelation }).data;
      const semantics = getKubejojoRelationSemantics(relation?.type, relation?.role, relation?.label);
      edges.push({
        id: edge.id,
        source: edge.sources?.[0] ?? "",
        target: edge.targets?.[0] ?? "",
        type: "topologyEdge",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          sections: edge.sections,
          parentOffset: absolutePosition,
          relationIds: relation ? [relation.id] : [],
          role: relation?.role,
          relationType: semantics.type,
          relationDomain: semantics.domain,
          label: relation?.label || semantics.label,
          stroke: semantics.stroke,
          dashed: semantics.dashed,
          ports: relation?.ports,
          evidence: relation?.evidence,
          confidence: relation?.confidence,
        },
      });
    });
    if (node.id !== "root") {
      nodes.push({
        id: node.id,
        type: node.type,
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        parentId: parent?.id === "root" ? undefined : parent?.id,
        extent: parent && parent.id !== "root" ? "parent" : undefined,
        draggable: false,
        selectable: true,
        style: { width: node.width, height: node.height },
        data: node.data!,
      });
    }
    node.children?.forEach((child) => visit(child, node, absolutePosition));
  };
  visit(graph);
  return { nodes, edges };
}
