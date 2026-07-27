#!/usr/bin/env node

import assert from "node:assert/strict";

const CAPACITY_LIMITS = Object.freeze({
  backend: Object.freeze({ nodes: 10_000, edges: 30_000 }),
  expansion: Object.freeze({ nodes: 1_500, edges: 5_000 }),
  defaultCanvas: Object.freeze({ nodes: 600, edges: 2_000 }),
  neighborhood: Object.freeze({ nodes: 300, edges: 1_000 }),
});

function buildSyntheticGraph(nodeCount, edgeCount = nodeCount * 3) {
  assert(
    Number.isInteger(nodeCount) && nodeCount > 31,
    "nodeCount must be an integer greater than 31",
  );
  assert(
    Number.isInteger(edgeCount) && edgeCount >= 0,
    "edgeCount must be a non-negative integer",
  );
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${String(index).padStart(5, "0")}`,
    namespace: `namespace-${index % 20}`,
    kind: index % 5 === 0 ? "Service" : "Pod",
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => {
    const sourceIndex = index % nodeCount;
    const lane = Math.floor(index / nodeCount);
    const offset = ((lane * 13 + 1) % (nodeCount - 1)) + 1;
    return {
      id: `edge-${String(index).padStart(6, "0")}`,
      source: nodes[sourceIndex].id,
      target: nodes[(sourceIndex + offset) % nodeCount].id,
    };
  });
  return { nodes, edges };
}

function graphCounts(graph) {
  return { nodes: graph.nodes.length, edges: graph.edges.length };
}

function assertWithinLimit(graph, limit, label) {
  const actual = graphCounts(graph);
  if (actual.nodes > limit.nodes || actual.edges > limit.edges) {
    throw new RangeError(
      `${label} capacity exceeded: nodes=${actual.nodes}/${limit.nodes}, edges=${actual.edges}/${limit.edges}`,
    );
  }
  return actual;
}

function semanticKey(node, fields) {
  if (!fields.length) return "cluster=all";
  return fields.map((field) => `${field}=${node[field] || (field === "namespace" ? "_cluster" : "Unknown")}`).join("|");
}

function countByKind(nodes) {
  return nodes.reduce((counts, node) => {
    const kind = node.kind || "Unknown";
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
}

function projectSemanticGraph(graph, fields) {
  const groups = new Map();
  [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id, "en")).forEach((node) => {
    const key = semanticKey(node, fields);
    groups.set(key, [...(groups.get(key) || []), node]);
  });
  const nodeByMember = new Map();
  const nodes = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, members]) => {
    const id = `capacity:resource:${fields.join("-") || "cluster"}:${encodeURIComponent(key)}`;
    members.forEach((member) => nodeByMember.set(member.id, id));
    return { id, kind: "Aggregate", memberCount: members.length, membersByKind: countByKind(members) };
  });
  const relations = new Map();
  [...graph.edges].sort((left, right) => left.id.localeCompare(right.id, "en")).forEach((edge) => {
    const source = nodeByMember.get(edge.source);
    const target = nodeByMember.get(edge.target);
    const key = `${source}->${target}`;
    const existing = relations.get(key);
    if (existing) existing.memberCount += 1;
    else relations.set(key, {
      id: `capacity:relation:${fields.join("-") || "cluster"}:${encodeURIComponent(key)}`,
      source,
      target,
      memberCount: 1,
    });
  });
  return { nodes, edges: [...relations.values()].sort((left, right) => left.id.localeCompare(right.id, "en")) };
}

function aggregateGraph(graph, limit, label) {
  const original = graphCounts(graph);
  if (original.nodes <= limit.nodes && original.edges <= limit.edges) {
    return { mode: "full", graph, original };
  }

  const levels = [["namespace", "kind"], ["namespace"], ["kind"], []];
  const graphProjection = levels
    .map((fields) => ({ fields, graph: projectSemanticGraph(graph, fields) }))
    .find((candidate) => candidate.graph.nodes.length <= limit.nodes && candidate.graph.edges.length <= limit.edges);
  assert(graphProjection, `${label} must fit after semantic aggregation`);

  const result = {
    mode: "aggregated",
    strategy: "semantic-aggregation",
    level: graphProjection.fields.join("-") || "cluster",
    original,
    graph: graphProjection.graph,
  };
  assertWithinLimit(result.graph, limit, `${label} aggregated result`);
  assert.equal(
    result.graph.nodes.reduce((total, node) => total + node.memberCount, 0),
    original.nodes,
    `${label} aggregation must account for every input node`,
  );
  assert.equal(
    result.graph.edges.reduce((total, edge) => total + edge.memberCount, 0),
    original.edges,
    `${label} aggregation must account for every input edge`,
  );
  return result;
}

function expectExplicitRejection(graph, limit, label) {
  assert.throws(
    () => assertWithinLimit(graph, limit, label),
    (error) =>
      error instanceof RangeError &&
      error.message.includes(`nodes=${graph.nodes.length}/${limit.nodes}`) &&
      error.message.includes(`edges=${graph.edges.length}/${limit.edges}`),
    `${label} must report actual and allowed counts`,
  );
}

function validateFixture(nodeCount) {
  const graph = buildSyntheticGraph(nodeCount);
  const repeated = buildSyntheticGraph(nodeCount);
  assert.deepEqual(
    graph,
    repeated,
    `${nodeCount}-node fixture must be deterministic`,
  );
  assert.equal(
    new Set(graph.nodes.map((node) => node.id)).size,
    nodeCount,
    "node ids must be unique",
  );
  assert.equal(
    new Set(graph.edges.map((edge) => edge.id)).size,
    nodeCount * 3,
    "edge ids must be unique",
  );
  assertWithinLimit(graph, CAPACITY_LIMITS.backend, "backend graph");
  return graph;
}

const fixtures = [1_000, 5_000, 10_000].map(validateFixture);
const largest = fixtures.at(-1);

expectExplicitRejection(
  buildSyntheticGraph(10_001, 30_000),
  CAPACITY_LIMITS.backend,
  "backend graph",
);
expectExplicitRejection(
  buildSyntheticGraph(10_000, 30_001),
  CAPACITY_LIMITS.backend,
  "backend graph",
);
expectExplicitRejection(
  largest,
  CAPACITY_LIMITS.expansion,
  "frontend expansion",
);

for (const [label, limit] of [
  ["default canvas", CAPACITY_LIMITS.defaultCanvas],
  ["neighborhood", CAPACITY_LIMITS.neighborhood],
]) {
  const result = aggregateGraph(largest, limit, label);
  assert.equal(
    result.mode,
    "aggregated",
    `${label} must expose aggregation mode`,
  );
  assert.equal(
    result.strategy,
    "semantic-aggregation",
    `${label} must expose its aggregation strategy`,
  );
  assert.deepEqual(result.original, { nodes: 10_000, edges: 30_000 });
}

assertWithinLimit(
  buildSyntheticGraph(300, 1_000),
  CAPACITY_LIMITS.neighborhood,
  "neighborhood boundary",
);
assertWithinLimit(
  buildSyntheticGraph(600, 2_000),
  CAPACITY_LIMITS.defaultCanvas,
  "default canvas boundary",
);
assertWithinLimit(
  buildSyntheticGraph(1_500, 5_000),
  CAPACITY_LIMITS.expansion,
  "frontend expansion boundary",
);

console.log(
  "[topology-v2-capacity] PASS: deterministic 1k/5k/10k fixtures and explicit backend/expansion/canvas/neighborhood limits verified.",
);
