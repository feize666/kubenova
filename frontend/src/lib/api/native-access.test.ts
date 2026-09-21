import assert from "node:assert/strict";
import test from "node:test";
import {
  getNativeAccessSettings,
  reconcileNativeAccess,
  saveNativeAccessSettings,
} from "./native-access";

test("native access administration keeps the selected cluster and revision on every request", async (t) => {
  const requests: Array<{ url: string; method: string; body: unknown; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(JSON.stringify({ data: { clusterId: "cluster/a", revision: 3 } }), {
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const settings = {
    enabled: false,
    issuer: "https://sso.example.test/realms/ops",
    audience: "kubenova-kubectl",
    jwksUri: "https://sso.example.test/realms/ops/certs",
    gatewayUrl: "https://gateway.example.test/native",
    revision: 2,
  };
  await getNativeAccessSettings("cluster/a", "session");
  await saveNativeAccessSettings("cluster/a", settings, "session");
  await reconcileNativeAccess("cluster/a", "session");

  assert.deepEqual(requests.map((request) => [request.url, request.method, request.authorization]), [
    ["/api/users/native-access/cluster%2Fa", "GET", "Bearer session"],
    ["/api/users/native-access/cluster%2Fa", "PUT", "Bearer session"],
    ["/api/users/native-access/cluster%2Fa/reconcile", "POST", "Bearer session"],
  ]);
  assert.deepEqual(requests[1].body, settings);
});
