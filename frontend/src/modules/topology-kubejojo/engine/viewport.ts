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
