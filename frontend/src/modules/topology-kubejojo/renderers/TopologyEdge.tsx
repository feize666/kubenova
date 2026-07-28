"use client";

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import type { TopologyElkPoint, TopologyElkSection, TopologyRendererEdgeData, TopologyViewState } from "./contracts";

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

function sectionPoints(section: TopologyElkSection, offset: TopologyElkPoint): TopologyElkPoint[] {
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((item) => ({
    x: item.x + offset.x,
    y: item.y + offset.y,
  }));
}

function buildElkPath(sections: TopologyElkSection[], offset: TopologyElkPoint): string {
  return sections.map((section) => {
    const [start, ...rest] = sectionPoints(section, offset);
    return `M ${start.x},${start.y} ${rest.map((item) => `L ${item.x},${item.y}`).join(" ")}`;
  }).join(" ");
}

function distance(left: TopologyElkPoint, right: TopologyElkPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pathMidpoint(sections: TopologyElkSection[], offset: TopologyElkPoint): TopologyElkPoint {
  const segments = sections.flatMap((section) => {
    const points = sectionPoints(section, offset);
    return points.slice(1).map((end, index) => ({ start: points[index], end, length: distance(points[index], end) }));
  });
  const totalLength = segments.reduce((total, segment) => total + segment.length, 0);
  if (!segments.length || totalLength === 0) {
    const fallback = sectionPoints(sections[0], offset);
    return fallback[0] ?? offset;
  }

  let remaining = totalLength / 2;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const progress = segment.length ? remaining / segment.length : 0;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * progress,
        y: segment.start.y + (segment.end.y - segment.start.y) * progress,
      };
    }
    remaining -= segment.length;
  }
  return segments[segments.length - 1].end;
}

function edgeStyle(
  viewState: TopologyViewState | undefined,
  stroke: string | undefined,
  dashed: boolean | undefined,
  confidence: number | undefined,
  layer: TopologyEdgeLayer,
) {
  const neutralStroke = "var(--tk-edge)";
  const typedStroke = stroke ?? neutralStroke;
  const confidenceOpacity = typeof confidence === "number" ? Math.max(0.35, Math.min(1, confidence)) : 1;
  const base = {
    strokeDasharray: layer === "overlay" ? (dashed ? "4 5" : "2 5") : dashed ? "6 4" : undefined,
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
        stroke: neutralStroke,
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
        stroke: neutralStroke,
        strokeWidth: layer === "main" ? 1.55 : 0.95,
        opacity: (layer === "main" ? 0.74 : 0.24) * confidenceOpacity,
      };
  }
}

function EdgeRenderer({
  id,
  data,
  markerEnd,
}: EdgeProps<Edge<TopologyRendererEdgeData>>) {
  const edgeData = data;
  const sections = edgeData?.sections ?? [];
  if (!sections.length) return null;

  const offset = edgeData?.parentOffset ?? { x: 0, y: 0 };
  const path = buildElkPath(sections, offset);
  const layer = topologyEdgeLayer(edgeData?.relationType, edgeData?.dashed);
  const viewState = edgeData?.viewState ?? "default";
  const style = edgeStyle(viewState, edgeData?.stroke, edgeData?.dashed, edgeData?.confidence, layer);
  const labelPosition = pathMidpoint(sections, offset);
  const showLabel = Boolean(edgeData?.label && edgeData.viewState === "focused");
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={`topology-kubejojo__edge-path is-${layer} is-${viewState} is-domain-${edgeData?.relationDomain ?? "scope"}`}
        style={style}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <span
            className={`topology-kubejojo__edge-label is-${layer} nodrag nopan`}
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
