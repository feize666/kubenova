import type { TopologyElkPoint, TopologyElkSection } from "./contracts";

/**
 * Relationship geometry copied from Headlamp's `GraphEdgeComponent`.
 *
 * ELK returns a spline as one start point, two control points and one end
 * point. Headlamp paints exactly that as a single cubic curve, which is what
 * gives the resource map its calm, non-crossing rails: the curve leaves the
 * source horizontally and arrives horizontally, and because the control points
 * come from the layout engine the rail never cuts through an unrelated card.
 */
const EPSILON = 0.5;

function samePoint(left: TopologyElkPoint, right: TopologyElkPoint): boolean {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
}

function offsetPoint(point: TopologyElkPoint, offset: TopologyElkPoint): TopologyElkPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatPoint(value: TopologyElkPoint): string {
  return `${formatNumber(value.x)},${formatNumber(value.y)}`;
}

/** One section with the two control points Headlamp's curve needs. */
type RelationshipCurve = {
  startPoint: TopologyElkPoint;
  controlPointA: TopologyElkPoint;
  controlPointB: TopologyElkPoint;
  endPoint: TopologyElkPoint;
};

/**
 * Reads a section as a cubic curve.
 *
 * ELK's spline routing emits two bend points, which are used verbatim. Any
 * other shape (a straight run, a section clipped by a group boundary) falls
 * back to horizontal control points so the rail still reads as the same curve
 * family instead of switching to a visibly different line style.
 */
function toCurve(section: TopologyElkSection, offset: TopologyElkPoint): RelationshipCurve {
  const startPoint = offsetPoint(section.startPoint, offset);
  const endPoint = offsetPoint(section.endPoint, offset);
  const bends = (section.bendPoints ?? []).map((point) => offsetPoint(point, offset));
  const controlPointA = bends[0] ?? {
    x: startPoint.x + (endPoint.x - startPoint.x) / 3,
    y: startPoint.y,
  };
  const controlPointB = bends[1] ?? {
    x: startPoint.x + ((endPoint.x - startPoint.x) * 2) / 3,
    y: endPoint.y,
  };
  return { startPoint, controlPointA, controlPointB, endPoint };
}

function cubicCommand(curve: RelationshipCurve): string {
  return `C ${formatPoint(curve.controlPointA)} ${formatPoint(curve.controlPointB)} ${formatPoint(curve.endPoint)}`;
}

/**
 * Paints one or more ELK splines as cubic curves.
 *
 * Consecutive sections that share an endpoint are joined without a second
 * `M` command so the rail stays a single continuous stroke.
 */
export function buildRelationshipPath(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
): string {
  let previousEnd: TopologyElkPoint | undefined;
  const commands: string[] = [];
  sections.forEach((section) => {
    const curve = toCurve(section, offset);
    if (!previousEnd || !samePoint(previousEnd, curve.startPoint)) {
      commands.push(`M ${formatPoint(curve.startPoint)}`);
    }
    commands.push(cubicCommand(curve));
    previousEnd = curve.endPoint;
  });
  return commands.join(" ");
}

/**
 * Label anchor of a cubic curve, evaluated at t = 0.5 with the same weights
 * Headlamp uses so the badge sits on the rail instead of beside it.
 */
export function relationshipPathMidpoint(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
): TopologyElkPoint {
  const section = sections[0];
  if (!section) return offset;
  const curve = toCurve(section, offset);
  return {
    x: 0.125 * curve.startPoint.x + 0.375 * curve.controlPointA.x + 0.375 * curve.controlPointB.x + 0.125 * curve.endPoint.x,
    y: 0.125 * curve.startPoint.y + 0.375 * curve.controlPointA.y + 0.375 * curve.controlPointB.y + 0.125 * curve.endPoint.y,
  };
}

// Compatibility aliases for callers that still use the previous renderer API.
export const buildBezierRelationshipPath = buildRelationshipPath;
export const buildOrthogonalRelationshipPath = buildRelationshipPath;
export const buildSmoothElkRelationshipPath = buildRelationshipPath;
export const bezierPathMidpoint = relationshipPathMidpoint;
export const orthogonalPathMidpoint = relationshipPathMidpoint;
export const smoothElkPathMidpoint = relationshipPathMidpoint;
