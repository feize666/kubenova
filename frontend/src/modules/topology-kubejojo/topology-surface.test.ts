import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { build, stop } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

const pageSource = readFileSync(new URL("../../app/network/topology/page.tsx", import.meta.url), "utf8");
const topologyCss = readFileSync(new URL("../../app/topology-kubejojo.css", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("./engine/index.ts", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const clusterWorkspaceSource = readFileSync(new URL("../../components/cluster-workspace-shell.tsx", import.meta.url), "utf8");

declare global {
  interface Window {
    topologyFixture: { pushes: string[]; replacements: string[] };
  }
}

const fixtureTime = "2026-10-11T00:00:00Z";
const sourceKeys = ["workloads", "network", "storage", "configuration"];
const resource = (id: string, kind: string, name: string, source: string, namespace = "prod") => ({
  id, recordId: `record-${id}`, source, clusterId: "c1", namespace, kind, name,
  status: "healthy", instanceName: namespace === "prod" ? "web-instance" : "dev-instance",
  nodeName: "worker-a", summary: kind, detailLines: [], tags: [], warnings: 0,
  identity: { clusterId: "c1", uid: `uid-${id}`, apiVersion: "v1", resourceVersion: "1", namespace, kind, name },
  identityKey: `c1:uid:${id}`, observedAt: fixtureTime,
});
const fixtureResources = [
  resource("deployment", "Deployment", "web", "workloads"),
  resource("replicaset", "ReplicaSet", "web-rs", "workloads"),
  resource("pod", "Pod", "web-pod", "workloads"),
  resource("service", "Service", "web", "network"),
  resource("endpoints", "Endpoints", "web", "network"),
  resource("config", "ConfigMap", "settings", "configuration"),
  resource("dev-pod", "Pod", "dev-pod", "workloads", "dev"),
  resource("dev-service", "Service", "dev", "network", "dev"),
];
const relation = (source: string, target: string, type: string, role: string) => ({
  id: `${type}:${source}->${target}`, source, target, type, role, label: type,
  direction: "outbound", evidence: [], evidenceDetails: [], confidence: 1, ports: [], portDetails: [],
});
const fixtureRelations = [
  relation("deployment", "replicaset", "OWNS", "owner"),
  relation("replicaset", "pod", "OWNS", "owner"),
  relation("service", "pod", "SELECTS", "network"),
  relation("service", "endpoints", "PUBLISHES", "network"),
  relation("dev-service", "dev-pod", "SELECTS", "network"),
];
let browser: Browser;
let bundleScript: string;
let bundleCss: string;

before(async () => {
  // Only environment boundaries and unopened editor/runtime surfaces are doubled.
  // The page, namespace control, canvas, ELK layout and detail drawer stay real.
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {ClusterWorkspaceProvider} from '@/components/cluster-workspace-context';
        import NetworkTopologyPage from '@/app/network/topology/page';
        import '@/app/globals.css';
        import '@/app/topology-panorama.css';
        import '@xyflow/react/dist/style.css';
        import '@/app/topology-kubejojo.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        createRoot(document.getElementById('root')).render(
          <QueryClientProvider client={client}><ClusterWorkspaceProvider clusterId="c1">
            <NetworkTopologyPage/>
          </ClusterWorkspaceProvider></QueryClientProvider>);`,
      resolveDir: new URL(".", import.meta.url).pathname,
      loader: "tsx",
    },
    plugins: [{ name: "topology-fixture-boundaries", setup(builder) {
      builder.onResolve({ filter: /(?:auth-context|next\/navigation|pod-runtime-overlay|resource-yaml-drawer|workload-access)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        contents: args.path === "next/navigation"
          ? `const params=new URLSearchParams();
             const router={push:href=>window.topologyFixture.pushes.push(href),replace:href=>window.topologyFixture.replacements.push(href)};
             export const useRouter=()=>router;export const useSearchParams=()=>params;
             export const usePathname=()=>'/clusters/c1/network/topology';`
          : args.path.endsWith("auth-context")
            ? `export const useAuth=()=>({role:'admin',accessToken:'fixture-token',username:'test',isInitializing:false});`
            : args.path.endsWith("pod-runtime-overlay")
              ? "export const PodRuntimeOverlay=()=>null;"
              : args.path.endsWith("workload-access")
                ? "export const WorkloadAccess=()=>null;"
                : "export const ResourceYamlDrawer=()=>null;",
        loader: "js",
      }));
    }}],
    define: { "process.env.NEXT_PUBLIC_CONTROL_API_BASE": '""', "process.env.NODE_ENV": '"test"' },
    bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "tmp/topology-surface-browser.js",
  });
  bundleScript = bundle.outputFiles!.find(file => file.path.endsWith(".js"))!.text;
  bundleCss = bundle.outputFiles!.find(file => file.path.endsWith(".css"))?.text ?? "";
  // The fixture only bundles once. Release esbuild's service before starting
  // browser workers so its process does not outlive the suite.
  stop();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.RESOURCE_BROWSER_CHANNEL || "chrome",
    args: ["--disable-dev-shm-usage"],
  });
});

after(async () => { await browser?.close(); });

async function withTopology(
  run: (page: Page, requests: URL[], browserDiagnostics: { errors: string[]; failedRequests: string[]; consoleErrors: string[] }) => Promise<void>,
  resourcesFixture = fixtureResources,
  relationsFixture = fixtureRelations,
  graphRefreshDelayMs = 0,
  graphRefreshFailure = false,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference", serviceWorkers: "block" });
  await context.routeWebSocket("**/*", socket => socket.close());
  const page = await context.newPage();
  // ELK worker startup and parallel browser suites can be slower on hosted CI.
  // Keep the assertions identical while allowing the real page to settle.
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  const requests: URL[] = [];
  const violations: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  let graphRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", request => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "topology-fixture.local" || request.method() !== "GET") {
      violations.push(`${request.method()} ${url}`);
      return route.abort();
    }
    if (request.resourceType() === "document") return route.fulfill({
      contentType: "text/html", body: '<html data-theme="dark"><body style="margin:0"><div id="root" style="height:100vh"></div></body></html>',
    });
    if (url.pathname === "/vendor/elk-worker.min.js") return route.fulfill({
      contentType: "text/javascript", body: readFileSync(new URL("../../../public/vendor/elk-worker.min.js", import.meta.url), "utf8"),
    });
    requests.push(url);
    if (request.headers().authorization !== "Bearer fixture-token") {
      violations.push(`unauthenticated ${url}`);
      return route.abort();
    }
    let data: unknown;
    if (url.pathname === "/api/clusters") data = { items: [{ id: "c1", name: "Fixture", state: "active" }], total: 1 };
    else if (url.pathname === "/api/cluster-health") data = { items: [], total: 0 };
    else if (url.pathname === "/api/topology/summary/namespaces") data = {
      items: ["prod", "dev"].map(namespace => ({ clusterId: "c1", namespace, resourceCounts: {}, statusCounts: {}, gatewayCount: 0, networkCount: 0, workloadCount: 0, podCount: 0, abnormalCount: 0, updatedAt: fixtureTime })), timestamp: fixtureTime,
    };
    else if (url.pathname === "/api/topology/graph/v2") {
      graphRequests += 1;
      if (graphRequests > 1 && graphRefreshFailure) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "fixture refresh unavailable" }) });
      }
      if (graphRequests > 1 && graphRefreshDelayMs) await new Promise(resolve => setTimeout(resolve, graphRefreshDelayMs));
      const sources = url.searchParams.get("sources")!.split(",");
      const namespace = url.searchParams.get("namespace");
      const resources = resourcesFixture.filter(item => sources.includes(item.source) && (!namespace || item.namespace === namespace));
      const ids = new Set(resources.map(item => item.id));
      data = {
        schemaVersion: "2.0", revision: "fixture-1", generatedAt: fixtureTime, dataAsOf: fixtureTime, timestamp: fixtureTime,
        freshness: { status: "fresh", observedAt: fixtureTime, ageMs: 0, staleAfterMs: 30000 },
        resources, relations: relationsFixture.filter(item => ids.has(item.source) && ids.has(item.target)),
        coverage: { warningRecords: 0, sources: Object.fromEntries(sourceKeys.map(source => [source, {
          records: resources.filter(item => item.source === source).length, complete: true, status: "complete", lastSuccessfulAt: fixtureTime, reason: null,
        }])) },
      };
    } else if (url.pathname.startsWith("/api/resources/") && url.pathname.endsWith("/detail")) {
      const [, , , kind, ...parts] = decodeURIComponent(url.pathname).split("/");
      const name = parts.at(-2)!;
      const item = resourcesFixture.find(item => item.kind.toLowerCase() === kind && item.name === name);
      if (!item) { violations.push(`unknown detail ${url}`); return route.abort(); }
      data = {
        descriptor: { resourceKind: item.kind, sections: ["overview", "metadata", "associations", "events"], capabilities: { rawSpec: true, rawStatus: true, relationships: true }, fieldsBySection: {} },
        overview: { id: `c1/${item.namespace}/${item.name}`, kind: item.kind, name: item.name, clusterId: "c1", namespace: item.namespace, state: "active", createdAt: fixtureTime, updatedAt: fixtureTime },
        rawSpec: {}, rawStatus: {}, runtime: { replicas: 1, readyReplicas: 1, containerDetails: [] },
        metadata: { labels: {}, annotations: {}, ownerReferences: [], configUsages: [] },
        associations: [], relationships: [], events: { items: [], status: "empty" }, network: {}, storage: {}, generatedAt: fixtureTime,
      };
    } else { violations.push(`unexpected ${url}`); return route.abort(); }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  try {
    await page.goto("http://topology-fixture.local/clusters/c1/network/topology");
    await page.evaluate(() => { window.topologyFixture = { pushes: [], replacements: [] }; });
    await page.addStyleTag({ content: bundleCss });
    await page.addScriptTag({ content: bundleScript });
    await page.getByRole("button", { name: /^命名空间 prod，/ }).waitFor();
    await run(page, requests, { errors, failedRequests, consoleErrors });
    assert.deepEqual(errors, [], "real components must not throw browser errors");
    assert.deepEqual(violations, [], "fixture must not reach live services or permit writes");
  } finally { await context.close(); }
}

async function enterProd(page: Page) {
  await page.getByRole("button", { name: /^命名空间 prod，/ }).click();
  await page.getByRole("navigation", { name: "拓扑层级" }).waitFor();
}

async function expandResources(page: Page) {
  await enterProd(page);
  await page.getByRole("button", { name: /^关联组件 web，/ }).click();
  await page.getByRole("link", { name: "web-pod", exact: true }).waitFor();
}

test("entering a namespace keeps the full workbench canvas and exposes its focus path", async () => {
  assert.match(topologyCss, /\.resource-map-shell--workbench\s*\{[^}]*display:\s*flex/);
  await withTopology(async page => {
    await enterProd(page);
    assert.equal(await page.locator(".resource-map-shell--workbench .is-focused-scene").count(), 1);
    assert.equal(await page.getByRole("navigation", { name: "拓扑层级" }).getByText("prod", { exact: true }).count(), 1);
    const canvas = await page.locator(".topology-kubejojo__canvas").boundingBox();
    assert.ok(canvas && canvas.width > 1000 && canvas.height > 500, "focus must retain the usable canvas");
    const overlays = await page.locator('[aria-label="拓扑层级"]').boundingBox();
    const cards = await page.locator(".topology-kubejojo__node").evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    assert.ok(overlays && cards.length > 0);
    assert.ok(cards.every(card => card.y >= overlays.y + overlays.height + 8), "drill-down cards must stay below the breadcrumb hit area");
  });
});

test("topology canvas fills the remaining workbench without a fixed height floor", () => {
  assert.match(
    topologyCss,
    /\.resource-map-shell--workbench \.resource-map-canvas,\s*\.topology-kubejojo,\s*\.topology-kubejojo__canvas\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/,
  );
});

test("topology layout uses horizontal ELK layers for connected Node-Link graphs", () => {
  const layoutSource = readFileSync(new URL("./engine/elk-layout.ts", import.meta.url), "utf8");
  const engineSourceText = readFileSync(new URL("./engine/elk-engine.ts", import.meta.url), "utf8");
  assert.match(topologyCss, /stroke-linecap:\s*round/);
  assert.match(layoutSource, /"elk\.algorithm": "layered"/);
  assert.match(layoutSource, /"elk\.direction": "RIGHT"/);
  assert.match(layoutSource, /"elk\.randomSeed": "1"/);
  assert.match(layoutSource, /"elk\.edgeRouting": "SPLINES"/);
  assert.doesNotMatch(layoutSource, /function alignFlatAccessPath/);
  // Cross-container dependencies are projected onto the owning child so nested
  // relationships remain visible in the Node-Link graph.
  assert.match(layoutSource, /export function containerRelations\(node: KubejojoGraphNode\): ContainerRelation\[\]/);
  assert.match(layoutSource, /function directChildId\(node: KubejojoGraphNode, leafId: string\)/);
  assert.doesNotMatch(layoutSource, /hierarchyHandling/);
  assert.match(layoutSource, /"elk\.algorithm": "rectpacking"/);
  assert.doesNotMatch(engineSource, /dagre/);
  // Layout runs in ELK's worker with the bundled engine as the offline fallback.
  assert.match(engineSourceText, /import ELKWorkerApi from "elkjs\/lib\/elk-api\.js"/);
  assert.match(engineSourceText, /import ELKBundled from "elkjs\/lib\/elk\.bundled\.js"/);
  assert.match(engineSourceText, /export const ELK_WORKER_URL = "\/vendor\/elk-worker\.min\.js"/);
});

test("stack bulk toggle stays in the bottom-left zoom rail and uses the shared expand-all state", () => {
  assert.match(pageSource, /onCollapseAllStacks=\{\(\) => setExpandAll\(false\)\}/);
  const canvasSource = readFileSync(new URL("./TopologyCanvas.tsx", import.meta.url), "utf8");
  assert.match(canvasSource, /className="topology-kubejojo__zoom topology-kubejojo__controls"[\s\S]*topology-kubejojo__collapse-all/);
  assert.match(canvasSource, /expandedStackIds\.has\(id\)/);
  assert.match(canvasSource, /onCollapseAllStacks\?\.\(\)/);
  assert.doesNotMatch(canvasSource, /className="topology-kubejojo__collapse-all"\s*aria-label=/,
    "bulk control must not float separately on the opposite corner");
});

test("bottom-left canvas controls appear only after entering a resource relationship scene", () => {
  const canvasSource = readFileSync(new URL("./TopologyCanvas.tsx", import.meta.url), "utf8");
  assert.match(canvasSource, /isRelationshipScene \? <div className="topology-kubejojo__zoom topology-kubejojo__controls"/);
});

test("topology always refreshes on entry and does not render stale sync banners", () => {
  assert.match(pageSource, /refetchOnMount:\s*"always"/);
  assert.match(pageSource, /refetchOnWindowFocus:\s*true/);
  assert.match(pageSource, /Promise\.all\(\[[\s\S]*?clusterQuery\.refetch\(\),[\s\S]*?namespaceQuery\.refetch\(\),[\s\S]*?graphQuery\.refetch\(\)/);
  assert.doesNotMatch(pageSource, /集群数据同步延迟|集群数据尚未完成最新同步/);
});

test("focused scenes use theme tokens and keep relationship paths visually smooth", () => {
  assert.match(topologyCss, /\.topology-kubejojo\.is-focused-scene/);
  assert.match(topologyCss, /stroke-linecap:\s*round/);
  assert.match(topologyCss, /\[data-theme="dark"\] \.topology-kubejojo/);
  assert.match(topologyCss, /\[data-theme="dark"\] \.topology-kubejojo__node:hover \.topology-kubejojo__node-card/);
  assert.match(topologyCss, /--tk-highlight/);
});

test("group containers stay visually lightweight while retaining their heading", () => {
  assert.match(topologyCss, /\.topology-kubejojo__group\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(topologyCss, /\.topology-kubejojo__group-label\s*\{[\s\S]*?min-height:\s*36px;[\s\S]*?box-shadow:/);
  assert.match(topologyCss, /\.topology-kubejojo__group > \.topology-kubejojo__node-glance\s*\{\s*top:\s*42px/);
  assert.match(topologyCss, /\.topology-kubejojo__group > \.topology-kubejojo__group-label\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?opacity:\s*0;/);
  assert.match(topologyCss, /\.topology-kubejojo__group:has\(\.topology-kubejojo__node:hover\) > \.topology-kubejojo__group-label/);
});

test("topology controls stay on one desktop row and wrap without horizontal overflow on mobile", async () => {
  await withTopology(async page => {
    const toolbar = page.getByRole("toolbar", { name: "拓扑控制栏" });
    const desktop = await toolbar.evaluate(element => {
      const center = [...element.children].map(child => {
        const rect = child.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      return { display: getComputedStyle(element).display, center };
    });
    assert.equal(desktop.display, "flex");
    assert.ok(Math.max(...desktop.center) - Math.min(...desktop.center) < 3, `desktop controls should share one row: ${JSON.stringify(desktop)}`);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await toolbar.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      rows: new Set([...element.children].map(child => Math.round(child.getBoundingClientRect().top))).size,
    }));
    assert.ok(mobile.rows > 1, "mobile toolbar should wrap into multiple rows");
    assert.ok(mobile.scrollWidth <= mobile.clientWidth + 1, "mobile controls must not create horizontal overflow");
  });
});

test("one resource-card click opens the shared detail drawer by stable identity without resizing the canvas", async () => {
  await withTopology(async (page, requests) => {
    await expandResources(page);
    const canvas = page.locator(".topology-kubejojo__canvas");
    const before = await canvas.boundingBox();
    await Promise.all([
      page.waitForResponse(response => decodeURIComponent(new URL(response.url()).pathname) === "/api/resources/service/c1/prod/web/detail" && response.status() === 200),
      page.getByRole("button", { name: /^Service web，/ }).locator(".topology-kubejojo__node-kind").click(),
    ]);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").locator(".ant-drawer-title").filter({ hasText: /Service.*web/ }).waitFor();
    assert.ok(requests.some(url => decodeURIComponent(url.pathname) === "/api/resources/service/c1/prod/web/detail"));
    const after = await canvas.boundingBox();
    assert.ok(before && after && after.width === before.width, "details overlay must retain the full canvas width");
    // Lazy AntD styles can shift font metrics by a fractional pixel, not a row.
    assert.ok(Math.abs(after.height - before.height) <= 4, "details must not consume a selection-strip row");
    assert.equal(await page.locator(".topology-selection-strip").count(), 0);
    assert.equal(await page.getByRole("button", { name: /^Service web，/, pressed: true }).count(), 1);
  });
});

test("resource summaries appear only while hovering their card", async () => {
  await withTopology(async page => {
    await expandResources(page);
    await page.mouse.move(0, 0);
    const card = page.getByRole("button", { name: /^Service web，/ });
    const summary = card.locator(".topology-kubejojo__node-glance");
    await summary.waitFor({ state: "hidden" });
    await card.hover();
    await summary.waitFor({ state: "visible" });
    await page.mouse.move(0, 0);
    await summary.waitFor({ state: "hidden" });
  });
});

test("initial topology shows namespace aggregates without requiring a workload entry", async () => {
  await withTopology(async page => {
    assert.equal(await page.getByText(/快照/).count(), 0, "normal topology must not describe live data as a snapshot");
    assert.equal(await page.locator(".resource-map-header__stats .anticon-clock-circle").count(), 0, "normal topology does not show a snapshot timestamp");
    assert.equal(await page.getByRole("button", { name: /^命名空间 prod，5 个资源，4 条关系/ }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /^命名空间 dev，2 个资源，1 条关系/ }).count(), 1);
    assert.equal(await page.getByText("选择工作负载查看资源拓扑", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await expandResources(page);
    assert.equal(await page.getByRole("link", { name: "web", exact: true }).count(), 3, "Deployment, Service and Endpoints remain directly available");
    const pod = await page.getByRole("button", { name: /^Pod web-pod，/ }).boundingBox();
    const service = await page.getByRole("button", { name: /^Service web，/ }).boundingBox();
    const endpoints = await page.getByRole("button", { name: /^Endpoints web，/ }).boundingBox();
    assert.ok(pod && service && endpoints, "the Node-Link view must show each resource connected by the topology");
  });
});

test("twenty-Pod overlapping Services retain every Node-Link resource and relationship", async () => {
  const pods = Array.from({ length: 20 }, (_, index) => resource(
    `pod-${String(index).padStart(2, "0")}`,
    "Pod",
    `api-${String(index).padStart(2, "0")}`,
    "workloads",
  ));
  const resources = [
    resource("deployment", "Deployment", "api", "workloads"),
    resource("replicaset", "ReplicaSet", "api-rs", "workloads"),
    ...pods,
    resource("service-a", "Service", "api-primary", "network"),
    resource("service-b", "Service", "api-canary", "network"),
    resource("endpoints-a", "Endpoints", "api-primary", "network"),
    resource("endpoints-b", "EndpointSlice", "api-canary", "network"),
    resource("ingress", "Ingress", "api", "network"),
  ];
  const relations = [
    relation("deployment", "replicaset", "OWNS", "owner"),
    ...pods.map(pod => relation("replicaset", pod.id, "OWNS", "owner")),
    ...pods.flatMap(pod => [
      relation("service-a", pod.id, "SELECTS", "network"),
      relation("service-b", pod.id, "SELECTS", "network"),
    ]),
    relation("service-a", "endpoints-a", "PUBLISHES", "network"),
    relation("service-b", "endpoints-b", "PUBLISHES", "network"),
    relation("ingress", "service-a", "ROUTES_TO", "network"),
  ];

  await withTopology(async page => {
    await enterProd(page);
    await page.getByRole("button", { name: /^关联组件 api，/ }).click();
    await page.getByRole("button", { name: /^Ingress api，/ }).waitFor();
    const podStack = page.getByRole("button", { name: /^资源堆叠 Pod，20 个资源/ });
    await podStack.waitFor();
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-pod").count(), 1,
      "the component scene keeps repeated Pods in one expandable stack");
    assert.equal(await page.locator(".topology-kubejojo__edge-path").count(), 6,
      "the folded graph aggregates repeated relationships instead of drawing a hairball");
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-deployment").count(), 1);
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-replica-set").count(), 1);
    assert.equal(await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-service").count(), 1,
      "related Services remain represented by one stack in the folded component");
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-ingress").count(), 1);
    if (process.env.TOPOLOGY_CAPTURE_SCREENSHOT === "1") {
      await page.screenshot({ path: "output/playwright/topology-dense-fixture.png", fullPage: true });
    }

    await podStack.click();
    await page.getByRole("button", { name: /^Pod api-00，/ }).waitFor();
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-pod").count(), 20,
      "expanding the Pod stack restores each Pod card");
    const podColumns = await page.locator(".react-flow__node:has(.topology-kubejojo__node.is-resource-pod)").evaluateAll(nodes =>
      nodes.map(node => Math.round(node.getBoundingClientRect().x)));
    assert.equal(new Set(podColumns).size, 1, "expanded Pods must remain in one vertical column");
    await page.getByRole("button", { name: "折叠资源堆叠 Pod" }).click();
    await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-pod").waitFor();
    await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-pod").click();
    await page.getByRole("button", { name: /^Pod api-00，/ }).waitFor();
    const serviceStack = page.locator(".topology-kubejojo__node.is-group-stack.is-resource-service");
    await serviceStack.click();
    await page.getByRole("button", { name: /^Service api-primary，/ }).waitFor();
    assert.equal(await page.locator(".topology-kubejojo__group.is-stack").count(), 0,
      "expanded stack frames are removed so edges can connect to resource cards directly");
    assert.equal(await page.locator(".topology-kubejojo__edge-path").count(), 64,
      "expanded relationship fan-out is restored between concrete resources");
    const expandedEdges = await page.locator(".react-flow__edge").evaluateAll(edges => edges.flatMap(edge => {
      const path = edge.querySelector<SVGPathElement>(".topology-kubejojo__edge-path");
      if (!path) return [];
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(path.getTotalLength());
      const chord = Math.hypot(end.x - start.x, end.y - start.y);
      return [{ d: path.getAttribute("d") ?? "", length: path.getTotalLength(), chord }];
    }));
    assert.equal(expandedEdges.length, 64, "every expanded relationship remains rendered");
    assert.ok(expandedEdges.every(edge => edge.d.includes("C")), "all fan-out edges use cubic Bézier paths");
    assert.ok(expandedEdges.some(edge => edge.length > edge.chord + 1),
      "multi-resource relationships visibly curve instead of collapsing into straight rails");
    const bulkToggle = page.getByRole("button", { name: "折叠所有资源堆叠" });
    assert.equal(await page.locator(".topology-kubejojo__zoom").getByRole("button", { name: "折叠所有资源堆叠" }).count(), 1,
      "the fold-all action is positioned in the bottom-left zoom rail");
    await bulkToggle.click();
    await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-pod").waitFor();
    await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-service").waitFor();
    assert.equal(await page.getByRole("button", { name: "展开所有资源堆叠" }).count(), 1,
      "the same action switches to expand-all after folding");
    await page.getByRole("button", { name: "展开所有资源堆叠" }).click();
    await page.getByRole("button", { name: /^Pod api-00，/ }).waitFor();
    await page.getByRole("button", { name: /^Service api-primary，/ }).waitFor();
    const crossings = await page.locator(".react-flow__edge").evaluateAll(edges => {
      const cards = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => ({
        id: node.dataset.id ?? "",
        rect: node.getBoundingClientRect(),
      }));
      const result: Array<{ edge: string; node: string }> = [];
      edges.forEach(edge => {
        const path = edge.querySelector<SVGPathElement>(".topology-kubejojo__edge-path");
        const matrix = path?.getScreenCTM();
        const length = path?.getTotalLength() ?? 0;
        if (!path || !matrix || length <= 0) return;
        const classes = [...edge.classList];
        const source = classes.find(value => value.startsWith("source-"))?.slice(7) ?? "";
        const target = classes.find(value => value.startsWith("target-"))?.slice(7) ?? "";
        for (let step = 1; step < 20; step += 1) {
          const point = new DOMPoint(path.getPointAtLength(length * step / 20).x, path.getPointAtLength(length * step / 20).y).matrixTransform(matrix);
          const hit = cards.find(card => card.id !== source && card.id !== target
            && point.x > card.rect.left + 2 && point.x < card.rect.right - 2
            && point.y > card.rect.top + 2 && point.y < card.rect.bottom - 2);
          if (hit) { result.push({ edge: edge.className.baseVal, node: hit.id }); break; }
        }
      });
      return result;
    });
    assert.deepEqual(crossings, [], "relationship curves must not pass through unrelated resource cards");
    if (process.env.TOPOLOGY_CAPTURE_SCREENSHOT === "1") {
      await page.screenshot({ path: "output/playwright/topology-dense-expanded-fixture.png", fullPage: true });
    }
    const cards = await page.locator(".topology-kubejojo__node").evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }));
    for (let left = 0; left < cards.length; left += 1) {
      for (let right = left + 1; right < cards.length; right += 1) {
        const a = cards[left];
        const b = cards[right];
        assert.ok(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), "resource cards must not overlap");
      }
    }

    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-pod").count(), 20,
      "the expanded Pod stack remains visible alongside associated resources");
    assert.equal(await page.locator(".topology-kubejojo__node.is-resource-service").count(), 2,
      "the expanded Service stack remains visible alongside associated resources");
    await page.getByRole("button", { name: "折叠所有资源堆叠" }).click();
    await page.locator(".topology-kubejojo__node.is-group-stack.is-resource-pod").waitFor();
    assert.equal(await page.locator('.react-flow__node[data-id="pod-00"]').count(), 0,
      "the bottom-left action folds every expanded stack at once");
  }, resources, relations);
});

test("folded namespace and component cards enter their scene and ancestors return to global", async () => {
  await withTopology(async page => {
    await enterProd(page);
    await page.getByRole("button", { name: /^关联组件 web，/ }).click();
    await page.getByRole("link", { name: "web-pod", exact: true }).waitFor();
    const path = page.getByRole("navigation", { name: "拓扑层级" });
    await path.getByRole("button", { name: "prod", exact: true }).click();
    await page.getByRole("button", { name: /^关联组件 web，/ }).waitFor();
    await path.getByRole("button", { name: "全局", exact: true }).click();
    await page.getByRole("button", { name: /^命名空间 prod，/ }).waitFor();
    assert.equal(await path.count(), 0);
  });
});

test("namespace scope control uses a direct option list instead of a nested select", () => {
  const scopeSource = readFileSync(new URL("../../components/resource-scope-filter-button.tsx", import.meta.url), "utf8");
  const namespaceSource = readFileSync(new URL("../../components/namespace-select.tsx", import.meta.url), "utf8");
  assert.match(scopeSource, /isWorkspaceLocked[\s\S]*<NamespaceSelect/);
  assert.match(namespaceSource, /export function NamespaceFilterSelect/);
  assert.match(namespaceSource, /className="namespace-filter-select__label"/);
  assert.match(namespaceSource, /classNames=\{\{ popup: \{ root: "namespace-filter-select-dropdown"/);
  assert.match(namespaceSource, /showSearch/);
  assert.match(namespaceSource, /全部命名空间/);
  assert.match(globalCss, /\.namespace-filter-select \.ant-select-content,[\s\S]*display:\s*flex\s*!important/);
  assert.match(globalCss, /\.namespace-filter-select \.ant-select-prefix,[\s\S]*height:\s*30px/);
  assert.match(globalCss, /\.namespace-filter-select__label[\s\S]*line-height:\s*21px/);
});

test("topology toolbar namespace search scopes the actual graph request and retains canvas controls", async () => {
  const namespaceSource = readFileSync(new URL("../../components/namespace-select.tsx", import.meta.url), "utf8");
  assert.match(namespaceSource, /filterOption=/);
  assert.match(namespaceSource, /popupMatchSelectWidth/);
  await withTopology(async (page, requests) => {
    const toolbar = page.getByRole("toolbar", { name: "拓扑控制栏" });
    const select = toolbar.getByRole("combobox", { name: "选择命名空间" });
    await select.fill("prod");
    await page.locator(".namespace-filter-select-dropdown .ant-select-item-option").filter({ hasText: /^prod$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".topology-kubejojo__node.is-group-scope").length === 1);
    assert.ok(requests.some(url => url.pathname === "/api/topology/graph/v2" && url.searchParams.get("namespace") === "prod" && url.searchParams.get("clusterId") === "c1"));
    assert.equal(await page.getByRole("button", { name: /^命名空间 dev，/ }).count(), 0);
    assert.equal(await toolbar.getByRole("button", { name: "刷新拓扑" }).count(), 1);
    assert.equal(await page.getByRole("toolbar", { name: "拓扑视图工具栏" }).count(), 0,
      "canvas controls stay hidden on the namespace aggregate view");
    await page.getByRole("button", { name: /^命名空间 prod，/ }).click();
    assert.equal(await page.getByRole("toolbar", { name: "拓扑视图工具栏" }).count(), 0,
      "namespace application summaries must not expose relationship controls");
    await page.getByRole("button", { name: /^关联组件 web，/ }).click();
    await page.getByRole("toolbar", { name: "拓扑视图工具栏" }).getByRole("button", { name: "适配全图", exact: true }).waitFor();
  });
});

test("namespace is the default grouping and instance or node switching rebuilds the aggregates", async () => {
  await withTopology(async page => {
    const groups = page.getByRole("group", { name: "分组方式", exact: true });
    assert.equal(await groups.getByRole("button", { name: "命名空间", exact: true }).getAttribute("aria-pressed"), "true");
    await groups.getByRole("button", { name: "实例", exact: true }).click();
    await page.getByRole("button", { name: /^实例 web-instance，/ }).waitFor();
    assert.equal(await groups.getByRole("button", { name: "实例", exact: true }).getAttribute("aria-pressed"), "true");
    await groups.getByRole("button", { name: "节点", exact: true }).click();
    await page.getByRole("button", { name: /^节点 worker-a，/ }).waitFor();
    assert.equal(await page.getByRole("toolbar", { name: "拓扑控制栏" }).getByRole("button", { name: "适配全图" }).count(), 0);
    await groups.getByRole("button", { name: "命名空间", exact: true }).click();
    await page.getByRole("button", { name: /^命名空间 prod，/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^命名空间 dev，/ }).count(), 1);
  });
});

test("one resource-domain menu filters the graph and cannot deselect its final source", async () => {
  await withTopology(async (page, requests) => {
    await page.getByRole("button", { name: /资源域 4\/4/ }).click();
    const menu = page.getByRole("menu", { name: "资源域筛选" });
    assert.equal(await menu.getByRole("menuitemcheckbox", { checked: true }).count(), 4);
    await menu.getByRole("button", { name: "仅工作负载", exact: true }).click();
    await page.getByRole("button", { name: /资源域 1\/4/ }).waitFor();
    await menu.getByRole("menuitemcheckbox", { name: /工作负载/ }).click();
    assert.equal(await menu.getByRole("menuitemcheckbox", { checked: true }).count(), 1);
    assert.ok(requests.some(url => url.pathname === "/api/topology/graph/v2" && url.searchParams.get("sources") === "workloads"));
    await menu.getByRole("button", { name: "全选", exact: true }).click();
    await page.getByRole("button", { name: /资源域 4\/4/ }).waitFor();
    assert.equal(await menu.getByRole("menuitemcheckbox", { checked: true }).count(), 4);
    await page.getByRole("heading", { name: "资源拓扑", exact: true }).click();
    assert.equal(await menu.count(), 0, "outside click closes the single menu");
  });
});

test("resource-name navigation targets its management list without opening a detail drawer", async () => {
  await withTopology(async page => {
    await expandResources(page);
    await page.locator(".topology-kubejojo__node.is-resource-service").getByRole("link", { name: "web", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.topologyFixture.pushes), ["/clusters/c1/network/services?keyword=web&namespace=prod"]);
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.locator(".topology-kubejojo__node[aria-pressed=true]").count(), 0);
  });
});

test("resource selection animates only related edges, preserves emphasis on drawer close and clears on blank click", async () => {
  await withTopology(async page => {
    await expandResources(page);
    assert.equal(await page.locator(".topology-kubejojo__edge-flow.is-active").count(), 0);
    await page.getByRole("button", { name: /^Service web，/ }).locator(".topology-kubejojo__node-kind").click();
    await page.getByRole("dialog").waitFor();
    await page.locator(".ant-drawer-close").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const flows = page.locator(".topology-kubejojo__edge-flow.is-active");
    assert.equal(await flows.count(), 2, "Service selects Pod and publishes Endpoints, not the owner chain");
    assert.equal(await flows.first().evaluate(element => getComputedStyle(element).display), "block");
    assert.notEqual(await flows.first().evaluate(element => getComputedStyle(element).animationName), "none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => {
      const flow = document.querySelector(".topology-kubejojo__edge-flow.is-active");
      return flow && getComputedStyle(flow).animationName === "none";
    });
    assert.equal(await flows.first().evaluate(element => getComputedStyle(element).animationName), "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(".react-flow__pane").click({ position: { x: 10, y: 10 } });
    assert.equal(await flows.count(), 0);
    assert.equal(await page.locator(".topology-kubejojo__edge-path.is-focused, .topology-kubejojo__node.is-muted, .topology-kubejojo__node[aria-pressed=true]").count(), 0);
  });
});

test("realtime disconnection retains the graph but blocks resource actions until recovery", async () => {
  await withTopology(async page => {
    await expandResources(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("kubenova:realtime-state", { detail: { state: "disconnected" } })));
    await page.getByText("实时连接中断", { exact: true }).waitFor();
    const serviceCard = page.getByRole("button", { name: /^Service web，/ });
    await serviceCard.waitFor({ state: "visible" });
    assert.equal(await serviceCard.count(), 1, "the last graph stays visible");
    await serviceCard.locator(".topology-kubejojo__node-kind").click();
    assert.equal(await page.getByRole("dialog").count(), 0, "stale topology must not open an actionable detail drawer");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("kubenova:realtime-state", { detail: { state: "connected" } })));
    await page.getByText("实时连接中断", { exact: true }).waitFor({ state: "hidden" });
    await serviceCard.locator(".topology-kubejojo__node-kind").click();
    await page.getByRole("dialog").waitFor();
  });
});

test("background topology reconciliation keeps the current graph mounted", async () => {
  await withTopology(async (page, _requests, browserDiagnostics) => {
    const card = page.getByRole("button", { name: /^命名空间 prod，/ });
    await card.waitFor();
    await page.getByRole("button", { name: "刷新拓扑" }).click();
    await page.locator('button[aria-label="刷新拓扑"].is-loading').waitFor();
    const diagnostics: Array<Record<string, unknown>> = [];
    const startedAt = Date.now();
    let settledAt: number | null = null;
    while (settledAt === null || Date.now() - settledAt < 250) {
      diagnostics.push(await page.evaluate(() => ({
        namespaceCards: [...document.querySelectorAll(".topology-kubejojo__node.is-group-scope")]
          .filter(node => node.textContent?.includes("prod")).length,
        flowNodes: document.querySelectorAll(".react-flow__node").length,
        canvasState: document.querySelector(".resource-map-canvas-state")?.textContent?.trim() ?? null,
        layoutError: document.querySelector(".topology-kubejojo__layout-error")?.textContent?.trim() ?? null,
        layoutLoading: document.querySelector(".topology-kubejojo__canvas")?.getAttribute("aria-busy") ?? null,
        refreshLoading: Boolean(document.querySelector('button[aria-label="刷新拓扑"].is-loading')),
      })));
      const stillLoading = await page.locator('button[aria-label="刷新拓扑"].is-loading').count() > 0;
      if (!stillLoading && settledAt === null) settledAt = Date.now();
      if (Date.now() - startedAt > 5_000) break;
      await page.waitForTimeout(20);
    }
    const emptySamples = diagnostics.filter(sample => sample.namespaceCards !== 1 || Number(sample.flowNodes) < 2);
    assert.deepEqual(
      emptySamples,
      [],
      `graph nodes must remain mounted throughout refetch; samples=${JSON.stringify(diagnostics)}; browser=${JSON.stringify(browserDiagnostics)}`,
    );
    assert.equal(
      await card.count(),
      1,
      `refetch must not replace the graph with a loading screen; canvas=${await page.locator(".resource-map-canvas").innerText()}`,
    );
  }, fixtureResources, fixtureRelations, 1000);
});

test("transient topology refresh failure keeps the last graph and disables actions", async () => {
  await withTopology(async page => {
    const card = page.getByRole("button", { name: /^命名空间 prod，/ });
    await card.waitFor();
    await page.getByRole("button", { name: "刷新拓扑" }).click();
    await page.getByText("拓扑后台刷新暂时失败", { exact: true }).waitFor();
    assert.equal(await card.count(), 1, "the last successful graph must remain mounted after a failed refresh");
    assert.equal(await page.getByText("当前画布继续显示最近可用数据，系统会在后台自动重试。", { exact: true }).count(), 1);
    await card.click();
    assert.equal(await page.getByRole("dialog").count(), 0, "stale graph data must not open a mutating detail surface");
  }, fixtureResources, fixtureRelations, 0, true);
});

test("cluster scoped resource pages do not render an empty namespace scope slot", () => {
  const filterSource = readFileSync(new URL("../../components/resource-cluster-namespace-filters.tsx", import.meta.url), "utf8");
  assert.match(filterSource, /const showScopeControl = !workspace \|\| namespaceVisible/);
  assert.match(filterSource, /\{showScopeControl \? \(/);
  assert.match(filterSource, /if \(!showScopeControl && !showKeywordSearch && !extraFilters\) return null/);
});

test("cluster workspace follows the active theme instead of forcing a light sider", () => {
  assert.match(clusterWorkspaceSource, /useThemeMode/);
  assert.match(clusterWorkspaceSource, /theme=\{mode\}/);
  assert.doesNotMatch(clusterWorkspaceSource, /theme="light"/);
  assert.match(globalCss, /\[data-theme="dark"\] \.cluster-workspace-shell__sidebar/);
  assert.match(globalCss, /\.cluster-workspace-menu\.ant-menu-dark/);
});

test("legacy topology chips keep readable dark-theme surfaces", () => {
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-mode-card__chip/);
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-name-trigger/);
  assert.match(globalCss, /\[data-theme="dark"\] \.topology-risk-chip--high/);
});

test("canvas resources keep resource-kind metadata centralized", () => {
  assert.doesNotMatch(pageSource, /KIND_WEIGHT/);
  const toCanvasResource = pageSource.match(
    /function toCanvasResource\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(toCanvasResource, "page must map graph resources onto the canvas");
  // A page-level layout override would make the resource mapper a second source
  // of graph semantics, so the mapper remains free of layout weights.
  assert.doesNotMatch(toCanvasResource, /\bweight\s*:/);
  const graphModelSource = readFileSync(
    new URL("./engine/graph-model.ts", import.meta.url),
    "utf8",
  );
  const weight = (kind: string) => {
    const match = graphModelSource.match(new RegExp(`\\b${kind}:\\s*(\\d+)`));
    assert.ok(match, `${kind} must stay in the Headlamp weight table`);
    return Number(match![1]);
  };
  assert.ok(weight("Deployment") > 0);
  assert.ok(weight("ReplicaSet") > 0);
  assert.ok(weight("Pod") > 0);
  assert.ok(weight("Service") > 0);
  assert.ok(weight("EndpointSlice") > 0);
  assert.ok(weight("Ingress") > 0);
});
