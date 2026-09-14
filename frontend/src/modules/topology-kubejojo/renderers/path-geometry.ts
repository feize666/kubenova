import type { TopologyElkPoint, TopologyElkSection } from "./contracts";

const EPSILON = 0.5;
const CORNER_RADIUS = 18;

function samePoint(left: TopologyElkPoint, right: TopologyElkPoint): boolean {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
}

function offsetPoint(point: TopologyElkPoint, offset: TopologyElkPoint): TopologyElkPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function compactPoints(points: TopologyElkPoint[]): TopologyElkPoint[] {
  return points.reduce<TopologyElkPoint[]>((result, point) => {
    if (!result.length || !samePoint(result[result.length - 1], point)) result.push(point);
    return result;
  }, []);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatPoint(value: TopologyElkPoint): string {
  return `${formatNumber(value.x)},${formatNumber(value.y)}`;
}

function distance(left: TopologyElkPoint, right: TopologyElkPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function isOrthogonal(left: TopologyElkPoint, right: TopologyElkPoint): boolean {
  return Math.abs(left.x - right.x) < EPSILON || Math.abs(left.y - right.y) < EPSILON;
}

function autoRoute(start: TopologyElkPoint, end: TopologyElkPoint): TopologyElkPoint[] {
  if (isOrthogonal(start, end)) return [start, end];
  const direction = end.x >= start.x ? 1 : -1;
  const gap = Math.abs(end.x - start.x);
  const midpoint = start.x + direction * Math.max(32, gap / 2);
  const safeMidpoint = direction > 0
    ? Math.min(end.x - 32, midpoint)
    : Math.max(end.x + 32, midpoint);
  return [start, { x: safeMidpoint, y: start.y }, { x: safeMidpoint, y: end.y }, end];
}

function sectionPoints(section: TopologyElkSection, offset: TopologyElkPoint): TopologyElkPoint[] {
  const start = offsetPoint(section.startPoint, offset);
  const end = offsetPoint(section.endPoint, offset);
  const bends = compactPoints((section.bendPoints ?? []).map((point) => offsetPoint(point, offset)));
  const points = compactPoints([start, ...bends, end]);
  if (points.length < 2) return [];
  if (points.every((point, index) => index === 0 || isOrthogonal(points[index - 1], point))) return points;
  return autoRoute(start, end);
}

function cubicSegment(from: TopologyElkPoint, to: TopologyElkPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const controlOffset = dx * 0.48;
    return `C ${formatPoint({ x: from.x + controlOffset, y: from.y })} ${formatPoint({ x: to.x - controlOffset, y: to.y })} ${formatPoint(to)}`;
  }
  const controlOffset = dy * 0.48;
  return `C ${formatPoint({ x: from.x, y: from.y + controlOffset })} ${formatPoint({ x: to.x, y: to.y - controlOffset })} ${formatPoint(to)}`;
}

function towards(from: TopologyElkPoint, to: TopologyElkPoint, amount: number): TopologyElkPoint {
  const length = distance(from, to);
  if (length <= amount || length === 0) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * amount,
    y: from.y + ((to.y - from.y) / length) * amount,
  };
}

function buildSectionPath(points: TopologyElkPoint[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${formatPoint(points[0])}`;
  const commands = [`M ${formatPoint(points[0])}`];
  let current = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!next) {
      commands.push(cubicSegment(current, point));
      break;
    }
    const radius = Math.min(CORNER_RADIUS, distance(points[index - 1], point) / 2, distance(point, next) / 2);
    const entry = towards(point, points[index - 1], radius);
    const exit = towards(point, next, radius);
    commands.push(cubicSegment(current, entry));
    // A short cubic turn keeps the route smooth while preserving Dagre's
    // horizontal/vertical waypoints and preventing edges from crossing cards.
    commands.push(`C ${formatPoint(point)} ${formatPoint(point)} ${formatPoint(exit)}`);
    current = exit;
  }
  return commands.join(" ");
}

export function buildOrthogonalRelationshipPath(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
): string {
  let previousEnd: TopologyElkPoint | undefined;
  return sections.map((section) => {
    const points = sectionPoints(section, offset);
    if (!points.length) return "";
    const startsNewSubpath = !previousEnd || !samePoint(previousEnd, points[0]);
    previousEnd = points[points.length - 1];
    const path = buildSectionPath(points);
    return startsNewSubpath ? path : path.replace(/^M\s+[^ ]+/, "");
  }).filter(Boolean).join(" ");
}

export const buildBezierRelationshipPath = buildOrthogonalRelationshipPath;

export function orthogonalPathMidpoint(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
): TopologyElkPoint {
  const points = sections.flatMap((section) => sectionPoints(section, offset));
  if (points.length < 2) return offset;
  const totalLength = points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
  if (totalLength === 0) return points[0];
  let remaining = totalLength / 2;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const length = distance(start, points[index]);
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length;
      return { x: start.x + (points[index].x - start.x) * ratio, y: start.y + (points[index].y - start.y) * ratio };
    }
    remaining -= length;
  }
  return points.at(-1) ?? offset;
}

// Compatibility aliases for callers that still use the previous renderer API.
export const buildSmoothElkRelationshipPath = buildOrthogonalRelationshipPath;
export const smoothElkPathMidpoint = orthogonalPathMidpoint;
export const bezierPathMidpoint = orthogonalPathMidpoint;
