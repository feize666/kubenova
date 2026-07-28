import {
  TOPOLOGY_GRAPH_V2_LIMITS,
  enforceTopologyGraphV2Capacity,
} from './topology-graph.capacity';

interface SyntheticNode {
  id: string;
}

interface SyntheticRelation {
  id: string;
  source: string;
  target: string;
}

interface SyntheticGraph {
  nodes: SyntheticNode[];
  relations: SyntheticRelation[];
}

function buildSyntheticGraph(nodeCount: number): SyntheticGraph {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index.toString().padStart(5, '0')}`,
  }));
  const relations = nodes.flatMap((node, index) =>
    [1, 7, 31].map((offset, lane) => ({
      id: `relation-${lane}-${index.toString().padStart(5, '0')}`,
      source: node.id,
      target: nodes[(index + offset) % nodeCount].id,
    })),
  );
  return { nodes, relations };
}

describe('Topology Graph V2 capacity contract', () => {
  it('freezes the complete single-cluster graph limit', () => {
    expect(TOPOLOGY_GRAPH_V2_LIMITS).toEqual({
      nodes: 10_000,
      relations: 30_000,
    });
  });

  it.each([1_000, 5_000, 10_000])(
    'accepts a deterministic %i-node graph at three relations per node',
    (nodeCount) => {
      const graph = buildSyntheticGraph(nodeCount);
      const repeated = buildSyntheticGraph(nodeCount);

      expect(graph).toEqual(repeated);
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(nodeCount);
      expect(new Set(graph.relations.map((relation) => relation.id)).size).toBe(
        nodeCount * 3,
      );
      expect(() =>
        enforceTopologyGraphV2Capacity({
          nodes: graph.nodes.length,
          relations: graph.relations.length,
        }),
      ).not.toThrow();
    },
  );

  it.each([
    { nodes: 10_001, relations: 30_000, expected: '10001', limit: '10000' },
    { nodes: 10_000, relations: 30_001, expected: '30001', limit: '30000' },
  ])(
    'rejects an over-limit graph explicitly instead of silently truncating it',
    ({ nodes, relations, expected, limit }) => {
      let error: unknown;

      try {
        enforceTopologyGraphV2Capacity({ nodes, relations });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).toContain(limit);
    },
  );
});
