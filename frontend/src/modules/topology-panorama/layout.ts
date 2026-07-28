import * as dagre from "@dagrejs/dagre";
import type { XYPosition } from "reactflow";
import type {
  TopologyFlowEdge,
  TopologyFlowNode,
  TopologyGraphNode,
  TopologyLayoutEngine,
  TopologyLayoutNode,
  TopologyLayoutOptions,
  TopologyLayoutResult,
} from "./contracts";
import { collectVisibleRelations } from "./grouping";

const DEFAULT_OPTIONS: Required<TopologyLayoutOptions> = {
  direction: "LR",
  nodeSize: { width: 228, height: 96 },
  groupPadding: { top: 72, right: 24, bottom: 24, left: 24 },
  siblingGap: 36,
  rankGap: 64,
};

function makeLayoutTree(node: TopologyGraphNode, options: Required<TopologyLayoutOptions>): TopologyLayoutNode {
  return {
    id: node.id,
    width: options.nodeSize.width,
    height: options.nodeSize.height,
    children: node.collapsed ? undefined : node.children?.map((child) => makeLayoutTree(child, options)),
    edges: node.edges,
  };
}

function flattenLayoutNodes(nodes: Array<TopologyLayoutNode & { position: XYPosition }>): Map<string, XYPosition> {
  return new Map(nodes.map((node) => [node.id, node.position]));
}

/**
 * A runtime fallback using the installed Dagre dependency. It lays out every expanded group locally,
 * retaining React Flow's relative child coordinates. Replace it with an ELK
 * adapter through `layoutTopologyPanorama` when elkjs is available to the host.
 */
export function createDagreLayoutEngine(): TopologyLayoutEngine {
  return {
    async layout(root, options) {
      const output: Array<TopologyLayoutNode & { position: XYPosition }> = [];
      const layoutChildren = (parent: TopologyLayoutNode, isRoot = false): void => {
        const children = parent.children ?? [];
        children.forEach((child) => layoutChildren(child));
        if (!children.length) return;

        const graph = new dagre.graphlib.Graph();
        graph.setGraph({ rankdir: options.direction, nodesep: options.siblingGap, ranksep: options.rankGap, marginx: 0, marginy: 0 });
        graph.setDefaultEdgeLabel(() => ({}));
        children.forEach((child) => graph.setNode(child.id, { width: child.width, height: child.height }));
        const childIds = new Set(children.map((child) => child.id));
        parent.edges?.forEach((edge) => {
          if (childIds.has(edge.source) && childIds.has(edge.target)) graph.setEdge(edge.source, edge.target);
        });
        dagre.layout(graph);

        let maxX = 0;
        let maxY = 0;
        for (const child of children) {
          const position = graph.node(child.id) as { x: number; y: number };
          const offsetX = isRoot ? 0 : options.groupPadding.left;
          const offsetY = isRoot ? 0 : options.groupPadding.top;
          child.position = { x: position.x - child.width / 2 + offsetX, y: position.y - child.height / 2 + offsetY };
          maxX = Math.max(maxX, child.position.x + child.width);
          maxY = Math.max(maxY, child.position.y + child.height);
          output.push(Object.assign(child, { position: child.position }));
        }
        if (!isRoot) {
          parent.width = Math.max(parent.width, maxX + options.groupPadding.right);
          parent.height = Math.max(parent.height, maxY + options.groupPadding.bottom);
        }
      };
      layoutChildren(root, true);
      return { nodes: output };
    },
  };
}

export async function layoutTopologyPanorama(
  root: TopologyGraphNode,
  projection: { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] },
  engine: TopologyLayoutEngine = createDagreLayoutEngine(),
  options: TopologyLayoutOptions = {},
): Promise<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }> {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options, nodeSize: { ...DEFAULT_OPTIONS.nodeSize, ...options.nodeSize }, groupPadding: { ...DEFAULT_OPTIONS.groupPadding, ...options.groupPadding } };
  const tree: TopologyLayoutNode = {
    id: "topology-layout-root",
    width: 0,
    height: 0,
    children: root.collapsed ? undefined : root.children?.map((child) => makeLayoutTree(child, resolvedOptions)),
    edges: collectVisibleRelations(root),
  };
  const result: TopologyLayoutResult = await engine.layout(tree, resolvedOptions);
  const positions = flattenLayoutNodes(result.nodes);
  return {
    nodes: projection.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
      style: { ...node.style, width: node.width ?? resolvedOptions.nodeSize.width, height: node.height ?? resolvedOptions.nodeSize.height },
    })),
    edges: projection.edges,
  };
}
