import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCluster } from "./ai-cluster";
import { getGrafanaPanelConfiguration, listObservabilityDataSources, listNotificationTemplates, createNotificationTemplate, updateNotificationTemplate, deleteNotificationTemplate } from "./observability-config";

test("notification requests retain their explicit cluster and never leak it into another scope", async (t) => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ data: { items: [], total: 0 } }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await listNotificationTemplates(undefined, "cluster-a");
  await listNotificationTemplates();
  await createNotificationTemplate({ name: "Ops", channel: "webhook", endpoint: "https://notify.example.test", bodyTemplate: "{}", clusterId: "cluster-a" });
  await updateNotificationTemplate("channel/1", { name: "Ops B" }, undefined, "cluster-b");
  await deleteNotificationTemplate("channel/1", undefined, "cluster-b");
  assert.equal(requests[0].url, "/api/observability/notification-templates?clusterId=cluster-a");
  assert.equal(requests[1].url, "/api/observability/notification-templates");
  assert.equal((requests[2].body as { clusterId: string }).clusterId, "cluster-a");
  assert.equal(requests[3].url, "/api/observability/notification-templates/channel%2F1?clusterId=cluster-b");
  assert.equal(requests[4].url, "/api/observability/notification-templates/channel%2F1?clusterId=cluster-b");
});

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

test("Grafana panel configuration request carries the fixed cluster and range", async (t) => {
  let requestedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      clusterId: "cluster-a",
      available: false,
      status: "unavailable",
      reason: "Grafana 未配置",
      embedUrl: null,
      origin: null,
      dashboardUid: null,
      panelId: null,
      defaultTimeRange: "24h",
      theme: "auto",
      variableMapping: {},
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await getGrafanaPanelConfiguration("cluster-a", "1h");
  assert.equal(requestedUrl, "/api/monitoring/grafana/panels?clusterId=cluster-a&range=1h");
});
