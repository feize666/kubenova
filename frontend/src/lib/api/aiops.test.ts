import assert from "node:assert/strict";
import test from "node:test";
import { getAiopsSummary } from "./aiops";

test("AIOps summary request includes the fixed workspace cluster", async (t) => {
  let requestedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await getAiopsSummary({ range: "1h", clusterId: "cluster-a" });

  assert.equal(requestedUrl, "/api/aiops/summary?range=1h&clusterId=cluster-a");
});
