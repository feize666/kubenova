export type TopologyStatus = "healthy" | "warning" | "critical" | "unknown";

export type TopologyRelationRole =
  | "owner"
  | "selector"
  | "network"
  | "storage"
  | "configuration"
  | "gateway"
  | "scope"
  | "related";

export interface TopologyResource<TData = unknown> {
  id: string;
  label: string;
  kind: string;
  source: string;
  status: TopologyStatus;
  subtitle?: string;
  namespace?: string;
  clusterId?: string;
  group?: string;
  weight?: number;
  data?: TData;
}

export interface TopologyRelation<TData = unknown> {
  id: string;
  source: string;
  target: string;
  role: TopologyRelationRole;
  label?: string;
  data?: TData;
}

export interface TopologyGraph<TNodeData = unknown, TRelationData = unknown> {
  resources: readonly TopologyResource<TNodeData>[];
  relations: readonly TopologyRelation<TRelationData>[];
}

export type TopologyGroupBy = "namespace" | "source" | "kind" | "custom";

export interface TopologyGroup {
  id: string;
  key: string;
  label: string;
  resourceIds: readonly string[];
}

export interface TopologyGroupResolver<TData = unknown> {
  id: string;
  label: string;
  getKey: (resource: TopologyResource<TData>) => string;
  getLabel?: (key: string) => string;
}

export interface TopologyViewNode<TData = unknown> {
  id: string;
  type: "resource" | "group";
  label: string;
  subtitle?: string;
  status: TopologyStatus;
  resource?: TopologyResource<TData>;
  group?: TopologyGroup;
  hiddenChildCount?: number;
}

export interface TopologyViewRelation<TData = unknown> {
  id: string;
  source: string;
  target: string;
  role: TopologyRelationRole;
  label?: string;
  relationIds: readonly string[];
  count: number;
  data?: TData;
}

export interface TopologyView<TNodeData = unknown, TRelationData = unknown> {
  nodes: readonly TopologyViewNode<TNodeData>[];
  relations: readonly TopologyViewRelation<TRelationData>[];
  groups: readonly TopologyGroup[];
  focusedResourceIds: readonly string[];
}

export interface TopologyFocusState {
  focusedNodeId: string | null;
  depth: number;
}

export type TopologyFocusAction =
  | { type: "focus"; nodeId: string; depth?: number }
  | { type: "clear" }
  | { type: "set-depth"; depth: number };

export interface TopologyLayoutNode {
  id: string;
  width?: number;
  height?: number;
}

export interface TopologyLayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface TopologyPosition {
  x: number;
  y: number;
}

export interface TopologyLayoutOptions {
  direction?: "LR" | "RL" | "TB" | "BT";
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSeparation?: number;
  rankSeparation?: number;
  marginX?: number;
  marginY?: number;
}
