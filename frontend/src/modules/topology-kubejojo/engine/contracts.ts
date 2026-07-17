import type { Edge, Node } from "reactflow";

export type TopologyViewState = "default" | "focused" | "context" | "muted";

export type TopologyResource = {
  id: string;
  kind: string;
  name: string;
  namespace?: string | null;
  instanceName?: string | null;
  nodeName?: string | null;
  weight?: number;
  [key: string]: unknown;
};

export type TopologyRelation<TData = unknown> = {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: TData;
};

export type TopologyGraphNode<TResource extends TopologyResource = TopologyResource> = {
  id: string;
  label?: string;
  subtitle?: string;
  resource?: TResource;
  nodes?: TopologyGraphNode<TResource>[];
  edges?: TopologyGraphEdge[];
  collapsed?: boolean;
  weight?: number;
  data?: Record<string, unknown>;
};

export type TopologyGraphEdge<TData = unknown> = {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: TData;
};

export type TopologyFlowNodeData<TResource extends TopologyResource = TopologyResource> = {
  graphNode: TopologyGraphNode<TResource>;
  viewState?: TopologyViewState;
};

export type TopologyEdgeSection = {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: Array<{ x: number; y: number }>;
};

export type TopologyFlowEdgeData = {
  edge?: TopologyGraphEdge;
  sections: TopologyEdgeSection[];
  /** Origin of the ELK container that owns sections, in canvas coordinates. */
  parentOffset: { x: number; y: number };
  viewState?: TopologyViewState;
};

export type TopologyFlowNode<TResource extends TopologyResource = TopologyResource> = Node<
  TopologyFlowNodeData<TResource>
>;

export type TopologyFlowEdge = Edge<TopologyFlowEdgeData>;

export type TopologyLayoutResult<TResource extends TopologyResource = TopologyResource> = {
  nodes: TopologyFlowNode<TResource>[];
  edges: TopologyFlowEdge[];
};

export type GroupByMode = "node" | "namespace" | "instance";
