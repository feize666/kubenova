export type TopologyBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TopologyViewportSize = {
  width: number;
  height: number;
};

export type TopologyViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type TopologyViewportOptions = {
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  padding?: number;
};

export type TopologyViewportFrame = {
  size: TopologyViewportSize;
  offsetY: number;
};

/**
 * Height of the canvas chrome that floats over the top edge: the resource path
 * bar and the breadcrumb rail. Framing must reserve it, otherwise fit-view
 * parks the first rank underneath the overlay and the group label disappears
 * behind the breadcrumbs.
 */
export const TOPOLOGY_CHROME_TOP = 56;

/**
 * Reserves the floating chrome so centered graphs cannot slide under it. The
 * usable height shrinks by the chrome height while the offset pushes the graph
 * down by the same amount, keeping equal padding above and below.
 */
export function getTopologyViewportFrame(
  width: number,
  height: number,
  topChrome: number = TOPOLOGY_CHROME_TOP,
): TopologyViewportFrame {
  const safeHeight = Math.max(1, height);
  const reserved = Math.min(Math.max(0, topChrome), Math.max(0, safeHeight - 1));
  return {
    size: { width: Math.max(1, width), height: Math.max(1, safeHeight - reserved) },
    offsetY: reserved,
  };
}

/** Centers the rendered node bounds in the available canvas at a bounded zoom. */
export function getCenteredTopologyViewport(
  bounds: TopologyBounds,
  canvas: TopologyViewportSize,
  options: TopologyViewportOptions = {},
): TopologyViewport | null {
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || bounds.width <= 0
    || bounds.height <= 0
    || canvas.width <= 0
    || canvas.height <= 0
  ) return null;

  const padding = Math.max(0, options.padding ?? 28);
  const minZoom = Math.max(0.01, options.minZoom ?? 0.2);
  const maxZoom = Math.max(minZoom, options.maxZoom ?? 1);
  const availableWidth = Math.max(1, canvas.width - padding * 2);
  const availableHeight = Math.max(1, canvas.height - padding * 2);
  const fittedZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  const requestedZoom = options.zoom ?? fittedZoom;
  const zoom = Math.max(minZoom, Math.min(maxZoom, requestedZoom));

  return {
    x: canvas.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: canvas.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}
