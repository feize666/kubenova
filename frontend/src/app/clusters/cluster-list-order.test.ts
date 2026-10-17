import assert from "node:assert/strict";
import test from "node:test";

import { sortClustersByRuntimeStatus } from "./cluster-list-order";
import type { RuntimeStatus } from "@/lib/api/cluster-health";

type Row = { id: string; name: string; status: RuntimeStatus };

test("clusters are grouped online, checking, offline mode, disabled, then offline", () => {
  const rows: Row[] = [
    { id: "offline-z", name: "zeta", status: "offline" },
    { id: "disabled", name: "alpha", status: "disabled" },
    { id: "mode", name: "local", status: "offline-mode" },
    { id: "checking", name: "beta", status: "checking" },
    { id: "running-z", name: "zeta", status: "running" },
    { id: "offline-a", name: "Alpha", status: "offline" },
    { id: "running-a", name: "alpha", status: "running" },
  ];

  assert.deepEqual(
    sortClustersByRuntimeStatus(rows, row => row.status, row => row.name).map(row => row.id),
    ["running-a", "running-z", "checking", "mode", "disabled", "offline-a", "offline-z"],
  );
});

test("cluster sorting does not mutate the source inventory", () => {
  const rows: Row[] = [
    { id: "offline", name: "beta", status: "offline" },
    { id: "running", name: "alpha", status: "running" },
  ];
  const original = [...rows];

  sortClustersByRuntimeStatus(rows, row => row.status, row => row.name);

  assert.deepEqual(rows, original);
});
