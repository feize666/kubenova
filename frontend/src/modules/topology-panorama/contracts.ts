import type { Edge, Node, XYPosition } from "reactflow";

export type TopologyGroupBy = "namespace" | "instance" | "node";
export type TopologyViewState = "default" | "focused" | "context" | "muted";

export interface TopologyResource {
  id: string;
  label: string;
  kind?: string;
  namespace?: string | null;
  instance?: string | null;
  nodeName?: string | null;
  weight?: number;
  data?: Record<string, unknown>;
}

export interface TopologyRelation {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: Record<string, unknown>;
}

export interface TopologyGraphNode {
  id: string;
  label?: string;
  subtitle?: string;
  resource?: TopologyResource;
  children?: TopologyGraphNode[];
  edges?: TopologyRelation[];
  collapsed?: boolean;
  weight?: number;
  data?: Record<string, unknown>;
}

export interface TopologyGraph {
  nodes: TopologyGraphNode[];
  edges: TopologyRelation[];
}

export interface TopologyFlowNodeData {
  graphNode: TopologyGraphNode;
  viewState: TopologyViewState;
}

export interface TopologyFlowEdgeData {
  relations: TopologyRelation[];
  viewState: TopologyViewState;
  aggregated: boolean;
}

export type TopologyFlowNode = Node<TopologyFlowNodeData>;
export type TopologyFlowEdge = Edge<TopologyFlowEdgeData>;

export interface TopologyLayoutOptions {
  direction?: "TB" | "BT" | "LR" | "RL";
  nodeSize?: { width: number; height: number };
  groupPadding?: { top: number; right: number; bottom: number; left: number };
  siblingGap?: number;
  rankGap?: number;
}

export interface TopologyLayoutNode {
  id: string;
  width: number;
  height: number;
  children?: TopologyLayoutNode[];
  edges?: TopologyRelation[];
  position?: XYPosition;
}

export interface TopologyLayoutResult {
  nodes: Array<TopologyLayoutNode & { position: XYPosition }>;
}

/** Adapter boundary for ELK or another layout engine. */
export interface TopologyLayoutEngine {
  layout(root: TopologyLayoutNode, options: Required<TopologyLayoutOptions>): Promise<TopologyLayoutResult>;
}
