import assert from "node:assert/strict";
import test from "node:test";
import { queryLogCenter, listLogCenterSources, eligibleLogSources, canQueryLogCenter, logQueryWindow } from "./log-center";
import type { LogCenterSource } from "./log-center";

test("only enabled Elasticsearch sources bound to the exact cluster are selectable", () => {
  const source: LogCenterSource = { id: "a", name: "Logs", clusterId: "c", enabled: true, kind: "elasticsearch" };
  assert.deepEqual(eligibleLogSources([source, { ...source, id: "global", clusterId: "" }, { ...source, id: "other", clusterId: "other" }, { ...source, id: "disabled", enabled: false }, { ...source, id: "kibana", kind: "kibana" }], "c").map((item) => item.id), ["a"]);
});

test("only administrators can query without an explicit namespace", () => {
  assert.equal(canQueryLogCenter("admin"), true);
  assert.equal(canQueryLogCenter("platform-admin"), true);
  for (const role of ["", "viewer", "operator", "cluster-admin"]) assert.equal(canQueryLogCenter(role), false);
  for (const role of ["viewer", "operator", "cluster-admin"]) assert.equal(canQueryLogCenter(role, "apps"), true);
  assert.equal(canQueryLogCenter("viewer", "   "), false);
});

test("source discovery uses the reader endpoint and preserves cancellation", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  const items = [{ id: "es", name: "Logs", clusterId: "c/a", kind: "elasticsearch", enabled: true }];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "/api/log-center/sources?clusterId=c%2Fa");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer session");
    return new Response(JSON.stringify({ data: { items } }), { headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await listLogCenterSources("c/a", "session", controller.signal), { items });
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const pending = listLogCenterSources("c/a", "session", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("source discovery denial is not disguised as an unconfigured cluster", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  await assert.rejects(listLogCenterSources("c", "session"), { status: 403 });
});

test("relative ranges produce timezone-qualified intervals no longer than 24 hours", () => {
  const now = new Date("2026-09-16T00:00:00Z");
  assert.deepEqual(logQueryWindow("15m", now), { from: "2026-09-15T23:45:00.000Z", to: "2026-09-16T00:00:00.000Z" });
  assert.equal(logQueryWindow("24h", now).from, "2026-09-15T00:00:00.000Z");
});

test("query sends scoped plain text and bounded rows and unwraps the API envelope", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = { clusterId: "c", dataSourceId: "es", namespace: "prod", keyword: "foo AND *", from: "2026-09-15T23:00:00Z", to: "2026-09-16T00:00:00Z", limit: 100 };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "/api/log-center/query");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer session");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return new Response(JSON.stringify({ data: { rows: [] } }), { headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await queryLogCenter(input, "session"), { rows: [] });
});

test("query errors remain errors rather than empty successful results", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
  await assert.rejects(queryLogCenter({ clusterId: "c", dataSourceId: "es", from: "2026-09-15T23:00:00Z", to: "2026-09-16T00:00:00Z" }), /unavailable/);
});

test("context cancellation reaches the transport and rejects the obsolete query", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const result = queryLogCenter({ clusterId: "c", dataSourceId: "es", from: "2026-09-15T23:00:00Z", to: "2026-09-16T00:00:00Z" }, "session", controller.signal);
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
});
