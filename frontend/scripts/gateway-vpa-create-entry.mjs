import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.CREATE_ENTRY_QA_URL || "http://127.0.0.1:3000";
const clusterId = "create-entry-extended-cluster";
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || "chrome" });
const writes = [];
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("aiops_auth_access", "create-entry-extended-fixture");
    localStorage.setItem("aiops_auth_user", "Create Entry Extended QA");
    localStorage.setItem("aiops_auth_role", "admin");
    localStorage.setItem("aiops_auth_expires_at", "2030-01-01T00:00:00Z");
  });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      if (request.method() === "POST" && path === "/api/resources/discovery/refresh") return route.fulfill({ json: { data: { refreshed: false } } });
      writes.push(`${request.method()} ${path}`);
      return route.abort();
    }
    const ok = data => route.fulfill({ json: { data } });
    if (path === "/api/v1/auth/me") return ok({ user: { username: "Create Entry Extended QA", role: "admin" }, expiresAt: "2030-01-01T00:00:00Z" });
    if (path === "/api/clusters") return ok({ items: [{ id: clusterId, name: "Extended Entry Cluster", state: "active", hasKubeconfig: true }], total: 1 });
    if (path === `/api/clusters/${clusterId}`) return ok({ id: clusterId, name: "Extended Entry Cluster", state: "active", hasKubeconfig: true });
    if (path === "/api/namespaces") return ok({ items: [{ id: "prod", namespace: "prod", clusterId }], total: 1 });
    if (path === "/api/autoscaling/policies") return ok({ items: [], total: 0, overview: { totalPolicies: 0, hpaPolicies: 0, vpaPolicies: 0, coveredWorkloads: 0, uncoveredWorkloads: 0 } });
    if (path === "/api/resources/editor/schema") return ok({ schema: null, source: "unavailable" });
    if (path === "/api/capabilities" || path === "/api/ai-assistant/sessions") return ok([]);
    if (path === "/api/system/update/status") return ok({ updateAvailable: false });
    if (path.endsWith("/events/stream")) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
    if (path.startsWith("/api/users/preferences/table/")) return ok(null);
    return ok({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  const cases = [
    { url: `/clusters/${clusterId}/network/gateway-api?kind=gatewayclass`, kind: "GatewayClass", form: true, apiVersion: "gateway.networking.k8s.io/v1", resource: "gatewayclasses" },
    { url: `/clusters/${clusterId}/network/gateway-api?kind=backendtlspolicy`, kind: "BackendTLSPolicy", form: false, apiVersion: "gateway.networking.k8s.io/v1alpha3", resource: "backendtlspolicies" },
    { url: `/clusters/${clusterId}/workloads/autoscaling/vpa?namespace=prod`, kind: "VerticalPodAutoscaler", form: true },
  ];
  for (const entry of cases) {
    if (process.env.CREATE_ENTRY_QA_KIND && entry.kind !== process.env.CREATE_ENTRY_QA_KIND) continue;
    await page.goto(`${origin}${entry.url}`, { waitUntil: "domcontentloaded" });
    console.log(`Checking ${entry.kind}: ${page.url()}`);
    const form = page.locator('.resource-add-button:visible').filter({ hasText: /^创建$/ });
    if (entry.form) {
      try { await form.waitFor(); } catch (error) { throw new Error(`${entry.kind}: ${await page.locator("body").innerText()}`, { cause: error }); }
      await form.click();
      await page.waitForURL("**/resources/editor?**");
      const params = new URL(page.url()).searchParams;
      assert.equal(params.get("kind"), entry.kind);
      assert.equal(params.get("clusterId"), clusterId);
      assert.equal(params.get("mode"), "form");
      assert.equal(params.get("returnTo"), entry.url);
      if (entry.apiVersion) assert.equal(params.get("apiVersion"), entry.apiVersion);
      if (entry.resource) assert.equal(params.get("resource"), entry.resource);
      await page.getByRole("tab", { name: "表单", exact: true }).waitFor();
      await page.goBack();
    } else {
      assert.equal(await form.count(), 0, `${entry.kind} must remain YAML-only without a supported schema`);
      await page.locator('.resource-add-button:visible').filter({ hasText: "YAML 创建" }).waitFor();
    }
    await page.locator('.resource-add-button:visible').filter({ hasText: "YAML 创建" }).click();
    await page.waitForURL("**/resources/editor?**");
    const yamlParams = new URL(page.url()).searchParams;
    assert.equal(yamlParams.get("kind"), entry.kind);
    assert.equal(yamlParams.get("mode"), "yaml");
    assert.equal(yamlParams.get("clusterId"), clusterId);
    assert.equal(yamlParams.get("returnTo"), entry.url);
    if (entry.apiVersion) assert.equal(yamlParams.get("apiVersion"), entry.apiVersion);
    if (entry.resource) assert.equal(yamlParams.get("resource"), entry.resource);
  }
  assert.deepEqual(writes, [], "entry validation must never submit resources");
  assert.deepEqual(errors, [], "production pages must render without runtime errors");
  console.log("PASS gateway/VPA create entries");
  await context.close();
} finally {
  await browser.close();
}
