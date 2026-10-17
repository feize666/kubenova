import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Browser-only matrix for non-workload detail drawers. The API boundary is deliberately
// explicit: resource writes are rejected; discovery refresh is isolated as a fixture.
const origin = process.env.DETAIL_QA_URL || "http://127.0.0.1:3000";
const clusterId = "detail-matrix-cluster";
const timestamp = "2026-10-11T00:00:00Z";
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || "chrome" });
const failures = [];
const matrix = [
  { path: "/network/services", kind: "Service", name: "matrix-service", api: "network", routeKind: "Service" },
  { path: "/network/ingress", kind: "Ingress", name: "matrix-ingress", api: "network", routeKind: "Ingress" },
  { path: "/network/endpoints", kind: "Endpoints", name: "matrix-endpoints", api: "network", routeKind: "Endpoints" },
  { path: "/network/endpointslices", kind: "EndpointSlice", name: "matrix-slice", api: "network", routeKind: "EndpointSlice" },
  { path: "/network/networkpolicy", kind: "NetworkPolicy", name: "matrix-policy", api: "network", routeKind: "NetworkPolicy" },
  { path: "/network/ingressclasses", kind: "IngressClass", name: "matrix-class", api: "ingressclass", group: "networking.k8s.io", version: "v1", resource: "ingressclasses", namespaced: false },
  { path: "/network/gateway-api?kind=gatewayclass", kind: "GatewayClass", name: "matrix-gatewayclass", api: "dynamic", group: "gateway.networking.k8s.io", version: "v1", resource: "gatewayclasses", namespaced: false },
  { path: "/network/gateway-api?kind=gateway", kind: "Gateway", name: "matrix-gateway", api: "dynamic", group: "gateway.networking.k8s.io", version: "v1", resource: "gateways" },
  { path: "/network/gateway-api?kind=httproute", kind: "HTTPRoute", name: "matrix-route", api: "dynamic", group: "gateway.networking.k8s.io", version: "v1", resource: "httproutes" },
  ...[
    ['GRPCRoute', 'grpcroutes', 'v1'], ['TCPRoute', 'tcproutes', 'v1alpha2'],
    ['TLSRoute', 'tlsroutes', 'v1alpha2'], ['UDPRoute', 'udproutes', 'v1alpha2'],
    ['ReferenceGrant', 'referencegrants', 'v1beta1'], ['BackendTLSPolicy', 'backendtlspolicies', 'v1alpha3'],
  ].map(([kind, resource, version]) => ({ path: `/network/gateway-api?kind=${kind.toLowerCase()}`, kind, name: `matrix-${resource}`, api: 'dynamic', group: 'gateway.networking.k8s.io', version, resource })),
  { path: "/storage/pv", kind: "PersistentVolume", name: "matrix-pv", api: "storage", routeKind: "PV" },
  { path: "/storage/pvc", kind: "PersistentVolumeClaim", name: "matrix-pvc", api: "storage", routeKind: "PVC" },
  { path: "/storage/sc", kind: "StorageClass", name: "matrix-sc", api: "storage", routeKind: "SC" },
  { path: "/configs/configmaps", kind: "ConfigMap", name: "matrix-config", api: "config" },
  { path: "/configs/secrets", kind: "Secret", name: "matrix-secret", api: "config" },
  { path: "/configs/serviceaccounts", kind: "ServiceAccount", name: "matrix-account", api: "dynamic", group: '', version: 'v1', resource: 'serviceaccounts', storedDetail: true },
  { path: "/configs/limitranges", kind: "LimitRange", name: "matrix-limits", api: "dynamic", group: "", version: "v1", resource: "limitranges" },
  { path: "/configs/resourcequotas", kind: "ResourceQuota", name: "matrix-quota", api: "dynamic", group: "", version: "v1", resource: "resourcequotas" },
  { path: "/namespaces", kind: "Namespace", name: "matrix-ns", api: "namespace" },
  { path: "/nodes", kind: "Node", name: "matrix-node", api: "node" },
  { path: "/workloads/autoscaling/hpa", kind: "HorizontalPodAutoscaler", name: "matrix-hpa", api: "autoscaling" },
  { path: "/workloads/autoscaling/vpa", kind: "VerticalPodAutoscaler", name: "matrix-vpa", api: "autoscaling" },
];

function resource(kind, name, id = `${name}-id`) {
  return { id, clusterId, namespace: "prod", kind, name, state: "active", labels: { app: "detail-matrix" }, spec: {}, statusJson: { phase: "Running" }, createdAt: timestamp, updatedAt: timestamp };
}

function relatedResource(entry) {
  const targets = {
    Service: ['Endpoints', 'service-endpoints'], Ingress: ['Service', 'backend-service'],
    Endpoints: ['Service', 'selects-service'], EndpointSlice: ['Service', 'selects-service'],
    IngressClass: ['Ingress', 'uses-ingressclass'], GatewayClass: ['Gateway', 'uses-gateway-class'],
    Gateway: ['GatewayClass', 'gateway-class'], NetworkPolicy: ['Pod', 'selected-pod'],
    PersistentVolume: ['PersistentVolumeClaim', 'bound-claim'], PersistentVolumeClaim: ['PersistentVolume', 'bound-volume'],
    StorageClass: ['PersistentVolumeClaim', 'uses-storageclass'], ConfigMap: ['Pod', 'used-by'],
    Secret: ['Pod', 'used-by'], ServiceAccount: ['Pod', 'used-by'], Node: ['Pod', 'scheduled-pod'],
    HorizontalPodAutoscaler: ['Deployment', 'scale-target'], VerticalPodAutoscaler: ['Deployment', 'scale-target'],
    Namespace: ['Deployment', 'contains'], LimitRange: ['Pod', 'applies-to'], ResourceQuota: ['Pod', 'applies-to'],
    ReferenceGrant: ['Service', 'backend-ref'], BackendTLSPolicy: ['Service', 'backend-ref'],
  };
  const [kind, associationType] = targets[entry.kind] || ['Service', 'backend-ref'];
  return { ...resource(kind, `related-${entry.kind.toLowerCase()}`), associationType };
}

function detail(item) {
  return {
    descriptor: { resourceKind: item.kind, sections: ["overview", "runtime", "associations", "network", "storage", "metadata", "events"], capabilities: { rawSpec: true, rawStatus: true, relationships: true }, fieldsBySection: {} },
    overview: { ...item }, rawSpec: { selector: { matchLabels: { app: "detail-matrix" } } }, rawStatus: item.statusJson,
    runtime: { replicas: 1, readyReplicas: 1, availableReplicas: 1, phase: "Running", containerDetails: [] },
    metadata: { labels: item.labels, annotations: {}, ownerReferences: [], configUsages: [] }, associations: [], relationships: [],
    events: { items: [], status: "empty" }, network: { clusterIPs: [], podIPs: [], nodeNames: [], endpoints: [] }, storage: {}, generatedAt: timestamp,
  };
}

function dynamicId(row) {
  return ["dynamic", row.clusterId, row.group, row.version, row.resource, row.namespace || "", row.name].join(":");
}

function expectNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function captureDetail(page, drawer, kind, theme) {
  if (!process.env.DETAIL_QA_DIR) return;
  await drawer.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  await page.waitForFunction(() => {
    const content = document.querySelector('.ant-drawer-open .ant-drawer-content-wrapper');
    if (!content) return false;
    const rect = content.getBoundingClientRect();
    return rect.width > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1;
  });
  await mkdir(process.env.DETAIL_QA_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.DETAIL_QA_DIR, `${kind}-${theme}.png`) });
}

const requestedKinds=(process.env.DETAIL_QA_KINDS || process.env.DETAIL_QA_KIND)?.split(',').map(kind=>kind.trim());
if(requestedKinds) assert.ok(requestedKinds.every(kind=>matrix.some(entry=>entry.kind===kind)),'every requested kind must identify a supported resource');
const selectedEntries = requestedKinds ? matrix.filter(entry => requestedKinds.includes(entry.kind)) : matrix;
assert.ok(selectedEntries.length, 'DETAIL_QA_KIND must identify a supported resource');
for (const entry of selectedEntries) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const unexpected = [];
  const writes = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const row = resource(entry.kind, entry.name);
  const related = relatedResource(entry);
  const relatedTarget = { id: ['PersistentVolume', 'StorageClass', 'GatewayClass'].includes(related.kind) ? `${clusterId}//${related.name}` : `${clusterId}/${related.namespace}/${related.name}` };
  const ownerDetail = () => ({ ...detail(row), associations: [{ id: related.id, kind: related.kind, name: related.name, namespace: related.namespace, associationType: related.associationType }] });
  if (entry.namespaced === false || ['node', 'namespace'].includes(entry.api)) row.namespace = '';
  const dynamic = ['dynamic', 'ingressclass'].includes(entry.api) ? { ...row, group: entry.group, version: entry.version, resource: entry.resource, apiVersion: entry.group ? `${entry.group}/${entry.version}` : entry.version, namespaced: entry.namespaced !== false } : null;
  const dynamicDetail = dynamic ? { clusterId, group: dynamic.group, version: dynamic.version, resource: dynamic.resource, kind: entry.kind, namespace: "prod", name: entry.name, yaml: "apiVersion: v1\nkind: " + entry.kind, raw: { apiVersion: dynamic.apiVersion, kind: entry.kind, metadata: { name: entry.name, namespace: "prod" } }, detail: ownerDetail(), timestamp } : null;
  const listPayload = entry.api === "network" ? { items: [row], total: 1, page: 1, pageSize: 25 } : entry.api === "storage" ? { items: [{ ...row, kind: entry.routeKind, capacity: "10Gi", accessModes: ["ReadWriteOnce"], storageClass: "matrix-sc" }], total: 1, page: 1, pageSize: 25 } : entry.api === "namespace" ? { items: [{ id: "matrix-ns-id", clusterId, clusterName: "Detail Matrix", namespace: entry.name, state: "active", labels: {}, createdAt: timestamp, updatedAt: timestamp }], total: 1, page: 1, pageSize: 25, timestamp } : entry.api === "node" ? { items: [{ id: "matrix-node-id", clusterId, name: entry.name, ready: true, roles: ["worker"], version: "v1.31.0", capacity: {}, allocatable: {}, createdAt: timestamp, updatedAt: timestamp }], total: 1, page: 1, pageSize: 25 } : entry.api === "autoscaling" ? { items: [{ id: "matrix-policy-id", type: entry.kind.includes("Horizontal") ? "HPA" : "VPA", state: "active", clusterId, namespace: "prod", workloadKind: "Deployment", workloadName: "matrix-deploy", resourceName: entry.name, workloadId: "matrix-deploy-id", replicas: 1, readyReplicas: 1, config: entry.kind.includes("Horizontal") ? { minReplicas: 1, maxReplicas: 3, targetCpuUtilizationPercentage: 70 } : { updateMode: "Off" }, createdAt: timestamp, updatedAt: timestamp }], total: 1, overview: { totalPolicies: 1, hpaPolicies: entry.kind.includes("Horizontal") ? 1 : 0, vpaPolicies: entry.kind.includes("Vertical") ? 1 : 0, coveredWorkloads: 1, uncoveredWorkloads: 0 } } : { clusterId, group: dynamic?.group || entry.group || "", version: dynamic?.version || entry.version || "v1", resource: dynamic?.resource || entry.resource || "resources", kind: entry.kind, namespaced: true, page: 1, pageSize: 25, total: 1, items: [dynamic], timestamp };

  let detailStatus = 200;
  let listStatus = 200;
  const listReads = [];
  const listRequestUrls = [];
  const mainListPath = entry.api === 'node' ? `/api/clusters/${clusterId}/nodes`
    : {network:'/api/network',storage:'/api/storage',config:'/api/configs',ingressclass:'/api/resources/ingressclasses',autoscaling:'/api/autoscaling/policies',dynamic:'/api/resources/dynamic',namespace:'/api/namespaces'}[entry.api];
  const readList = (route, data) => {
    listReads.push(listStatus);
    listRequestUrls.push(route.request().url());
    const search=new URL(route.request().url()).searchParams.get('keyword');
    const visible=search ? data.items.filter(item=>JSON.stringify(item).toLowerCase().includes(search.toLowerCase())) : data.items;
    const payload=search ? {...data,items:visible,total:visible.length} : data;
    return listStatus === 200 ? route.fulfill({json:{data:payload}}) : route.fulfill({status:listStatus,json:{message:'QA list read failed'}});
  };
  const detailReads = [];
  const readDetail = (route) => {
    detailReads.push(detailStatus);
    return detailStatus === 200 ? route.fulfill({ json: { data: ownerDetail() } }) : route.fulfill({ status: detailStatus, json: { message: 'QA detail read failed' } });
  };
  const expectedId = dynamic && !entry.storedDetail ? dynamicId(dynamic) : entry.api === 'node' ? `live-node:${clusterId}:${row.name}` : entry.api === 'namespace' ? `live-namespace:${clusterId}:${row.name}` : entry.api === 'autoscaling' ? `${clusterId}/prod/${row.name}` : row.id;
  await context.addInitScript(() => {
    localStorage.setItem("aiops_auth_access", "detail-matrix-fixture");
    localStorage.setItem("aiops_auth_user", "Detail Matrix");
    localStorage.setItem("aiops_auth_role", "admin");
    localStorage.setItem("aiops_auth_expires_at", "2030-01-01T00:00:00Z");
    localStorage.setItem('kubenova-theme-mode', 'light');
  });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const fulfill = (data, status = 200) => route.fulfill({ status, json: { data } });
    if (request.method() === 'POST' && path === '/api/resources/discovery/refresh') return fulfill({ ok: true, clusterId, changed: false });
    if (request.method() !== "GET") { writes.push(`${request.method()} ${path}`); return route.fulfill({ status: 405, json: { message: "detail matrix blocks writes" } }); }
    if (path === "/api/v1/auth/me") return fulfill({ user: { username: "Detail Matrix", role: "admin" }, expiresAt: "2030-01-01T00:00:00Z" });
    if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': QA fixture\n\n' });
    if (path === "/api/clusters") return fulfill({ items: [{ id: clusterId, name: "Detail Matrix", state: "active", hasKubeconfig: true }], total: 1 });
    if (path === `/api/clusters/${clusterId}`) return fulfill({ id: clusterId, name: "Detail Matrix", runtimeStatus: "running", connectionStatus: "connected" });
    if (path === "/api/cluster-health") return fulfill({ items: [{ clusterId, runtimeStatus: "running" }], total: 1 });
    if (path === "/api/namespaces") return entry.api === 'namespace' ? readList(route,listPayload) : fulfill({ items: [{ id: "prod-id", clusterId, clusterName: "Detail Matrix", namespace: "prod", state: "active", labels: {}, createdAt: timestamp, updatedAt: timestamp }], total: 1, page: 1, pageSize: 500, timestamp });
    if (path.startsWith("/api/users/preferences/table/")) return fulfill(null);
    if (path === "/api/capabilities" || path === "/api/ai-assistant/sessions") return fulfill([]);
    if (path === "/api/system/update/status") return fulfill({ updateAvailable: false });
    if (entry.api === "node" && path === `/api/clusters/${clusterId}/nodes`) return readList(route,{ ...listPayload, clusterId, degraded: false, degradationReason: null, timestamp, items: listPayload.items.map(item => ({ ...item, role: 'worker', taints: [], internalIP: '10.0.0.2', externalIP: null, kubeletVersion: 'v1.31.0', containerRuntimeVersion: 'containerd://1.7.0' })) });
    if (entry.api === "network" && path === "/api/network") return readList(route,listPayload);
    if (entry.api === "storage" && path === "/api/storage") return readList(route,listPayload);
    if (entry.api === 'config' && path === '/api/configs') return readList(route,{ items: [row], total: 1, page: 1, pageSize: 25 });
    if (entry.api === 'ingressclass' && path === '/api/resources/ingressclasses') return readList(route,{ items: [{ name: row.name, controller: 'example.com/ingress', isDefault: false, resourceVersion: '1', createdAt: timestamp }] });
    if (entry.api === "autoscaling" && path === "/api/autoscaling/policies") return readList(route,listPayload);
    if (entry.api === "autoscaling" && path === "/api/autoscaling/events") return fulfill({ clusterId, namespace: "prod", hours: 24, items: [], total: 0, timestamp });
    if (entry.api === "dynamic" && path === "/api/resources/discovery/catalog") return fulfill({ clusterId, items: [{ id: "matrix-discovery", clusterId, group: entry.group, version: entry.version, kind: entry.kind, resource: entry.resource, namespaced: true, verbs: ["get", "list"], lastDiscoveredAt: timestamp }], total: 1, stale: false, timestamp });
    if (entry.api === "dynamic" && path === "/api/resources/dynamic") return readList(route,listPayload);
    if (entry.api === "dynamic" && path === "/api/resources/dynamic/detail") return fulfill(dynamicDetail);
    if (/^\/api\/resources\/[^/]+\/[^/]+\/detail$/.test(path)) {
      if (decodeURIComponent(path.split('/')[4]) === relatedTarget.id) return fulfill(detail({ ...related, id: relatedTarget.id }));
      return readDetail(route);
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { message: `Missing detail matrix fixture: ${path}` } });
  });
  try {
    const target = `${origin}/clusters/${clusterId}${entry.path}`;
    await page.goto(target, { waitUntil: "domcontentloaded" });
    const baselinePath = new URL(page.url()).pathname;
    const background = page.locator('.resource-table-shell').first();
    const nameText = background.locator('a:visible, button.ant-btn-link:visible').filter({ hasText: entry.name }).first();
    await nameText.waitFor();
    const resourceSearch=background.getByRole('textbox',{name:'搜索资源',exact:true});
    const clientSearch=['node','ingressclass'].includes(entry.api);
    for(const keyword of ['qa-no-such-resource',entry.name]) {
      const response=clientSearch ? null : page.waitForResponse(response=>{
        const url=new URL(response.url());
        return url.pathname===mainListPath && url.searchParams.get('keyword')===keyword && response.request().method()==='GET';
      });
      await resourceSearch.fill(keyword);
      if(response) assert.equal((await response).status(),200,`${entry.kind}: resource search must read a successful list`);
      if(keyword===entry.name) await nameText.waitFor();
      else await nameText.waitFor({state:'hidden'});
      assert.equal(await resourceSearch.inputValue(),keyword,'only the resource search input should change');
      if(!clientSearch) await page.waitForFunction(keyword=>new URL(location.href).searchParams.get('keyword')===keyword,keyword);
    }
    if(entry.group==='gateway.networking.k8s.io') {
      // Gateway search combines a server name keyword and client label selectors.
      // An unchanged keyword may reuse its cache, so observe rendered matches,
      // not an incidental new HTTP request, when changing only the label.
      for(const label of ['app=missing','app=detail','app=DETAIL-MATRIX']) {
        await resourceSearch.fill(`${entry.name} ${label}`);
        await nameText.waitFor({state:'hidden'});
      }
      await resourceSearch.fill(`${entry.name} app=detail-matrix`);
      await nameText.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('keyword'),entry.name,'labels must not become the name keyword');
      await resourceSearch.fill(entry.name);
      await nameText.waitFor();
    }
    if(!clientSearch) {
      assert.ok(listRequestUrls.some(value=>new URL(value).searchParams.get('keyword')===entry.name),`${entry.kind}: search must reach the main list API`);
      await page.reload({waitUntil:'networkidle'});
      await nameText.waitFor();
      assert.equal(await resourceSearch.inputValue(),entry.name,`${entry.kind}: reload restores resource search`);
    }
    const initialUrl=page.url();
    const refreshList=page.getByRole('button',{name:'刷新页面',exact:true});
    for(const status of [503,403,503,200]) {
      const beforeReads=listReads.length;
      listStatus=status;
      await refreshList.click();
      await page.waitForFunction(()=>!document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
      assert.ok(listReads.length>beforeReads,`${entry.kind}: refresh must actually read the main list`);
      if(status===403 || (status===503 && listReads.includes(403))) {
        await background.getByText(status===403?'没有查看权限':'资源数据加载失败',{exact:true}).waitFor();
        assert.equal(await nameText.count(),0,`${entry.kind}: denied list rows must stay hidden through transient failure`);
      } else {
        await nameText.waitFor();
      }
      assert.equal(page.url(),initialUrl,`${entry.kind}: list refresh must preserve its URL`);
      assert.equal(await resourceSearch.inputValue(),entry.name,`${entry.kind}: refresh must preserve typed resource search`);
    }
    if (entry.kind === 'Service') {
      const table = background.locator('.resource-table');
      const standardHeight = await table.evaluate(element => element.style.getPropertyValue('--resource-table-row-height'));
      await background.getByText('紧凑', { exact: true }).click();
      const compactHeight = await table.evaluate(element => element.style.getPropertyValue('--resource-table-row-height'));
      assert.ok(Number.parseFloat(compactHeight) < Number.parseFloat(standardHeight), 'compact density must reduce the desktop row rhythm');
      await page.reload({ waitUntil: 'networkidle' });
      await nameText.waitFor();
      assert.equal(await table.evaluate(element => element.style.getPropertyValue('--resource-table-row-height')), compactHeight, 'the built page must restore density after hydration');
      await background.getByText('标准', { exact: true }).click();
      assert.equal(await table.evaluate(element => element.style.getPropertyValue('--resource-table-row-height')), standardHeight);
    }
    await nameText.click();
    const drawer = page.locator(".ant-drawer:visible").last();
    await drawer.waitFor();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle');
    await captureDetail(page, drawer, entry.kind, 'light');
    assert.equal(new URL(page.url()).pathname, baselinePath, `${entry.path} changed pathname while opening detail`);
    assert.equal(new URL(page.url()).searchParams.get("detailId"), expectedId);
    assert.equal(await nameText.count(), 1, 'the original background resource row remains mounted');
    const relationshipLink = drawer.locator('a').filter({ hasText: related.name }).first();
    await relationshipLink.focus();
    assert.equal(await relationshipLink.evaluate(element => element === document.activeElement), true, 'relation names must be keyboard-focusable');
    await relationshipLink.press('Enter');
    await drawer.locator('.ant-drawer-title').filter({ hasText: related.name }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('detailId'), relatedTarget.id, 'association uses the stable Kubernetes identity');
    assert.equal(new URL(page.url()).pathname, baselinePath, 'relation navigation must keep the original list pathname');
    assert.equal(await nameText.count(), 1, 'relation navigation must keep the background list mounted');
    await drawer.getByRole('button', { name: /^返\s*回$/ }).click();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('detailId'), expectedId, 'back must restore the original detail identity');
    await relationshipLink.focus();
    await relationshipLink.press('Space');
    await drawer.locator('.ant-drawer-title').filter({ hasText: related.name }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('detailId'), relatedTarget.id, 'Space activates the same relation without scrolling away');
    await drawer.getByRole('button', { name: /^返\s*回$/ }).click();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await drawer.waitFor();
    const refresh = drawer.getByRole('button', { name: /^刷\s*新$/ });
    detailStatus = 503;
    await refresh.click();
    await drawer.getByText('详情刷新失败，当前内容可能已过期', { exact: true }).waitFor();
    assert.ok(await drawer.getByText(row.name, { exact: true }).count() > 0, '503 must keep the authorized detail');
    detailStatus = 403;
    await refresh.click();
    await drawer.getByText('无权查看该资源详情', { exact: true }).waitFor();
    assert.equal(await drawer.getByText(row.name, { exact: true }).count(), 0, '403 must hide the cached overview');
    detailStatus = 503;
    const deniedRefresh = page.waitForResponse(response => response.status() === 503 && response.url().includes('/detail'));
    await refresh.click();
    await deniedRefresh;
    await refresh.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.resource-detail-drawer-wrapper .ant-btn-loading'));
    assert.equal(await drawer.getByText(row.name, { exact: true }).count(), 0, '503 cannot release the denied snapshot');
    detailStatus = 200;
    await refresh.click();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    assert.ok(detailReads.includes(403) && detailReads.includes(503));
    await drawer.locator(".ant-drawer-close").click();
    await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).searchParams.get("detailId"), null, "close clears detailId");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await expectNoHorizontalOverflow(page), "390px viewport overflows horizontally");
    const utilityBackdrop = page.getByRole('button', { name: '关闭工具栏遮罩', exact: true });
    if (await utilityBackdrop.isVisible().catch(() => false)) await utilityBackdrop.click({position:{x:20,y:100}});
    const mobileLink = page.locator('.resource-table-mobile-list').locator('a:visible, button.ant-btn-link:visible').filter({ hasText: entry.name }).first();
    await mobileLink.click();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).pathname, baselinePath, 'mobile detail must preserve the list pathname');
    assert.equal(await mobileLink.count(), 1, 'the original mobile resource card remains mounted');
    assert.ok(await expectNoHorizontalOverflow(page), 'mobile detail must not overflow horizontally');
    await captureDetail(page, drawer, entry.kind, 'mobile');
    await drawer.locator('.ant-drawer-close').click();
    await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".shell-theme-toggle").first().click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await nameText.click();
    await drawer.getByText(row.name, { exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).pathname, baselinePath, 'dark-mode detail must also preserve the list pathname');
    assert.ok(await expectNoHorizontalOverflow(page), 'dark detail must not overflow horizontally');
    await captureDetail(page, drawer, entry.kind, 'dark');
    await drawer.locator('.ant-drawer-close').click();
    await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
    assert.deepEqual(writes, [], `writes blocked: ${writes.join(", ")}`);
    assert.deepEqual(unexpected, [], `unknown GET fixtures: ${unexpected.join(", ")}`);
    assert.deepEqual(errors, []);
    console.log(`PASS ${entry.path} (${entry.kind})`);
  } catch (error) {
    failures.push(`${entry.path}: ${error.stack}; url=${page.url()}; writes=${JSON.stringify(writes)}; unknown=${JSON.stringify(unexpected)}; errors=${JSON.stringify(errors)}; body=${(await page.locator('body').innerText()).slice(0, 5000)}`);
    console.error(failures.at(-1));
  } finally { await context.close(); }
}

await browser.close();
assert.deepEqual(failures, []);
console.log(`DETAIL_MATRIX_PASS=${selectedEntries.length}`);
