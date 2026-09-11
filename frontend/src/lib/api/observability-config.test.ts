import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCluster } from "./ai-cluster";
import { listObservabilityDataSources } from "./observability-config";

test("cluster analysis is scoped to the requested cluster", async (t) => {
  let requestedUrl = "";
  let requestedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ clusterId: "cluster-a", response: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await analyzeCluster("cluster-a", { runtimeStatus: "running" });

  assert.equal(requestedUrl, "/api/clusters/cluster-a/ai/analyze");
  assert.deepEqual(JSON.parse(requestedBody), { evidence: { runtimeStatus: "running" } });
});

test("data source list carries the optional cluster scope", async (t) => {
  let requestedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ items: [], total: 0, timestamp: new Date().toISOString() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await listObservabilityDataSources("cluster-a");
  assert.equal(requestedUrl, "/api/observability/data-sources?clusterId=cluster-a");
});
