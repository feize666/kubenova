"use client";

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo, useState } from "react";

import type { TopologyRendererEdgeData, TopologyViewState } from "./contracts";
import { buildRelationshipPath, relationshipPathMidpoint } from "./path-geometry";

const MAIN_RELATION_TYPES = new Set([
  "OWNS",
  "SELECTS",
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
  confidence: number | undefined,
  layer: TopologyEdgeLayer,
) {
  const neutralStroke = "var(--tk-edge)";
  // Headlamp keeps relationship rails neutral; status belongs to the node
  // card and does not turn the graph into a bundle of coloured lines.
  const typedStroke = neutralStroke;
  const confidenceOpacity = typeof confidence === "number" ? Math.max(0.35, Math.min(1, confidence)) : 1;
  const base = { strokeDasharray: undefined };
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
  const [hovered, setHovered] = useState(false);
  const edgeData = data;
  const sections = edgeData?.sections ?? [];
  if (!sections.length) return null;

  const offset = edgeData?.parentOffset ?? { x: 0, y: 0 };
  const path = buildRelationshipPath(sections, offset);
  const layer = topologyEdgeLayer(edgeData?.relationType, edgeData?.dashed);
  const viewState = edgeData?.viewState ?? "default";
  const status = edgeData?.status ?? "unknown";
  const style = edgeStyle(viewState, edgeData?.confidence, layer);
  const labelPosition = edgeData?.labelPosition ?? relationshipPathMidpoint(sections, offset);
  // Labels are a detail affordance, not a second graph layer: keep the canvas
  // quiet until the rail is focused or hovered.
  const showLabel = Boolean(edgeData?.label && (hovered || edgeData.viewState === "focused"));
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={0}
        // Relationship rails are intentionally undirected; direction is carried
        // by the relation label and status, not an arrowhead.
        className={`topology-kubejojo__edge-path is-${layer} is-${viewState} is-status-${status} is-domain-${edgeData?.relationDomain ?? "scope"}`}
        style={style}
      />
      <path
        d={path}
        className="topology-kubejojo__edge-hit-area"
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
