import assert from "node:assert/strict";
import test from "node:test";

import type {
  TopologyGraphCoverageSource,
  TopologyGraphSource,
} from "../../lib/api/topology-graph.ts";
// @ts-expect-error TypeScript source extensions are only used by the Node test command.
import { getIncompleteTopologySources, isTopologyCoverageIncomplete } from "./coverage.ts";

function coverage(
  status: TopologyGraphCoverageSource["status"],
  records: number,
): TopologyGraphCoverageSource {
  return {
    records,
    complete: status === "complete",
    status,
    lastSuccessfulAt: null,
    reason: null,
  };
}

test("complete coverage is not reported missing even when the result is empty", () => {
  assert.equal(isTopologyCoverageIncomplete(coverage("complete", 0)), false);
});

test("stale coverage with records is handled by freshness instead of coverage", () => {
  assert.equal(isTopologyCoverageIncomplete(coverage("stale", 12)), false);
});

test("stale coverage without records is a real coverage gap", () => {
  assert.equal(isTopologyCoverageIncomplete(coverage("stale", 0)), true);
});

test("partial coverage is reported incomplete", () => {
  assert.equal(isTopologyCoverageIncomplete(coverage("partial", 8)), true);
});

test("unavailable coverage is reported incomplete", () => {
  assert.equal(isTopologyCoverageIncomplete(coverage("unavailable", 0)), true);
});

test("mixed coverage only reports incomplete selected sources", () => {
  const sources: Record<TopologyGraphSource, TopologyGraphCoverageSource> = {
    workloads: coverage("unavailable", 0),
    network: coverage("complete", 4),
    storage: coverage("partial", 2),
    configuration: coverage("stale", 6),
  };

  assert.deepEqual(
    getIncompleteTopologySources(sources, ["network", "storage", "configuration"]),
    ["storage"],
  );
});
