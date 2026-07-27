"use client";

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import type { TopologyElkPoint, TopologyElkSection, TopologyRendererEdgeData, TopologyViewState } from "./contracts";

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
) {
  const neutralStroke = "var(--tk-edge)";
  const typedStroke = stroke ?? neutralStroke;
  const confidenceOpacity = typeof confidence === "number" ? Math.max(0.35, Math.min(1, confidence)) : 1;
  const base = { strokeDasharray: dashed ? "6 4" : undefined };
  switch (viewState) {
    case "focused":
      return { ...base, stroke: typedStroke, strokeWidth: 1.8, opacity: 0.96 * confidenceOpacity };
    case "context":
      return { ...base, stroke: neutralStroke, strokeWidth: 1.3, opacity: 0.56 * confidenceOpacity };
    case "muted":
      return { ...base, stroke: neutralStroke, strokeWidth: 1.05, opacity: 0.12 * confidenceOpacity };
    default:
      return { ...base, stroke: neutralStroke, strokeWidth: 1.15, opacity: 0.42 * confidenceOpacity };
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
  const style = edgeStyle(edgeData?.viewState, edgeData?.stroke, edgeData?.dashed, edgeData?.confidence);
  const labelPosition = pathMidpoint(sections, offset);
  const showLabel = Boolean(edgeData?.label && edgeData.viewState === "focused");
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className="topology-kubejojo__edge-path"
        style={style}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <span
            className="topology-kubejojo__edge-label nodrag nopan"
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
