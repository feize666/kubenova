import dagre from "@dagrejs/dagre";
import type { TopologyLayoutEdge, TopologyLayoutNode, TopologyLayoutOptions, TopologyPosition } from "./contract";

const DEFAULT_LAYOUT: Required<TopologyLayoutOptions> = {
  direction: "LR",
  nodeWidth: 236,
  nodeHeight: 72,
  nodeSeparation: 44,
  rankSeparation: 96,
  marginX: 32,
  marginY: 32,
};

function compareById<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id, "en");
}

export function layoutTopologyGraph(
  nodes: readonly TopologyLayoutNode[],
  edges: readonly TopologyLayoutEdge[],
  options: TopologyLayoutOptions = {},
): ReadonlyMap<string, TopologyPosition> {
  const config = { ...DEFAULT_LAYOUT, ...options };
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: config.direction,
    nodesep: config.nodeSeparation,
    ranksep: config.rankSeparation,
    marginx: config.marginX,
    marginy: config.marginY,
    ranker: "network-simplex",
  });
  graph.setDefaultEdgeLabel(() => ({}));

  [...nodes].sort(compareById).forEach((node) => {
    graph.setNode(node.id, {
      width: node.width ?? config.nodeWidth,
      height: node.height ?? config.nodeHeight,
    });
  });
  [...edges]
    .filter((edge) => graph.hasNode(edge.source) && graph.hasNode(edge.target))
    .sort(compareById)
    .forEach((edge) => graph.setEdge(edge.source, edge.target, {}, edge.id));

  dagre.layout(graph);
  return new Map(
    [...nodes]
      .sort(compareById)
      .map((node) => {
        const position = graph.node(node.id);
        const width = node.width ?? config.nodeWidth;
        const height = node.height ?? config.nodeHeight;
        return [node.id, { x: position.x - width / 2, y: position.y - height / 2 }] as const;
      }),
  );
}
