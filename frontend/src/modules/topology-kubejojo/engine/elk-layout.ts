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
  ports?: ElkGraphPort[];
  children?: ElkGraph[];
  edges?: ElkGraphEdge[];
};

export type ElkGraphPort = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
};

export type ElkGraphEdge = {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
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
  members: KubejojoRelation[];
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
  const projected = (node.edges ?? [])
    .filter((edge) => contained.has(edge.source) && contained.has(edge.target))
    .flatMap((relation) => {
      const source = directChildId(node, relation.source);
      const target = directChildId(node, relation.target);
      if (!source || !target || source === target) return [];
      const semantics = relation.type ?? relation.role ?? relation.label ?? "unknown";
      return [{ relation, source, target, key: `${source}\u0000${target}\u0000${semantics}` }];
    });
  const groups = new Map<string, typeof projected>();
  projected.forEach((item) => groups.set(item.key, [...(groups.get(item.key) ?? []), item]));
  return [...groups.entries()]
    .map(([key, members]) => {
      const relations = members.map((member) => member.relation);
      const first = relations[0];
      const isAggregate = relations.length > 1;
      const relation = isAggregate
        ? { ...first, id: `stacked:${encodeURIComponent(key)}` }
        : first;
      return {
        relation,
        source: members[0].source,
        target: members[0].target,
        members: relations,
      };
    })
    .sort((left, right) => left.relation.id.localeCompare(right.relation.id, "en"));
}

/**
 * Headlamp sorts the members of every container by weight before laying them
 * out, and that sort is also what makes the canvas order-independent.
 */
function orderedChildren(node: KubejojoGraphNode): KubejojoGraphNode[] {
  const children = node.nodes ?? [];
  const byId = new Map(children.map((child) => [child.id, child]));
  const neighborhoods = new Map<string, string[]>();
  const describe = (id: string) => {
    const child = byId.get(id);
    const resource = child?.resource;
    return [resource?.kind ?? "", resource?.namespace ?? "", resource?.name ?? "", id].join("\u0000");
  };

  containerRelations(node).forEach(({ relation, source, target }) => {
    const type = relation.type ?? relation.role ?? relation.label ?? "unknown";
    const sourceKey = neighborhoods.get(source) ?? [];
    sourceKey.push(`out:${type}:${describe(target)}`);
    neighborhoods.set(source, sourceKey);
    const targetKey = neighborhoods.get(target) ?? [];
    targetKey.push(`in:${type}:${describe(source)}`);
    neighborhoods.set(target, targetKey);
  });

  const signature = (id: string) => (neighborhoods.get(id) ?? []).sort().join("\u0001");
  return [...children].sort((left, right) =>
    getKubejojoWeight(right) - getKubejojoWeight(left)
    || (left.resource?.kind ?? "").localeCompare(right.resource?.kind ?? "", "en")
    || signature(left.id).localeCompare(signature(right.id), "en")
    || compareKubejojoNodes(left, right),
  );
}

function directionLayoutOptions(direction: "RIGHT" | "DOWN") {
  // Keep the default graph explicitly horizontal; stack containers opt into
  // the vertical variant below without changing the main Node-Link flow.
  if (direction === "RIGHT") return { "elk.direction": "RIGHT" };
  return { "elk.direction": "DOWN" };
}

/** Headlamp's layered spline layout, explicitly horizontal for this console. */
export function containerLayoutOptions(hasEdges: boolean, direction: "RIGHT" | "DOWN" = "RIGHT"): Record<string, string> {
  if (!hasEdges) {
    if (direction === "DOWN") {
      return {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.packedNodeSpacing),
        "elk.padding": `[left=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, top=12, right=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, bottom=12]`,
      };
    }
    return {
      // A stack is expanded as a vertical rail. Rectpacking is useful for
      // disconnected top-level groups, but it places stack members side by
      // side and makes the relationship scan jump between rows.
      "elk.algorithm": "rectpacking",
      "elk.rectpacking.widthApproximation.optimizationGoal": "ASPECT_RATIO_DRIVEN",
      "elk.rectpacking.packing.compaction.rowHeightReevaluation": "true",
      "elk.edgeRouting": "SPLINES",
      "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.packedNodeSpacing),
      "elk.padding": `[left=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, top=12, right=${KUBEJOJO_LAYOUT_METRICS.packedPaddingSide}, bottom=12]`,
    };
  }
  return {
    "elk.algorithm": "layered",
    "elk.partitioning.activate": "true",
    ...directionLayoutOptions(direction),
    "elk.randomSeed": "1",
    "elk.separateConnectedComponents": "true",
    "elk.edgeRouting": "SPLINES",
    "elk.nodeSize.minimum": "(220.0,70.0)",
    "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
    "elk.spacing.nodeNode": String(KUBEJOJO_LAYOUT_METRICS.nodeSpacing),
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
      layoutOptions: { "elk.partitioning.partition": String(-getKubejojoWeight(node)) },
    };
  }

  // Route higher-priority resource kinds toward lower-priority kinds, retaining
  // the original business relation separately from its visual orientation.
  const childWeightById = new Map<string, number>();
  (node.nodes ?? []).forEach((child) => childWeightById.set(child.id, getKubejojoWeight(child)));
  const oriented = (source: string, target: string): [string, string] => {
    const sourceWeight = childWeightById.get(source);
    const targetWeight = childWeightById.get(target);
    if (sourceWeight === undefined || targetWeight === undefined) return [source, target];
    return sourceWeight >= targetWeight ? [source, target] : [target, source];
  };

  const relations = containerRelations(node);
  const children = orderedChildren(node).map(toElkGraph);
  const edges: ElkGraphEdge[] = relations
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
    layoutOptions: { ...containerLayoutOptions(edges.length > 0, node.groupKind === "stack" ? "DOWN" : "RIGHT"),
      "elk.partitioning.partition": String(-getKubejojoWeight(node)) },
    ...(edges.length ? { edges } : {}),
    children,
  };
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
 * Resource relationships are visually undirected, but stable endpoint ordering
 * keeps edge geometry independent of API response order and preserves the
 * familiar workload-to-network reading direction in the layered layout.
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
      relationIds: drawn.members.map((member) => member.id),
      ...(drawn.members.length > 1 ? { count: drawn.members.length } : {}),
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
