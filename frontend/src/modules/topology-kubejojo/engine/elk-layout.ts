import { type Edge, type Node } from "@xyflow/react";

import type {
  TopologyElkPoint,
  TopologyElkSection,
  TopologyRendererEdgeData,
  TopologyRendererNodeData,
} from "../renderers";
import { bezierPathMidpoint } from "../renderers/path-geometry";
import {
  KUBEJOJO_LAYOUT_METRICS,
  compareKubejojoNodes,
  eachKubejojo,
  getKubejojoWeight,
  leavesKubejojo,
  type KubejojoGraphNode,
  type KubejojoRelation,
} from "./graph-model";
import { getKubejojoRelationSemantics } from "./relations";

/** The subset of the ELK API this adapter depends on. */
export type ElkGraph = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkGraph[];
  edges?: ElkGraphEdge[];
};

export type ElkGraphEdge = {
  id: string;
  sources: string[];
  targets: string[];
  labels?: Array<{ text: string }>;
  sections?: TopologyElkSection[];
};

export type ElkEngine = {
  layout(graph: ElkGraph, options?: { layoutOptions?: Record<string, string> }): Promise<ElkGraph>;
};

export type KubejojoLayout = {
  nodes: Node<TopologyRendererNodeData>[];
  edges: Edge<TopologyRendererEdgeData>[];
};

const NODE_WIDTH = KUBEJOJO_LAYOUT_METRICS.nodeWidth;
const NODE_HEIGHT = KUBEJOJO_LAYOUT_METRICS.nodeHeight;

/**
 * Headlamp derives the layout partition from the node weight and negates it,
 * because ELK places lower partition numbers further left. Matching that sign
 * is what makes a Deployment sit before its ReplicaSet, Pods, Services and
 * Ingresses without any hand-maintained rank table.
 */
export function getPartitionLayer(node: KubejojoGraphNode): number {
  return -getKubejojoWeight(node);
}

function isContainer(node: KubejojoGraphNode): boolean {
  return Boolean(node.nodes?.length) && !node.collapsed;
}

function containedIds(node: KubejojoGraphNode): Set<string> {
  return new Set(leavesKubejojo(node).map((leaf) => leaf.id));
}

/**
 * The direct child of `node` that owns `leafId`, or `leafId` itself when it is
 * already one of `node`'s children.
 *
 * ELK only routes an edge between two of the container's own children, so a
 * relationship reaching a grandchild (a Pod inside a component reading the
 * ConfigMap beside it) is projected onto the owning child. The rail then leaves
 * the component box, which is how Headlamp draws the same dependency instead of
 * dropping it.
 */
function directChildId(node: KubejojoGraphNode, leafId: string): string | undefined {
  if ((node.nodes ?? []).some((child) => child.id === leafId)) return leafId;
  return (node.nodes ?? []).find((child) => containedIds(child).has(leafId))?.id;
}

/**
 * One relationship as the container lays it out: the original relation plus the
 * endpoints ELK can actually route between.
 */
export type ContainerRelation = {
  relation: KubejojoRelation;
  source: string;
  target: string;
};

/**
 * Relationships for one container, projected onto its direct children.
 *
 * Endpoints are resolved here rather than in the renderer so the edge that
 * reaches React Flow names real node ids; otherwise React Flow silently drops
 * an edge whose endpoints are not on the canvas.
 */
export function containerRelations(node: KubejojoGraphNode): ContainerRelation[] {
  const contained = containedIds(node);
  return (node.edges ?? [])
    .filter((edge) => contained.has(edge.source) && contained.has(edge.target))
    .flatMap<ContainerRelation>((relation) => {
      const source = directChildId(node, relation.source);
      const target = directChildId(node, relation.target);
      if (!source || !target || source === target) return [];
      return [{ relation, source, target }];
    })
    .sort((left, right) => left.relation.id.localeCompare(right.relation.id, "en"));
}

/**
 * Headlamp sorts the members of every container by weight before laying them
 * out, and that sort is also what makes the canvas order-independent.
 */
function orderedChildren(node: KubejojoGraphNode): KubejojoGraphNode[] {
  return [...(node.nodes ?? [])].sort(compareKubejojoNodes);
}

/**
 * Layered layout for containers with internal relationships, plain rect
 * packing for relationship-free groups. This mirrors Headlamp's per-group
 * option choice, so an all-standalone group still packs tidily.
 */
export function containerLayoutOptions(hasEdges: boolean): Record<string, string> {
  if (!hasEdges) {
    return {
      "elk.algorithm": "rectpacking",
      "elk.rectpacking.widthApproximation.optimizationGoal": "ASPECT_RATIO_DRIVEN",
      "elk.rectpacking.packing.compaction.rowHeightReevaluation": "true",
      "elk.edgeRouting": "SPLINES",
      "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.packedNodeSpacing),
      "elk.padding": `[left=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, top=12, right=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, bottom=12]`,
    };
  }
  return {
    "partitioning.activate": "true",
    // Keep the operator-facing access path horizontal. Partitions still decide
    // the columns; RIGHT makes that contract deterministic across ELK versions.
    "elk.direction": "UNDEFINED",
    "elk.edgeRouting": "SPLINES",
    "elk.algorithm": "layered",
    "elk.nodeSize.minimum": "(220.0,70.0)",
    "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    "elk.padding": "[left=16, top=16, right=16, bottom=16]",
  };
}

/**
 * Converts one graph node into the ELK input shape. Collapsed groups and leaf
 * resources are always exactly one card; expanded groups carry their children
 * plus the relationships with both endpoints inside the group.
 */
export function toElkGraph(node: KubejojoGraphNode): ElkGraph {
  if (!isContainer(node)) {
    return {
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layoutOptions: { "partitioning.partition": String(getPartitionLayer(node)) },
    };
  }

  // ELK routes an edge from its source column to its target column, so an edge
  // handed over in API direction (a Service selecting a Pod) is a backward edge
  // that ELK has to loop around the whole column. Feeding the endpoints in the
  // order the canvas draws them keeps every rail a simple left-to-right run.
  const childWeightById = new Map<string, number>();
  (node.nodes ?? []).forEach((child) => childWeightById.set(child.id, getKubejojoWeight(child)));
  const oriented = (source: string, target: string): [string, string] => {
    const sourceWeight = childWeightById.get(source);
    const targetWeight = childWeightById.get(target);
    if (sourceWeight === undefined || targetWeight === undefined) return [source, target];
    return sourceWeight >= targetWeight ? [source, target] : [target, source];
  };

  const edges: ElkGraphEdge[] = containerRelations(node)
    .map(({ relation, source, target }) => {
      const [from, to] = oriented(source, target);
      return {
        id: relation.id,
        sources: [from],
        targets: [to],
        ...(relation.label ? { labels: [{ text: relation.label }] } : {}),
      };
    });

  return {
    id: node.id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    layoutOptions: containerLayoutOptions(edges.length > 0),
    ...(edges.length ? { edges } : {}),
    children: orderedChildren(node).map(toElkGraph),
  };
}

/** Center each resource rank on the same rail after ELK has separated fan-out. */
function alignFlatAccessPath(root: KubejojoGraphNode, layout: ElkGraph): void {
  if ((root.nodes ?? []).some(isContainer) || !layout.edges?.length || !layout.children?.length) return;
  const columns = new Map<number, ElkGraph[]>();
  layout.children.forEach((child) => {
    const column = columns.get(child.x ?? 0) ?? [];
    column.push(child);
    columns.set(child.x ?? 0, column);
  });
  if (columns.size < 2) return;

  const center = (column: ElkGraph[]) => {
    const top = Math.min(...column.map((child) => child.y ?? 0));
    const bottom = Math.max(...column.map((child) => (child.y ?? 0) + (child.height ?? NODE_HEIGHT)));
    return (top + bottom) / 2;
  };
  const rail = Math.max(...[...columns.values()].map(center));
  const shifts = new Map<string, number>();
  columns.forEach((column) => {
    const shift = rail - center(column);
    column.forEach((child) => {
      child.y = (child.y ?? 0) + shift;
      shifts.set(child.id, shift);
    });
  });

  layout.edges?.forEach((edge) => {
    const sourceShift = shifts.get(edge.sources[0]) ?? 0;
    const targetShift = shifts.get(edge.targets[0]) ?? 0;
    edge.sections?.forEach((section) => {
      const startX = section.startPoint.x;
      const distance = section.endPoint.x - startX;
      const shiftAt = (x: number) => distance === 0
        ? (sourceShift + targetShift) / 2
        : sourceShift + (targetShift - sourceShift) * Math.max(0, Math.min(1, (x - startX) / distance));
      section.startPoint.y += sourceShift;
      section.endPoint.y += targetShift;
      section.bendPoints?.forEach((point) => { point.y += shiftAt(point.x); });
    });

    const source = layout.children?.find((child) => child.id === edge.sources[0]);
    const target = layout.children?.find((child) => child.id === edge.targets[0]);
    if (!source || !target || (source.x ?? 0) >= (target.x ?? 0)) return;
    const startX = (source.x ?? 0) + (source.width ?? NODE_WIDTH);
    const endX = target.x ?? 0;
    const intervening = layout.children!.filter((child) =>
      child.id !== source.id && child.id !== target.id
      && (child.x ?? 0) > (source.x ?? 0)
      && (child.x ?? 0) < endX,
    );
    if (!intervening.length) return;
    const startY = (source.y ?? 0) + (source.height ?? NODE_HEIGHT) / 2;
    const endY = (target.y ?? 0) + (target.height ?? NODE_HEIGHT) / 2;
    const collision = intervening.filter((child) => {
      const left = child.x ?? 0;
      const right = left + (child.width ?? NODE_WIDTH);
      const projected = (x: number) => startY + (endY - startY) * (x - startX) / (endX - startX);
      const low = Math.min(projected(left), projected(right));
      const high = Math.max(projected(left), projected(right));
      const top = child.y ?? 0;
      return high >= top - 8 && low <= top + (child.height ?? NODE_HEIGHT) + 8;
    });
    if (!collision.length) return;
    const top = Math.min(...collision.map((child) => child.y ?? 0));
    const bottom = Math.max(...collision.map((child) => (child.y ?? 0) + (child.height ?? NODE_HEIGHT)));
    const upper = top - 24;
    const lower = bottom + 24;
    const detourY = Math.abs((startY + endY) / 2 - upper) <= Math.abs((startY + endY) / 2 - lower) ? upper : lower;
    const enterX = (startX + Math.min(...collision.map((child) => child.x ?? 0))) / 2;
    const exitX = (endX + Math.max(...collision.map((child) => (child.x ?? 0) + (child.width ?? NODE_WIDTH)))) / 2;
    edge.sections = [
      { startPoint: { x: startX, y: startY }, endPoint: { x: enterX, y: detourY } },
      { startPoint: { x: enterX, y: detourY }, endPoint: { x: exitX, y: detourY } },
      { startPoint: { x: exitX, y: detourY }, endPoint: { x: endX, y: endY } },
    ];
  });
  layout.height = Math.max(layout.height ?? 0, ...layout.children.map((child) => (child.y ?? 0) + (child.height ?? NODE_HEIGHT) + 16));
}

function offsetPoint(point: TopologyElkPoint, offset: TopologyElkPoint): TopologyElkPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function offsetSection(section: TopologyElkSection, offset: TopologyElkPoint): TopologyElkSection {
  return {
    startPoint: offsetPoint(section.startPoint, offset),
    endPoint: offsetPoint(section.endPoint, offset),
    bendPoints: section.bendPoints?.map((point) => offsetPoint(point, offset)),
  };
}

/**
 * API relationships keep their Kubernetes direction (a Service selects a Pod),
 * but the canvas reads left to right. An edge is therefore drawn from the
 * earlier column to the later one so every arrow follows the access path
 * instead of pointing backwards into a Pod.
 */
export function visibleEdgeEndpoints(
  endpoints: { source: string; target: string },
  weightById: ReadonlyMap<string, number>,
): { source: string; target: string } {
  const sourceWeight = weightById.get(endpoints.source);
  const targetWeight = weightById.get(endpoints.target);
  if (sourceWeight === undefined || targetWeight === undefined) return endpoints;
  return sourceWeight >= targetWeight
    ? endpoints
    : { source: endpoints.target, target: endpoints.source };
}

function relationEdge(
  drawn: ContainerRelation,
  sections: TopologyElkSection[],
  weightById: ReadonlyMap<string, number>,
): Edge<TopologyRendererEdgeData> {
  const { relation } = drawn;
  const semantics = getKubejojoRelationSemantics(relation.type, relation.role, relation.label);
  // Endpoints come from the container projection, so they always name nodes that
  // exist on the canvas; the weight only decides which way the arrow points.
  const endpoints = visibleEdgeEndpoints(
    { source: drawn.source, target: drawn.target },
    weightById,
  );
  return {
    id: relation.id,
    source: endpoints.source,
    target: endpoints.target,
    type: "topologyEdge",
    data: {
      sections,
      // Sections are already in canvas coordinates; the renderer must not add
      // a second parent offset on top of them.
      parentOffset: { x: 0, y: 0 },
      relationIds: [relation.id],
      role: relation.role,
      relationType: semantics.type,
      relationDomain: semantics.domain,
      label: semantics.label,
      labelPosition: bezierPathMidpoint(sections, { x: 0, y: 0 }),
      stroke: semantics.stroke,
      dashed: semantics.dashed,
      ports: relation.ports,
      evidence: relation.evidence,
      confidence: relation.confidence,
    },
  };
}

/**
 * Walks the ELK result and emits renderer-ready nodes and edges.
 *
 * React Flow stores a nested node's position relative to its parent, while
 * edges live in the absolute canvas space. `placement` therefore carries the
 * relative position used for node cards, and `origin` tracks the absolute
 * position of the container whose children are being converted so edge
 * sections are lifted into canvas coordinates exactly once.
 */
function emit(
  node: KubejojoGraphNode,
  laidOut: ElkGraph,
  placement: TopologyElkPoint,
  origin: TopologyElkPoint,
  parentId: string | undefined,
  nodes: Node<TopologyRendererNodeData>[],
  edges: Edge<TopologyRendererEdgeData>[],
  weightById: ReadonlyMap<string, number>,
): void {
  const container = isContainer(node);

  if (node.id !== "root") {
    nodes.push({
      id: node.id,
      type: container ? "topologyGroup" : "topologyObject",
      position: { x: placement.x, y: placement.y },
      parentId,
      extent: parentId ? "parent" : undefined,
      draggable: false,
      selectable: true,
      style: {
        width: laidOut.width ?? NODE_WIDTH,
        height: laidOut.height ?? NODE_HEIGHT,
      },
      data: { graphNode: node },
    });
  }

  if (!container) return;

  const drawnById = new Map(
    containerRelations(node).map((drawn) => [drawn.relation.id, drawn] as const),
  );

  (laidOut.edges ?? []).forEach((elkEdge) => {
    const drawn = drawnById.get(elkEdge.id);
    if (!drawn || !elkEdge.sections?.length) return;
    edges.push(relationEdge(
      drawn,
      elkEdge.sections.map((section) => offsetSection(section, origin)),
      weightById,
    ));
  });

  (laidOut.children ?? []).forEach((child) => {
    const graphChild = (node.nodes ?? []).find((item) => item.id === child.id);
    if (!graphChild) return;
    const childPlacement = { x: child.x ?? 0, y: child.y ?? 0 };
    emit(
      graphChild,
      child,
      childPlacement,
      { x: origin.x + childPlacement.x, y: origin.y + childPlacement.y },
      node.id === "root" ? undefined : node.id,
      nodes,
      edges,
      weightById,
    );
  });
}

/** Converts an ELK layout result into renderer-ready nodes and edges. */
export function toKubejojoLayout(root: KubejojoGraphNode, laidOut: ElkGraph): KubejojoLayout {
  alignFlatAccessPath(root, laidOut);
  const nodes: Node<TopologyRendererNodeData>[] = [];
  const edges: Edge<TopologyRendererEdgeData>[] = [];
  const weightById = new Map<string, number>();
  eachKubejojo(root, (node) => weightById.set(node.id, getKubejojoWeight(node)));
  emit(root, laidOut, { x: 0, y: 0 }, { x: 0, y: 0 }, undefined, nodes, edges, weightById);
  return { nodes, edges };
}

/** Cached layout results are keyed by graph shape, not by object identity. */
export function hashLayoutKey(value: string, seed = 5381): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}

export function getKubejojoCacheKey(root: KubejojoGraphNode, aspectRatio: number): string {
  let nodeCount = 0;
  let edgeCount = 0;
  let nodeHash = 5381;
  let edgeHash = 5381;

  const visit = (node: KubejojoGraphNode) => {
    nodeCount += 1;
    nodeHash = hashLayoutKey(`${node.id.length}:${node.id}`, nodeHash);
    nodeHash = hashLayoutKey(node.collapsed ? "collapsed" : "expanded", nodeHash);
    const relations = node.edges ?? [];
    edgeCount += relations.length;
    relations.forEach((relation) => {
      edgeHash = hashLayoutKey(`${relation.source}->${relation.target}`, edgeHash);
    });
    node.nodes?.forEach(visit);
  };
  visit(root);

  return `${nodeCount}-${edgeCount}-${nodeHash}-${edgeHash}-${aspectRatio}`;
}
