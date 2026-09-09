import type { Edge, Node } from "@xyflow/react";
import type { KubejojoRelationDomain, KubejojoRelationType } from "../engine/relations";

export type TopologyViewState = "default" | "focused" | "context" | "muted";

export type TopologyNodeStatus = "healthy" | "warning" | "critical" | "unknown";

export interface TopologyRendererResource {
  id?: string;
  name?: string;
  kind?: string;
  namespace?: string | null;
  source?: string;
  status?: TopologyNodeStatus;
  summary?: string;
  detailLines?: string[];
  tags?: string[];
  warnings?: string[];
  aggregation?: {
    memberCount?: number;
    membersByKind?: Record<string, number>;
    semanticKey?: Record<string, string>;
  };
}

/**
 * This mirrors the graph node emitted by the ELK graph adapter. Both `nodes`
 * and `children` are accepted while the adapter migration is in progress.
 */
export interface TopologyRendererGraphNode {
  id: string;
  label?: string;
  subtitle?: string;
  resource?: TopologyRendererResource;
  nodes?: TopologyRendererGraphNode[];
  children?: TopologyRendererGraphNode[];
  collapsed?: boolean;
  // Kept for persisted/legacy layouts. The current grouping implementation
  // no longer emits an isolated aggregate.
  groupKind?: "scope" | "component" | "isolated";
  data?: Record<string, unknown>;
}

export interface TopologyRendererNodeData extends Record<string, unknown> {
  graphNode: TopologyRendererGraphNode;
  viewState?: TopologyViewState;
}

export interface TopologyElkPoint {
  x: number;
  y: number;
}

export interface TopologyElkSection {
  startPoint: TopologyElkPoint;
  endPoint: TopologyElkPoint;
  bendPoints?: TopologyElkPoint[];
}

export interface TopologyRendererEdgeData extends Record<string, unknown> {
  sections?: TopologyElkSection[];
  parentOffset?: TopologyElkPoint;
  viewState?: TopologyViewState;
  label?: string;
  count?: number;
  relationIds?: string[];
  role?: "owner" | "network" | "storage" | "config" | "policy" | "gateway" | "scope";
  relationType?: KubejojoRelationType;
  relationDomain?: KubejojoRelationDomain;
  stroke?: string;
  dashed?: boolean;
  confidence?: number;
  status?: TopologyNodeStatus;
  ports?: string[];
  evidence?: string[];
  route?: "elk" | "bridge";
  bridgeLabel?: string;
}

export type TopologyRendererNode = Node<TopologyRendererNodeData>;
export type TopologyRendererEdge = Edge<TopologyRendererEdgeData>;
