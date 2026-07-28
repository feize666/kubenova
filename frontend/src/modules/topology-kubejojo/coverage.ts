import type {
  TopologyGraphCoverageSource,
  TopologyGraphSource,
} from "../../lib/api/topology-graph";

export function isTopologyCoverageIncomplete(source: TopologyGraphCoverageSource): boolean {
  if (source.status === "partial" || source.status === "unavailable") return true;
  if (source.status === "stale") return source.records <= 0;
  return false;
}

export function getIncompleteTopologySources(
  sources: Record<TopologyGraphSource, TopologyGraphCoverageSource>,
  selectedSources: Iterable<TopologyGraphSource>,
): TopologyGraphSource[] {
  return Array.from(selectedSources).filter((source) =>
    isTopologyCoverageIncomplete(sources[source]),
  );
}
