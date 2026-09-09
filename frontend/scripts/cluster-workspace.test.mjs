import assert from "node:assert/strict";
import test from "node:test";
import { getClusterRouteScope } from "../src/lib/cluster-workspace.ts";

test("workspace path fixes the cluster and wins over a legacy query parameter", () => {
  assert.deepEqual(
    getClusterRouteScope("/clusters/ack-prod/workloads/pods", new URLSearchParams("clusterId=other")),
    { clusterId: "ack-prod", isFixed: true },
  );
});

test("legacy clusterId query keeps old resource pages scoped to one cluster", () => {
  assert.deepEqual(
    getClusterRouteScope("/workloads/pods", new URLSearchParams("clusterId=ack-prod")),
    { clusterId: "ack-prod", isFixed: true },
  );
});

test("unscoped pages preserve the global cluster selector", () => {
  assert.deepEqual(getClusterRouteScope("/workloads/pods", new URLSearchParams()), {
    clusterId: "",
    isFixed: false,
  });
});
