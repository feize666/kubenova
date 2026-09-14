"use client";

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import type {
  TopologyNodeStatus,
  TopologyRendererEdgeData,
  TopologyViewState,
} from "./contracts";
import { buildBezierRelationshipPath, bezierPathMidpoint } from "./path-geometry";

const MAIN_RELATION_TYPES = new Set([
  "OWNS",
  "PUBLISHES",
  "RESOLVES",
  "ROUTES_TO",
  "MOUNTS",
  "BINDS",
]);

export type TopologyEdgeLayer = "main" | "overlay";

export function topologyEdgeLayer(
  relationType: TopologyRendererEdgeData["relationType"],
  dashed = false,
): TopologyEdgeLayer {
  if (relationType) return MAIN_RELATION_TYPES.has(relationType) ? "main" : "overlay";
  return dashed ? "overlay" : "main";
}

function edgeStyle(
  viewState: TopologyViewState | undefined,
  stroke: string | undefined,
  dashed: boolean | undefined,
  confidence: number | undefined,
  layer: TopologyEdgeLayer,
  status: TopologyNodeStatus | undefined,
) {
  const neutralStroke = "var(--tk-edge)";
  const statusStroke: Record<TopologyNodeStatus, string> = {
    healthy: "var(--tk-success)",
    warning: "var(--tk-warning)",
    critical: "var(--tk-danger)",
    unknown: neutralStroke,
  };
  const typedStroke = status ? statusStroke[status] : stroke ?? neutralStroke;
  const confidenceOpacity = typeof confidence === "number" ? Math.max(0.35, Math.min(1, confidence)) : 1;
  const base = {
    strokeDasharray: viewState === "focused"
      ? (layer === "main" ? "9 6" : "4 5")
      : layer === "overlay" ? (dashed ? "4 5" : "2 5") : dashed ? "6 4" : undefined,
  };
  switch (viewState) {
    case "focused":
      return {
        ...base,
        stroke: typedStroke,
        strokeWidth: layer === "main" ? 2.2 : 1.5,
        opacity: (layer === "main" ? 0.98 : 0.82) * confidenceOpacity,
      };
    case "context":
      return {
        ...base,
        stroke: typedStroke,
        strokeWidth: layer === "main" ? 1.35 : 0.9,
        opacity: (layer === "main" ? 0.5 : 0.24) * confidenceOpacity,
      };
    case "muted":
      return {
        ...base,
        stroke: neutralStroke,
        strokeWidth: layer === "main" ? 1 : 0.8,
        opacity: (layer === "main" ? 0.1 : 0.05) * confidenceOpacity,
      };
    default:
      return {
        ...base,
        stroke: typedStroke,
        strokeWidth: layer === "main" ? 1.55 : 0.95,
        opacity: (layer === "main" ? 0.74 : 0.24) * confidenceOpacity,
      };
  }
}

function EdgeRenderer({
  id,
  data,
}: EdgeProps<Edge<TopologyRendererEdgeData>>) {
  const edgeData = data;
  const sections = edgeData?.sections ?? [];
  if (!sections.length) return null;

  const offset = edgeData?.parentOffset ?? { x: 0, y: 0 };
  const path = buildBezierRelationshipPath(sections, offset);
  const layer = topologyEdgeLayer(edgeData?.relationType, edgeData?.dashed);
  const viewState = edgeData?.viewState ?? "default";
  const status = edgeData?.status ?? "unknown";
  const style = edgeStyle(viewState, edgeData?.stroke, edgeData?.dashed, edgeData?.confidence, layer, status);
  const labelPosition = edgeData?.labelPosition ?? bezierPathMidpoint(sections, offset);
  const showLabel = Boolean(edgeData?.label && (edgeData.labelVisible || edgeData.viewState === "focused"));
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        className={`topology-kubejojo__edge-path is-${layer} is-${viewState} is-status-${status} is-domain-${edgeData?.relationDomain ?? "scope"}`}
        style={style}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <span
            className={`topology-kubejojo__edge-label is-${layer} is-status-${status} nodrag nopan`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
            }}
          >
            {edgeData?.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const TopologyEdge = memo(EdgeRenderer);
