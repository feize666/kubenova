import type { EdgeMarker, Node } from "reactflow";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

import type {
  TopologyFlowEdge,
  TopologyFlowEdgeData,
  TopologyFlowNode,
  TopologyFlowNodeData,
  TopologyGraphEdge,
  TopologyGraphNode,
  TopologyLayoutResult,
  TopologyResource,
} from "./contracts";
import { getNodeWeight } from "./model";

type ElkNodeWithData<TResource extends TopologyResource> = ElkNode & {
  type: "topologyGroup" | "topologyObject";
  data: TopologyFlowNodeData<TResource>;
  edges?: ElkEdgeWithData[];
  children?: ElkNodeWithData<TResource>[];
};

type ElkEdgeWithData = ElkExtendedEdge & {
  type?: string;
  data?: TopologyGraphEdge;
};

export type TopologyLayoutOptions = {
  aspectRatio?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  groupWidth?: number;
  groupHeight?: number;
};

const DEFAULT_OPTIONS: Required<TopologyLayoutOptions> = {
  aspectRatio: 1.6,
  nodeWidth: 228,
  nodeHeight: 96,
  groupWidth: 284,
  groupHeight: 156,
};

const elk = new ELK();

function getPartitionLayer<TResource extends TopologyResource>(node: TopologyGraphNode<TResource>): number {
  return -getNodeWeight(node);
}

function containsNode<TResource extends TopologyResource>(node: TopologyGraphNode<TResource>, id: string): boolean {
  return node.id === id || Boolean(node.nodes?.some((child) => containsNode(child, id)));
}

/**
 * ELK may only route to rendered children. When a descendant group is folded,
 * its resources are replaced by the group card, so all parent-owned relations
 * are projected to that visible card before layout.
 */
export function resolveCollapsedEndpoint<TResource extends TopologyResource>(
  container: TopologyGraphNode<TResource>,
  id: string,
): string | undefined {
  if (container.id === id) return id;
  for (const child of container.nodes ?? []) {
    if (!containsNode(child, id)) continue;
    if (child.collapsed) return child.id;
    return resolveCollapsedEndpoint(child, id);
  }
  return undefined;
}

function toElkNode<TResource extends TopologyResource>(
  node: TopologyGraphNode<TResource>,
  options: Required<TopologyLayoutOptions>,
): ElkNodeWithData<TResource> {
  const containedEdges = (node.edges ?? []).reduce<ElkEdgeWithData[]>((result, edge) => {
    const source = resolveCollapsedEndpoint(node, edge.source);
    const target = resolveCollapsedEndpoint(node, edge.target);
    if (!source || !target || source === target) return result;
    result.push({
      id: edge.id,
      type: "topologyEdge",
      sources: [source],
      targets: [target],
      labels: edge.label ? [{ text: edge.label, width: 60, height: 18 }] : undefined,
      data: edge,
    } as ElkEdgeWithData);
    return result;
  }, []);

  const elkNode: ElkNodeWithData<TResource> = {
    id: node.id,
    type: node.nodes?.length && !node.collapsed ? "topologyGroup" : "topologyObject",
    data: { graphNode: node },
  };
  if (!node.nodes?.length) {
    elkNode.layoutOptions = { "partitioning.partition": String(getPartitionLayer(node)) };
    elkNode.width = options.nodeWidth;
    elkNode.height = options.nodeHeight;
    return elkNode;
  }
  if (node.collapsed) {
    elkNode.width = options.nodeWidth;
    elkNode.height = options.nodeHeight;
    return elkNode;
  }

  elkNode.layoutOptions = containedEdges.length
    ? {
        "partitioning.activate": "true",
        "elk.direction": "UNDEFINED",
        "elk.edgeRouting": "SPLINES",
        "elk.algorithm": "layered",
        "elk.nodeSize.minimum": `(${options.nodeWidth}.0,${options.nodeHeight}.0)`,
        "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
        "elk.spacing.nodeNode": "52",
        "elk.layered.spacing.nodeNodeBetweenLayers": "58",
        "elk.padding": "[left=20, top=76, right=20, bottom=24]",
      }
    : {
        "elk.algorithm": "rectpacking",
        "elk.aspectRatio": String(options.aspectRatio),
        "elk.edgeRouting": "SPLINES",
        "elk.spacing.nodeNode": "20",
        "elk.padding": "[left=20, top=84, right=20, bottom=24]",
      };
  elkNode.edges = containedEdges;
  elkNode.children = node.nodes.map((child) => toElkNode(child, options));
  elkNode.width = options.groupWidth;
  elkNode.height = options.groupHeight;
  return elkNode;
}

function makeEdgeData(edge: ElkExtendedEdge, origin: { x: number; y: number }): TopologyFlowEdgeData | undefined {
  if (!edge.sections?.length) return undefined;
  return {
    edge: (edge as ElkEdgeWithData).data,
    sections: edge.sections,
    parentOffset: origin,
  };
}

function convertToFlow<TResource extends TopologyResource>(
  graph: ElkNodeWithData<TResource>,
): TopologyLayoutResult<TResource> {
  const nodes: TopologyFlowNode<TResource>[] = [];
  const edges: TopologyFlowEdge[] = [];
  const append = (node: ElkNodeWithData<TResource>, parentId: string | undefined, parentOrigin: { x: number; y: number }) => {
    const origin = { x: parentOrigin.x + (node.x ?? 0), y: parentOrigin.y + (node.y ?? 0) };
    nodes.push({
      id: node.id,
      type: node.type,
      position: { x: node.x ?? 0, y: node.y ?? 0 },
      width: node.width,
      height: node.height,
      parentNode: parentId,
      extent: parentId ? "parent" : undefined,
      draggable: false,
      selectable: true,
      style: { width: node.width, height: node.height },
      data: node.data,
    } as Node<TopologyFlowNodeData<TResource>>);
    (node.edges ?? []).forEach((edge) => {
      const data = makeEdgeData(edge, origin);
      if (!data) return;
      edges.push({
        id: edge.id,
        source: edge.sources?.[0] ?? "",
        target: edge.targets?.[0] ?? "",
        type: (edge as ElkEdgeWithData).type ?? "topologyEdge",
        markerEnd: { type: "arrowclosed" } as EdgeMarker,
        data,
      });
    });
    node.children?.forEach((child) => append(child as ElkNodeWithData<TResource>, node.id, origin));
  };

  (graph.edges ?? []).forEach((edge) => {
    const data = makeEdgeData(edge, { x: 0, y: 0 });
    if (!data) return;
    edges.push({
      id: edge.id,
      source: edge.sources?.[0] ?? "",
      target: edge.targets?.[0] ?? "",
      type: (edge as ElkEdgeWithData).type ?? "topologyEdge",
      markerEnd: { type: "arrowclosed" } as EdgeMarker,
      data,
    });
  });
  graph.children?.forEach((child) => append(child as ElkNodeWithData<TResource>, undefined, { x: 0, y: 0 }));
  return { nodes, edges };
}

export async function applyGraphLayout<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
  options: TopologyLayoutOptions = {},
): Promise<TopologyLayoutResult<TResource>> {
  if (!graph.nodes?.length) return { nodes: [], edges: [] };
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const layouted = await elk.layout(toElkNode(graph, resolved), {
    layoutOptions: { "elk.aspectRatio": String(resolved.aspectRatio) },
  });
  return convertToFlow(layouted as ElkNodeWithData<TResource>);
}
