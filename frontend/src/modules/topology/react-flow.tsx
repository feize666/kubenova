"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type EdgeTypes,
  type NodeTypes,
} from "reactflow";
import type { TopologyRelationRole, TopologyView, TopologyViewNode } from "./contract";
import { layoutTopologyGraph } from "./layout";

export interface TopologyFlowNodeData<TData = unknown> {
  topology: TopologyViewNode<TData>;
  focused?: boolean;
  onSelect?: (nodeId: string) => void;
}

export interface TopologyFlowEdgeData {
  role: TopologyRelationRole;
  count: number;
}

export type TopologyFlowNode<TData = unknown> = Node<TopologyFlowNodeData<TData>, "topologyResource">;
export type TopologyFlowEdge = Edge<TopologyFlowEdgeData>;

export interface CreateTopologyFlowOptions {
  focusedNodeId?: string | null;
  onSelect?: (nodeId: string) => void;
}

const STATUS_COLORS = {
  healthy: "#15803d",
  warning: "#c26a00",
  critical: "#dc2626",
  unknown: "#7c8794",
} as const;

const ROLE_COLORS: Record<TopologyRelationRole, string> = {
  owner: "#2563eb",
  selector: "#0891b2",
  network: "#20bfd1",
  storage: "#15803d",
  configuration: "#0891b2",
  gateway: "#c26a00",
  scope: "#7c8794",
  related: "#a3adba",
};

function getNodeColor(node: TopologyViewNode) {
  return STATUS_COLORS[node.status];
}

function TopologyResourceNodeBase({ id, data, selected }: NodeProps<TopologyFlowNodeData>) {
  const { topology, focused, onSelect } = data;
  const isGroup = topology.type === "group";
  const color = getNodeColor(topology);
  return (
    <button
      type="button"
      aria-label={`${topology.label}, ${topology.status}`}
      onClick={() => onSelect?.(id)}
      style={{
        width: "100%",
        minHeight: 72,
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        border: `1px solid ${selected || focused ? color : "var(--map-border, #334155)"}`,
        borderRadius: 4,
        background: isGroup ? "var(--map-card-bg-soft, #172033)" : "var(--map-card-bg, #101820)",
        color: "var(--ops-text, #e5edf7)",
        boxShadow: selected || focused ? `0 0 0 1px ${color}` : "none",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "1px solid var(--map-canvas-bg, #0b1120)" }} />
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{topology.label}</strong>
        <small style={{ color: "var(--ops-text-muted, #9fb0c5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
          {topology.subtitle ?? topology.resource?.kind ?? "Resource"}
        </small>
      </span>
      {isGroup ? <span style={{ color, fontSize: 12, fontWeight: 700 }}>{topology.hiddenChildCount ?? 0}</span> : <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />}
      <Handle type="source" position={Position.Right} style={{ background: color, border: "1px solid var(--map-canvas-bg, #0b1120)" }} />
    </button>
  );
}

function TopologyRelationEdgeBase({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<TopologyFlowEdgeData>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const color = ROLE_COLORS[data?.role ?? "related"];
  const label = data && data.count > 1 ? String(data.count) : null;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: data?.count && data.count > 1 ? 2.2 : 1.5 }} />
      {label ? (
        <EdgeLabelRenderer>
          <span
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              padding: "1px 5px",
              border: "1px solid var(--map-border, #334155)",
              borderRadius: 3,
              background: "var(--map-card-bg, #101820)",
              color,
              fontSize: 10,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const topologyNodeTypes: NodeTypes = {
  topologyResource: memo(TopologyResourceNodeBase),
};

export const topologyEdgeTypes: EdgeTypes = {
  topologyRelation: memo(TopologyRelationEdgeBase),
};

export function createTopologyFlow<TNodeData, TRelationData>(
  view: TopologyView<TNodeData, TRelationData>,
  options: CreateTopologyFlowOptions = {},
) {
  const positions = layoutTopologyGraph(
    view.nodes.map((node) => ({ id: node.id })),
    view.relations.map((relation) => ({ id: relation.id, source: relation.source, target: relation.target })),
  );
  const nodes: TopologyFlowNode<TNodeData>[] = view.nodes.map((topology) => ({
    id: topology.id,
    type: "topologyResource",
    position: positions.get(topology.id) ?? { x: 0, y: 0 },
    data: {
      topology,
      focused: topology.id === options.focusedNodeId || Boolean(topology.resource && view.focusedResourceIds.includes(topology.resource.id)),
      onSelect: options.onSelect,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
  const edges: TopologyFlowEdge[] = view.relations.map((relation) => ({
    id: relation.id,
    source: relation.source,
    target: relation.target,
    type: "topologyRelation",
    data: { role: relation.role, count: relation.count },
  }));
  return { nodes, edges, nodeTypes: topologyNodeTypes, edgeTypes: topologyEdgeTypes };
}
