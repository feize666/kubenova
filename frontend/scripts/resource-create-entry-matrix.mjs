import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.RESOURCE_ENTRY_QA_URL || 'http://127.0.0.1:3000';
const clusterId = 'create-entry-cluster';
const entries = [
  ['workloads/deployments', 'Deployment'], ['workloads/statefulsets', 'StatefulSet'],
  ['workloads/daemonsets', 'DaemonSet'], ['workloads/pods', 'Pod'],
  ['workloads/jobs', 'Job'], ['workloads/cronjobs', 'CronJob'], ['workloads/replicasets', 'ReplicaSet'],
  ['network/services', 'Service'], ['network/ingress', 'Ingress'], ['network/networkpolicy', 'NetworkPolicy'],
  ['network/endpoints', 'Endpoints'], ['network/endpointslices', 'EndpointSlice'],
  ['storage/pvc', 'PersistentVolumeClaim'], ['storage/pv', 'PersistentVolume'], ['storage/sc', 'StorageClass'],
  ['configs/configmaps', 'ConfigMap'], ['configs/secrets', 'Secret'], ['configs/serviceaccounts', 'ServiceAccount'],
  ['namespaces', 'Namespace'],
  ['network/ingressclasses', 'IngressClass'], ['configs/resourcequotas', 'ResourceQuota'],
  ['configs/limitranges', 'LimitRange'], ['workloads/autoscaling/hpa', 'HorizontalPodAutoscaler'],
  ['workloads/autoscaling/vpa', 'VerticalPodAutoscaler'],
  ['network/gateway-api', 'GatewayClass'], ['network/gateway-api', 'Gateway'], ['network/gateway-api', 'HTTPRoute'],
];
const requested = process.env.RESOURCE_ENTRY_QA_KINDS?.split(',');
const selected = requested ? entries.filter(([, kind]) => requested.includes(kind)) : entries;
assert.ok(selected.length);
const schemaFields = {
  GatewayClass: { controllerName: { type: 'string', title: '网关控制器' } },
  Gateway: { gatewayClassName: { type: 'string', title: '网关类名称' } },
  HTTPRoute: { hostnames: { type: 'array', title: '主机名', items: { type: 'string' } } },
  VerticalPodAutoscaler: { targetRef: { type: 'object', title: '目标资源', properties: { name: { type: 'string', title: '目标名称' }, kind: { type: 'string', title: '目标类型' }, apiVersion: { type: 'string', title: '目标版本' } } } },
};
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
let checks = 0;
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(theme => {
      localStorage.setItem('aiops_auth_access', 'create-entry-fixture');
      localStorage.setItem('aiops_auth_user', 'Create Entry QA');
      localStorage.setItem('aiops_auth_role', 'admin');
      localStorage.setItem('aiops_auth_expires_at', '2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova-theme-mode', theme);
    }, theme);
    const writes = [], errors = [];
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const ok = data => route.fulfill({ json: { data } });
      if (request.method() !== 'GET') {
        if (request.method() === 'POST' && path === '/api/resources/discovery/refresh') return route.fulfill({ json: { data: { refreshed: false } } });
        writes.push(`${request.method()} ${path}`); return route.abort();
      }
      if (path === '/api/v1/auth/me') return ok({ user: { username: 'Create Entry QA', role: 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (path.startsWith('/api/users/preferences/table/')) return ok(null);
      if (path === '/api/clusters') return ok({ items: [{ id: clusterId, name: 'Create Entry Cluster', state: 'active', hasKubeconfig: true }], total: 1 });
      if (path === `/api/clusters/${clusterId}`) return ok({ id: clusterId, name: 'Create Entry Cluster', state: 'active', hasKubeconfig: true, nodeSummary: { items: [], total: 0, ready: 0 }, platform: {}, metadata: {} });
      if (path === '/api/capabilities' || path === '/api/ai-assistant/sessions') return ok([]);
      if (path === '/api/system/update/status') return ok({ updateAvailable: false });
      if (path === '/api/resources/editor/schema') {
        const properties = schemaFields[url.searchParams.get('kind')];
        return ok(properties ? { schema: { type: 'object', properties: { spec: { type: 'object', properties } } }, source: 'crd' } : { schema: null, source: 'unavailable' });
      }
      if (path === '/api/autoscaling/policies') return ok({ items: [], total: 0, overview: { totalPolicies: 0, hpaPolicies: 0, vpaPolicies: 0, coveredWorkloads: 0, uncoveredWorkloads: 0 } });
      if (path === '/api/namespaces') return ok({ items: [{ id: 'prod', namespace: 'prod', clusterId, state: 'active' }], total: 1 });
      return ok({ items: [], total: 0, page: 1, pageSize: 25 });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const [path, kind] of selected) for (const mode of ['form', 'yaml']) {
        const filters = new URLSearchParams();
        if (!['Namespace', 'PersistentVolume', 'StorageClass', 'IngressClass', 'GatewayClass'].includes(kind)) filters.set('namespace', 'prod');
        if (path === 'network/gateway-api') filters.set('kind', kind.toLowerCase());
        const listUrl = `${origin}/clusters/${clusterId}/${path}${filters.size ? '?' + filters.toString() : ''}`;
        await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
        const button = page.locator('.resource-add-button:visible').filter({ hasText: mode === 'yaml' ? 'YAML 创建' : /^创建$/ });
        try { await button.waitFor(); } catch (error) { throw new Error(`${kind}/${mode}/${theme}/${width}: ${await page.locator('body').innerText()}`, { cause: error }); }
        const before = page.url();
        await button.click();
        await page.waitForURL('**/resources/editor?**');
        const params = new URL(page.url()).searchParams;
        assert.equal(params.get('kind'), kind, `${kind} entry must lock its resource kind`);
        assert.equal(params.get('clusterId'), clusterId, `${kind} entry must inherit the workspace cluster`);
        assert.equal(params.get('mode'), mode);
        assert.equal(params.get('returnTo'), new URL(before).pathname + new URL(before).search);
        await page.getByRole('tab', { name: mode === 'yaml' ? 'YAML' : '表单', exact: true }).waitFor();
        assert.equal(await page.getByRole('tab', { name: mode === 'yaml' ? 'YAML' : '表单', exact: true }).getAttribute('aria-selected'), 'true');
        if (mode === 'form') {
          await page.getByRole('textbox', { name: '资源名称', exact: true }).waitFor();
          assert.ok(await page.getByRole('tab', { name: '表单', exact: true }).isEnabled(), `${kind} schema must allow the actual form`);
        }
        assert.equal(await page.getByText('目标集群', { exact: true }).count(), 0);
        try {
          await page.getByRole('group', { name: '资源编辑操作', exact: true }).getByRole('button', { name: /^返\s*回$/ }).click();
        } catch (error) { throw new Error(`${kind}/${mode}/${theme}/${width}: ${await page.locator('body').innerText()}`, { cause: error }); }
        await page.waitForURL(before);
        await button.waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${kind}/${mode}/${theme}/${width} overflows`);
        checks++;
        console.log(`PASS ${kind}/${mode}/${theme}/${width}`);
      }
      assert.deepEqual(writes, [], 'entry validation must never submit resources');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log(`PASS resource create entries: ${checks} actual route checks`);
} finally { await browser.close(); }
