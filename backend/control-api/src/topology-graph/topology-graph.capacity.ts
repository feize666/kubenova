export const TOPOLOGY_GRAPH_V2_LIMITS = Object.freeze({
  nodes: 10_000,
  relations: 30_000,
});

export function enforceTopologyGraphV2Capacity(input: {
  nodes: number;
  relations: number;
}): void {
  if (
    input.nodes <= TOPOLOGY_GRAPH_V2_LIMITS.nodes &&
    input.relations <= TOPOLOGY_GRAPH_V2_LIMITS.relations
  )
    return;
  throw new RangeError(
    `Topology graph V2 capacity exceeded: nodes=${input.nodes} (limit=${TOPOLOGY_GRAPH_V2_LIMITS.nodes}), relations=${input.relations} (limit=${TOPOLOGY_GRAPH_V2_LIMITS.relations})`,
  );
}
