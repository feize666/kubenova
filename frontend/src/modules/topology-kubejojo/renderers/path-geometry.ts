import type { TopologyElkPoint, TopologyElkSection } from "./contracts";

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

type RelationshipCurve = {
  startPoint: TopologyElkPoint;
  controlPointA: TopologyElkPoint;
  controlPointB: TopologyElkPoint;
  endPoint: TopologyElkPoint;
};

function toCurve(section: TopologyElkSection, offset: TopologyElkPoint): RelationshipCurve {
  const startPoint = offsetPoint(section.startPoint, offset);
  const endPoint = offsetPoint(section.endPoint, offset);
  const bends = (section.bendPoints ?? []).map((point) => offsetPoint(point, offset));

  // Match Headlamp: use the first two ELK control points for one cubic.
  // Extra label-routing points do not imply an obstacle or a separate rail.
  if (bends.length >= 2) {
    return {
      startPoint,
      controlPointA: bends[0],
      controlPointB: bends[1],
      endPoint,
    };
  }

  // Single bend point: split into two symmetric cubic curves for smooth turn.
  if (bends.length === 1) {
    const mid = bends[0];
    const t = 0.42;
    return {
      startPoint,
      controlPointA: {
        x: startPoint.x + (mid.x - startPoint.x) * t * 1.4,
        y: startPoint.y + (mid.y - startPoint.y) * t * 1.4,
      },
      controlPointB: {
        x: endPoint.x - (endPoint.x - mid.x) * t * 1.4,
        y: endPoint.y - (endPoint.y - mid.y) * t * 1.4,
      },
      endPoint,
    };
  }

  // No bend points: compute control points that create a natural
  // horizontal-departure, horizontal-arrival cubic Bézier.
  // Mirrors Headlamp's calm rail aesthetic — curves leave and arrive
  // horizontally so rails never cut through unrelated cards.
  const dx = endPoint.x - startPoint.x;
  const absDx = Math.abs(dx);
  const dy = endPoint.y - startPoint.y;
  const absDy = Math.abs(dy);

  // Horizontal weight: pull control points outward horizontally.
  // For vertical-dominant edges (e.g. same-column connections), reduce
  // the horizontal pull so the curve stays near the nodes.
  const isVertical = absDy > absDx * 2;
  const horizontalWeight = isVertical
    ? Math.min(absDx * 0.25, 32)
    : Math.min(absDx / 3, 140);

  // Vertical offset: for purely vertical edges, add a slight lateral sway
  // so the curve is visible and doesn't overlap the straight line.
  const verticalSway = isVertical ? Math.min(absDy * 0.12, 28) : 0;

  return {
    startPoint,
    controlPointA: {
      x: startPoint.x + horizontalWeight,
      y: startPoint.y + verticalSway,
    },
    controlPointB: {
      x: endPoint.x - horizontalWeight,
      y: endPoint.y - verticalSway,
    },
    endPoint,
  };
}

function cubicCommand(curve: RelationshipCurve): string {
  return `C ${formatPoint(curve.controlPointA)} ${formatPoint(curve.controlPointB)} ${formatPoint(curve.endPoint)}`;
}

export function buildRelationshipPath(
  sections: TopologyElkSection[],
  offset: TopologyElkPoint,
): string {
  let previousEnd: TopologyElkPoint | undefined;
  const commands: string[] = [];
  sections.forEach((section) => {
    const curve = toCurve(section, offset);
    if (!previousEnd || !samePoint(previousEnd, curve.startPoint)) commands.push(`M ${formatPoint(curve.startPoint)}`);
    commands.push(cubicCommand(curve));
    previousEnd = curve.endPoint;
  });
  return commands.join(" ");
}

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

export const buildBezierRelationshipPath = buildRelationshipPath;
export const buildOrthogonalRelationshipPath = buildRelationshipPath;
export const buildSmoothElkRelationshipPath = buildRelationshipPath;
export const bezierPathMidpoint = relationshipPathMidpoint;
export const orthogonalPathMidpoint = relationshipPathMidpoint;
export const smoothElkPathMidpoint = relationshipPathMidpoint;
