import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { dump } from 'js-yaml';

// Real list menus and editor routes; all API and WebSocket boundaries are isolated.
const origin = process.env.RESOURCE_ENTRY_QA_URL || 'http://127.0.0.1:3000';
const clusterId = 'edit-entry-cluster';
const readOnly = process.env.RESOURCE_ENTRY_QA_READONLY === '1';
const entries = [
  ['namespaces', 'Namespace', 'v1', {}],
  ['workloads/autoscaling/hpa', 'HorizontalPodAutoscaler', 'autoscaling/v2', { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'entry-workload' }, minReplicas: 1, maxReplicas: 3 }],
  ['workloads/autoscaling/vpa', 'VerticalPodAutoscaler', 'autoscaling.k8s.io/v1', { targetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'entry-workload' }, updatePolicy: { updateMode: 'Off' } }],
  ['workloads/deployments', 'Deployment', 'apps/v1', { selector: { matchLabels: { app: 'entry' } }, template: { metadata: { labels: { app: 'entry' } }, spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } } }],
  ['workloads/statefulsets', 'StatefulSet', 'apps/v1', { serviceName: 'entry-service', replicas: 1, selector: { matchLabels: { app: 'entry' } }, template: { metadata: { labels: { app: 'entry' } }, spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } } }],
  ['workloads/daemonsets', 'DaemonSet', 'apps/v1', { selector: { matchLabels: { app: 'entry' } }, template: { metadata: { labels: { app: 'entry' } }, spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } } }],
  ['workloads/replicasets', 'ReplicaSet', 'apps/v1', { replicas: 1, selector: { matchLabels: { app: 'entry' } }, template: { metadata: { labels: { app: 'entry' } }, spec: { containers: [{ name: 'web', image: 'nginx:1.27' }] } } }],
  ['workloads/jobs', 'Job', 'batch/v1', { template: { metadata: { labels: { app: 'entry' } }, spec: { restartPolicy: 'Never', containers: [{ name: 'worker', image: 'busybox:1.37', command: ['true'] }] } } }],
  ['workloads/pods', 'Pod', 'v1', { containers: [{ name: 'web', image: 'nginx:1.27' }] }],
  ['workloads/cronjobs', 'CronJob', 'batch/v1', { schedule: '0 * * * *', jobTemplate: { spec: { template: { metadata: { labels: { app: 'entry' } }, spec: { restartPolicy: 'Never', containers: [{ name: 'worker', image: 'busybox:1.37', command: ['true'] }] } } } } }],
  ['network/services', 'Service', 'v1', { selector: { app: 'entry' }, ports: [{ port: 80, targetPort: 8080 }] }],
  ['storage/pvc', 'PersistentVolumeClaim', 'v1', { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } }],
  ['storage/pv', 'PersistentVolume', 'v1', { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteOnce'], hostPath: { path: '/fixture-only' } }],
  ['storage/sc', 'StorageClass', 'storage.k8s.io/v1', { provisioner: 'example.test/fixture' }],
  ['network/ingress', 'Ingress', 'networking.k8s.io/v1', { rules: [{ host: 'entry.example.test', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'entry-service', port: { number: 80 } } } }] } }] }],
  ['network/ingressclasses', 'IngressClass', 'networking.k8s.io/v1', { controller: 'example.test/ingress' }],
  ['network/networkpolicy', 'NetworkPolicy', 'networking.k8s.io/v1', { podSelector: { matchLabels: { app: 'entry' } }, policyTypes: ['Ingress'] }],
  ['network/endpoints', 'Endpoints', 'v1', {}],
  ['network/endpointslices', 'EndpointSlice', 'discovery.k8s.io/v1', {}],
  ['configs/configmaps', 'ConfigMap', 'v1', null],
  ['configs/serviceaccounts', 'ServiceAccount', 'v1', {}],
  ['configs/secrets', 'Secret', 'v1', null],
  ['configs/resourcequotas', 'ResourceQuota', 'v1', { hard: { pods: '20' } }],
  ['configs/limitranges', 'LimitRange', 'v1', { limits: [{ type: 'Container', default: { memory: '256Mi' } }] }],
  ['network/gateway-api', 'GatewayClass', 'gateway.networking.k8s.io/v1', { controllerName: 'qa.example.test/controller' }],
  ['network/gateway-api', 'Gateway', 'gateway.networking.k8s.io/v1', { gatewayClassName: 'fixture', listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }] }],
  ['network/gateway-api', 'HTTPRoute', 'gateway.networking.k8s.io/v1', { parentRefs: [{ name: 'fixture' }], rules: [{ backendRefs: [{ name: 'web', port: 80 }] }] }],
  ['network/gateway-api', 'GRPCRoute', 'gateway.networking.k8s.io/v1', { parentRefs: [{ name: 'fixture' }], rules: [{ backendRefs: [{ name: 'grpc', port: 50051 }] }] }],
  ['network/gateway-api', 'TCPRoute', 'gateway.networking.k8s.io/v1alpha2', { parentRefs: [{ name: 'fixture' }], rules: [{ backendRefs: [{ name: 'web', port: 80 }] }] }],
  ['network/gateway-api', 'TLSRoute', 'gateway.networking.k8s.io/v1alpha2', { parentRefs: [{ name: 'fixture' }], hostnames: ['entry.example.test'], rules: [{ backendRefs: [{ name: 'web', port: 443 }] }] }],
  ['network/gateway-api', 'UDPRoute', 'gateway.networking.k8s.io/v1alpha2', { parentRefs: [{ name: 'fixture' }], rules: [{ backendRefs: [{ name: 'dns', port: 53 }] }] }],
  ['network/gateway-api', 'ReferenceGrant', 'gateway.networking.k8s.io/v1beta1', { from: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: 'prod' }], to: [{ group: '', kind: 'Service' }] }],
  ['network/gateway-api', 'BackendTLSPolicy', 'gateway.networking.k8s.io/v1alpha3', { targetRefs: [{ group: '', kind: 'Service', name: 'web' }], validation: { hostname: 'web.example.test', wellKnownCACertificates: 'System' } }],
];
const requestedKinds = (process.env.RESOURCE_ENTRY_QA_KINDS || process.env.RESOURCE_ENTRY_QA_KIND || '').split(',').map(value => value.trim()).filter(Boolean);
for (const kind of requestedKinds) assert.ok(entries.some(entry => entry[1] === kind), `Unsupported resource entry kind: ${kind}`);
const selectedEntries = entries.filter(entry => !requestedKinds.length || requestedKinds.includes(entry[1]));
assert.ok(selectedEntries.length, 'RESOURCE_ENTRY_QA_KIND must match a supported matrix entry');
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
let checks = 0;
try {
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(({ theme, readOnly }) => {
      localStorage.setItem('aiops_auth_access', 'edit-entry-fixture');
      localStorage.setItem('aiops_auth_user', 'Edit Entry QA');
      localStorage.setItem('aiops_auth_role', readOnly ? 'viewer' : 'admin');
      localStorage.setItem('aiops_auth_expires_at', '2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova-theme-mode', theme);
    }, { theme, readOnly });
    const writes = [], errors = [], yamlReads = [];
    await context.routeWebSocket('**/*', socket => socket.close());
    let active;
    await context.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const ok = data => route.fulfill({ json: { data } });
      if (request.method() !== 'GET') {
        if (path === '/api/resources/discovery/refresh' && request.method() === 'POST') return ok({ refreshed: false });
        writes.push(`${request.method()} ${path}`); return route.abort();
      }
      if (path === '/api/v1/auth/me') return ok({ user: { username: 'Edit Entry QA', role: readOnly ? 'viewer' : 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (path.startsWith('/api/users/preferences/table/')) return ok(null);
      if (path === '/api/clusters') return ok({ items: [{ id: clusterId, name: 'Edit Entry Cluster', state: 'active', hasKubeconfig: true }], total: 1 });
      if (path === `/api/clusters/${clusterId}`) return ok({ id: clusterId, name: 'Edit Entry Cluster', state: 'active', hasKubeconfig: true, nodeSummary: { items: [], total: 0, ready: 0 }, platform: {}, metadata: {} });
      if (path === '/api/capabilities' || path === '/api/ai-assistant/sessions') return ok([]);
      if (path === '/api/system/update/status') return ok({ updateAvailable: false });
      if (path === '/api/autoscaling/policies') {
        const vpa = active.kind === 'VerticalPodAutoscaler';
        return ok({ items: [{ ...active.row, type: vpa ? 'VPA' : 'HPA', resourceName: active.name, workloadKind: 'Deployment', workloadName: 'entry-workload', workloadId: 'fixture-workload', config: vpa ? { updateMode: 'Off' } : { minReplicas: 1, maxReplicas: 3 } }], total: 1, overview: { totalPolicies: 1, hpaPolicies: vpa ? 0 : 1, vpaPolicies: vpa ? 1 : 0, coveredWorkloads: 1, uncoveredWorkloads: 0 } });
      }
      if (path === '/api/resources/ingressclasses') return ok({ items: [active.row] });
      if (path === '/api/resources/editor/schema' && active.kind === 'VerticalPodAutoscaler') return ok({ source: 'crd', schema: { type: 'object', properties: { spec: { type: 'object', properties: { targetRef: { type: 'object', properties: { apiVersion: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' } } }, updatePolicy: { type: 'object', properties: { updateMode: { type: 'string', enum: ['Off', 'Initial', 'Auto'] } } } } } } } });
      if (path === '/api/resources/editor/schema') return ok(active.apiVersion.startsWith('gateway.') ? { schema: { type: 'object', properties: { spec: { type: 'object', properties: { controllerName: { type: 'string' }, gatewayClassName: { type: 'string' } } } } }, source: 'crd' } : { schema: null, source: 'unavailable' });
      if (path === '/api/namespaces') return ok({ items: active.kind === 'Namespace' ? [active.row] : [{ id: 'prod', namespace: 'prod', clusterId, state: 'active' }], total: 1 });
      if (path === '/api/resources/yaml' || path === '/api/resources/dynamic/detail') {
        yamlReads.push(Object.fromEntries(url.searchParams));
        return ok({ clusterId, kind: active.kind, name: active.name, raw: active.manifest, yaml: dump(active.manifest), resourceVersion: '42' });
      }
      if (path === '/api/resources/dynamic') return ok({ clusterId, group: '', version: 'v1', resource: url.searchParams.get('resource'), kind: active.kind, namespaced: true, items: [active.row], total: 1, page: 1, pageSize: 25 });
      if (['/api/workloads', '/api/network', '/api/configs', '/api/storage'].includes(path)) return ok({ items: [active.row], total: 1, page: 1, pageSize: 25 });
      return ok({ items: [], total: 0 });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const [path, kind, apiVersion, spec] of selectedEntries) for (const mode of ['form', 'yaml']) {
        const name = `entry-${kind.toLowerCase()}`;
        const namespace = ['Namespace', 'IngressClass', 'GatewayClass', 'PersistentVolume', 'StorageClass'].includes(kind) ? '' : 'prod';
        const manifest = { apiVersion, kind, metadata: { name, ...(namespace ? { namespace } : {}), resourceVersion: '42', labels: { app: 'entry' } }, ...(spec ? { spec } : { data: kind === 'Secret' ? { sample: 'Zml4dHVyZQ==' } : { sample: 'fixture' } }), ...(kind === 'Secret' ? { type: 'Opaque' } : {}) };
        if (kind === 'StorageClass') {
          manifest.provisioner = spec.provisioner;
          delete manifest.spec;
        }
        active = { kind, name, apiVersion, manifest, row: { id: name, name, kind, apiVersion, clusterId, namespace, state: 'active', status: 'Running', replicas: 1, readyReplicas: 1, dataCount: 1, version: 1, spec: spec || {}, statusJson: {}, labels: { app: 'entry' }, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' } };
        if (kind === 'Namespace') active.row.namespace = name;
        const listParams = new URLSearchParams();
        if (path === 'network/gateway-api') listParams.set('kind', kind.toLowerCase());
        if (namespace) listParams.set('namespace', namespace);
        const listUrl = `${origin}/clusters/${clusterId}/${path}${listParams.size ? `?${listParams}` : ''}`;
        await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
        const createButtons = page.locator('.resource-add-button');
        await createButtons.first().waitFor();
        for (const button of await createButtons.all()) {
          assert.equal(await button.isDisabled(), readOnly, `${kind}: creation availability must follow write permissions`);
        }
        if (readOnly && ['HorizontalPodAutoscaler', 'VerticalPodAutoscaler'].includes(kind)) {
          assert.ok(await page.getByRole('button', { name: '创建伸缩策略', exact: true }).isDisabled());
          assert.ok(await page.getByRole('button', { name: '使用 YAML 创建伸缩策略', exact: true }).isDisabled());
        }
        const actions = page.getByRole('button', { name: kind === 'Namespace' ? `${name} 更多操作` : kind === 'Pod' ? '操作' : '更多操作', exact: true }).filter({ visible: true }).first();
        try { await actions.click(); }
        catch (error) { throw new Error(`${kind}: list action unavailable: ${await page.locator('body').innerText()}`, { cause: error }); }
        if (readOnly) {
          for (const label of ['扩缩容', '扩容', '绑定', '重启', '回滚', '启用', '禁用']) {
            const writeAction = page.getByRole('menuitem').filter({ hasText: new RegExp(`^${label}$`) });
            if (await writeAction.count()) assert.equal(await writeAction.getAttribute('aria-disabled'), 'true', `${kind}: ${label} must be disabled for read-only users`);
          }
          const deleteAction = page.getByRole('menuitem').filter({ hasText: /^删除$/ });
          if (await deleteAction.count()) {
            const disabled = await deleteAction.evaluate(node => node.getAttribute('aria-disabled') === 'true' || node.classList.contains('ant-dropdown-menu-item-disabled') || node.hasAttribute('data-disabled'));
            assert.equal(disabled, true, `${kind}: read-only deletion must be disabled`);
          }
        }
        if (readOnly && ['IngressClass', 'HorizontalPodAutoscaler', 'VerticalPodAutoscaler'].includes(kind) && mode === 'form') {
          assert.equal(await page.getByRole('menuitem').filter({ hasText: /^编辑$/ }).getAttribute('aria-disabled'), 'true');
          await page.keyboard.press('Escape');
          checks++;
          continue;
        }
        try {
          await page.locator('[role="menuitem"]:visible').filter({ hasText: mode === 'form' ? /^编辑$/ : /^YAML$/ }).first().click();
        } catch (error) {
          throw new Error(`${kind}/${mode}/${theme}/${width}: ${await page.locator('body').innerText()}`, { cause: error });
        }
        if (mode === 'yaml') {
          const drawer = page.locator('.ant-drawer:visible');
          try { await drawer.getByText(`YAML · ${name}`, { exact: true }).waitFor(); }
          catch (error) { throw new Error(`${kind}: YAML must open in place; current URL ${page.url()}`, { cause: error }); }
          assert.equal(page.url(), listUrl, 'YAML must keep the background list route');
          if (kind === 'Secret') await drawer.getByRole('button', { name: /显示敏感内容/ }).click();
          await drawer.getByRole('textbox', { name: 'YAML 只读预览', exact: true }).waitFor();
          if (readOnly) {
            assert.equal(await drawer.getByRole('button', { name: /编辑 YAML/ }).count(), 0, 'viewer must not have an embedded write action');
            await drawer.locator('.ant-drawer-close').click();
            await drawer.waitFor({ state: 'hidden' });
            checks++;
            continue;
          }
          await drawer.getByRole('button', { name: /编辑 YAML/ }).click();
          if (kind === 'Secret') await drawer.getByRole('button', { name: '显示敏感 YAML', exact: true }).click();
          try { await drawer.getByRole('textbox', { name: '资源 YAML', exact: true }).waitFor(); }
          catch (error) { throw new Error(`${kind}: ${await drawer.innerText()}`, { cause: error }); }
          assert.equal(page.url(), listUrl, 'embedded edit must not navigate');
          await drawer.locator('.ant-drawer-close').click();
          await drawer.waitFor({ state: 'hidden' });
          await actions.waitFor();
          checks++;
          console.log(`PASS inline YAML ${kind}/${theme}/${width}`);
          continue;
        }
        await page.waitForURL('**/resources/editor?**');
        const params = new URL(page.url()).searchParams;
        assert.equal(params.get('kind'), kind);
        assert.equal(params.get('name'), name);
        assert.equal(params.get('namespace') || '', namespace);
        assert.equal(params.get('clusterId'), clusterId);
        assert.equal(params.get('mode'), mode);
        if (['ResourceQuota', 'LimitRange'].includes(kind)) {
          assert.equal(params.get('apiVersion'), 'v1');
          assert.equal(params.get('resource'), kind === 'ResourceQuota' ? 'resourcequotas' : 'limitranges');
        }
        if (apiVersion.startsWith('gateway.')) {
          assert.equal(params.get('apiVersion'), apiVersion);
          assert.equal(params.get('resource'), { GatewayClass: 'gatewayclasses', Gateway: 'gateways', HTTPRoute: 'httproutes', GRPCRoute: 'grpcroutes', TCPRoute: 'tcproutes', TLSRoute: 'tlsroutes', UDPRoute: 'udproutes', ReferenceGrant: 'referencegrants', BackendTLSPolicy: 'backendtlspolicies' }[kind]);
        }
        assert.equal(params.get('returnTo'), new URL(listUrl).pathname + new URL(listUrl).search);
        const tab = page.getByRole('tab', { name: mode === 'form' ? '表单' : 'YAML', exact: true });
        await tab.waitFor();
        if (mode === 'form') {
          const nameInput = page.getByRole('textbox', { name: '资源名称', exact: true });
          try { await nameInput.waitFor(); }
          catch (error) { throw new Error(`${kind}: form identity unavailable: ${await page.locator('body').innerText()}`, { cause: error }); }
          assert.equal(await nameInput.inputValue(), name);
        } else await page.getByRole('textbox', { name: '资源 YAML', exact: true }).waitFor();
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        if (readOnly) {
          await page.getByText('当前权限仅允许查看，不能校验或提交写入。', { exact: true }).waitFor();
          assert.ok(await page.getByRole('button', { name: '校验并预览', exact: true }).isDisabled());
          assert.ok(await page.getByRole('textbox', { name: '资源名称', exact: true }).isDisabled());
        }
        assert.ok(yamlReads.some(read => (read.kind === kind || read.resource === ({ GatewayClass: 'gatewayclasses', Gateway: 'gateways', HTTPRoute: 'httproutes', BackendTLSPolicy: 'backendtlspolicies' }[kind] || kind.toLowerCase() + 's')) && read.name === name && read.clusterId === clusterId && (read.namespace || '') === namespace));
        await page.getByRole('group', { name: '资源编辑操作', exact: true }).getByRole('button', { name: /^返\s*回$/ }).click();
        await page.waitForURL(listUrl);
        await actions.waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${kind}/${mode}/${theme}/${width} overflows`);
        checks++;
        console.log(`PASS edit ${kind}/${mode}/${theme}/${width}`);
      }
      assert.deepEqual(writes, [], 'entry checks must never submit resources');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log(`PASS resource edit entries: ${checks} actual route checks (${readOnly ? 'viewer' : 'admin'})`);
} finally { await browser.close(); }
