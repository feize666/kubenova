"use client";

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import type {
  TopologyElkPoint,
  TopologyElkSection,
  TopologyNodeStatus,
  TopologyRendererEdgeData,
  TopologyViewState,
} from "./contracts";

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

function pointToward(from: TopologyElkPoint, to: TopologyElkPoint, distanceFromOrigin: number): TopologyElkPoint {
  const length = distance(from, to);
  if (!length) return from;
  const ratio = Math.min(1, distanceFromOrigin / length);
  return {
    x: from.x + ((to.x - from.x) * ratio),
    y: from.y + ((to.y - from.y) * ratio),
  };
}

export function buildRoundedElkPath(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
  radius = 10,
): string {
  return sections.map((section) => {
    const points = sectionPoints(section, offset);
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

    const commands = [`M ${points[0].x},${points[0].y}`];
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const corner = points[index];
      const next = points[index + 1];
      const cornerRadius = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
      const entry = pointToward(corner, previous, cornerRadius);
      const exit = pointToward(corner, next, cornerRadius);
      commands.push(`L ${entry.x},${entry.y}`, `Q ${corner.x},${corner.y} ${exit.x},${exit.y}`);
    }
    const end = points[points.length - 1];
    commands.push(`L ${end.x},${end.y}`);
    return commands.join(" ");
  }).filter(Boolean).join(" ");
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
  markerEnd,
}: EdgeProps<Edge<TopologyRendererEdgeData>>) {
  const edgeData = data;
  const sections = edgeData?.sections ?? [];
  if (!sections.length) return null;

  const offset = edgeData?.parentOffset ?? { x: 0, y: 0 };
  const path = buildRoundedElkPath(sections, offset);
  const layer = topologyEdgeLayer(edgeData?.relationType, edgeData?.dashed);
  const viewState = edgeData?.viewState ?? "default";
  const status = edgeData?.status ?? "unknown";
  const style = edgeStyle(viewState, edgeData?.stroke, edgeData?.dashed, edgeData?.confidence, layer, status);
  const labelPosition = edgeData?.labelPosition ?? pathMidpoint(sections, offset);
  const showLabel = Boolean(edgeData?.label && (edgeData.labelVisible || edgeData.viewState === "focused"));
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
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
