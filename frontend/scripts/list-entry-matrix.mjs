import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Exercise actual Next routes; only external API and socket boundaries are fixtures.
const origin = process.env.LIST_ENTRY_QA_URL || 'http://127.0.0.1:3000';
const clusterId = 'list-entry-cluster';
const stamp = '2026-10-13T00:00:00Z';
const clusters = Array.from({ length: 26 }, (_, i) => ({
  id: i === 0 ? clusterId : `list-cluster-${i + 1}`,
  name: `entry-cluster-${String(i + 1).padStart(2, '0')}`, state: 'active',
  environment: '本地', provider: 'Fixture', hasKubeconfig: true,
  kubernetesVersion: 'v1.31.0', cpuUsage: 5, memoryUsage: 8,
  createdAt: stamp, updatedAt: stamp,
}));
const pods = Array.from({ length: 26 }, (_, i) => ({
  id: `entry-pod-${i + 1}`, name: `entry-pod-${String(i + 1).padStart(2, '0')}`,
  clusterId, namespace: 'prod', kind: 'Pod', state: 'active', status: 'Running',
  replicas: 1, readyReplicas: 1, labels: { app: 'entry' }, spec: {},
  statusJson: { uid: `pod-uid-${i + 1}`, phase: 'Running', containerNames: ['web'] },
  createdAt: stamp, updatedAt: stamp,
}));
const namespaces = ['prod', 'empty'].map(namespace => ({
  id: `${clusterId}/${namespace}`, clusterId, clusterName: clusters[0].name,
  namespace, state: 'active', labels: { 'kubernetes.io/metadata.name': namespace },
  createdAt: stamp, updatedAt: stamp,
}));
const nodes = Array.from({ length: 2 }, (_, i) => ({
  id: `node-${i + 1}`, name: `node-${String(i + 1).padStart(2, '0')}`,
  role: 'worker', roles: ['worker'], ready: true, kubeletVersion: 'v1.31.0',
  internalIP: `10.0.0.${i + 1}`, externalIP: null, osImage: 'Linux',
  kernelVersion: '6.1', containerRuntimeVersion: 'containerd://1.7',
  cpuCapacity: '4', memoryCapacity: '8Gi', cpuUsage: null, memoryUsage: null,
  cpuUsagePercent: null, memoryUsagePercent: null, taints: [], age: '2d', createdAt: stamp,
}));
const podDetail = {
  descriptor: { resourceKind: 'Pod', sections: ['overview', 'runtime', 'metadata', 'events'], capabilities: { rawSpec: true, rawStatus: true, relationships: true }, fieldsBySection: {} },
  overview: pods[0], rawSpec: { containers: [{ name: 'web', image: 'nginx:1.27' }] }, rawStatus: pods[0].statusJson,
  runtime: { phase: 'Running', containerDetails: [] }, metadata: { labels: { app: 'entry' }, annotations: {}, ownerReferences: [], configUsages: [] },
  associations: [], relationships: [], events: { items: [], status: 'empty' },
  network: { clusterIPs: [], podIPs: [], nodeNames: [], endpoints: [] }, storage: {}, generatedAt: stamp,
};
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
let checks = 0;
try {
  for (const theme of (process.env.LIST_ENTRY_QA_THEME ? [process.env.LIST_ENTRY_QA_THEME] : ['light', 'dark'])) for (const width of (process.env.LIST_ENTRY_QA_WIDTH ? [Number(process.env.LIST_ENTRY_QA_WIDTH)] : [1440, 390])) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const writes = [], unexpected = [], errors = [], reads = [];
    let clusterStatus = 200, podStatus = 200, namespaceStatus = 200, nodeStatus = 200;
    let namespaceEmpty = false, nodesEmpty = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(theme => {
      localStorage.setItem('aiops_auth_access', 'list-entry-fixture');
      localStorage.setItem('aiops_auth_user', 'List Entry QA');
      localStorage.setItem('aiops_auth_role', 'admin');
      localStorage.setItem('aiops_auth_expires_at', '2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova-theme-mode', theme);
    }, theme);
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const ok = data => route.fulfill({ json: { data } });
      if (request.method() !== 'GET') { writes.push(`${request.method()} ${path}`); return route.abort(); }
      if (path === '/api/v1/auth/me') return ok({ user: { username: 'List Entry QA', role: 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (path.startsWith('/api/users/preferences/table/')) return ok(null);
      if (path === '/api/capabilities' || path === '/api/ai-assistant/sessions') return ok([]);
      if (path === '/api/system/update/status') return ok({ updateAvailable: false });
      if (path === '/api/cluster-health') return ok({ items: clusters.map(item => ({ clusterId: item.id, clusterName: item.name, runtimeStatus: 'running', ok: true, source: 'auto', isStale: false })), total: 26 });
      if (path === `/api/clusters/${clusterId}`) return ok({ ...clusters[0], displayName: clusters[0].name, runtimeStatus: 'running', lastSyncTime: stamp, nodeSummary: { total: 0, ready: 0, notReady: 0, items: [], degraded: false, degradationReason: null }, platform: { cniPlugin: 'Cilium', criRuntime: 'containerd', kubernetesVersion: 'v1.31.0' }, metadata: { environment: '本地', provider: 'Fixture', region: null, environmentType: null } });
      if (path === '/api/dashboard/stats') return ok({ clusters: 1, nodes: 0, namespaces: 2, workloads: { total: 26, healthy: 26, unhealthy: 0 }, resourceUsage: { cpu: 5, memory: 8 }, topology: { nodes: 0, edges: 0 }, recentEvents: [] });
      if (path === '/api/namespaces') {
        reads.push({ path, params: Object.fromEntries(url.searchParams), status: namespaceStatus });
        if (namespaceStatus !== 200) return route.fulfill({ status: namespaceStatus, json: { message: 'Fixture namespace list unavailable' } });
        const items = namespaceEmpty ? [] : namespaces;
        return ok({ items, total: items.length, page: 1, pageSize: 25, timestamp: stamp });
      }
      if (path === `/api/clusters/${clusterId}/nodes`) {
        reads.push({ path, params: Object.fromEntries(url.searchParams), status: nodeStatus });
        if (nodeStatus !== 200) return route.fulfill({ status: nodeStatus, json: { message: 'Fixture node list unavailable' } });
        const items = nodesEmpty ? [] : nodes;
        return ok({ items, total: items.length, clusterId, degraded: false, degradationReason: null, timestamp: stamp });
      }
      if (path === '/api/clusters' || path === '/api/workloads') {
        const listStatus = path === '/api/clusters' ? clusterStatus : podStatus;
        reads.push({ path, params: Object.fromEntries(url.searchParams), status: listStatus });
        if (listStatus !== 200) return route.fulfill({ status: listStatus, json: { message: 'Fixture list unavailable' } });
        const keyword = url.searchParams.get('keyword') || '';
        const all = path === '/api/clusters' ? clusters : url.searchParams.get('namespace') === 'empty' ? [] : pods;
        const filtered = all.filter(item => item.name.includes(keyword));
        const pageNumber = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 25);
        return ok({ items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), total: filtered.length, page: pageNumber, pageSize, timestamp: stamp });
      }
      if (path === '/api/resources/pod/entry-pod-1/detail') return ok(podDetail);
      unexpected.push(path);
      return route.fulfill({ status: 500, json: { message: `Missing list entry fixture ${path}` } });
    });
    try {
      await page.goto(`${origin}/clusters`, { waitUntil: 'domcontentloaded' });
      const table = page.locator('.resource-table-shell').first();
      const clusterLink = table.locator('a:visible').filter({ hasText: /^entry-cluster-01$/ }).first();
      await clusterLink.waitFor();
      assert.ok(reads.some(read => read.path === '/api/clusters' && read.params.pageSize === '25'));
      const search = table.getByRole('textbox', { name: '搜索资源', exact: true });
      await search.fill('entry-cluster-26');
      await table.locator('a:visible').filter({ hasText: /^entry-cluster-26$/ }).first().waitFor();
      await clusterLink.waitFor({ state: 'hidden' });
      await search.fill(''); await clusterLink.waitFor();
      await page.locator('.ant-pagination-next:visible:not(.ant-pagination-disabled)').waitFor();
      await page.locator('.ant-pagination-next:visible').click();
      await table.locator('a:visible').filter({ hasText: /^entry-cluster-26$/ }).first().waitFor();
      assert.ok(reads.some(read => read.path === '/api/clusters' && read.params.page === '2'));
      await page.locator('.ant-pagination-prev:visible').click(); await clusterLink.waitFor();
      await search.fill('entry-cluster-01'); await clusterLink.waitFor();
      for (const [status, title, visible] of [[503, '集群刷新失败，当前内容可能已过期', true], [403, '集群访问权限校验失败', false], [503, '集群加载失败', false], [200, '', true]]) {
        clusterStatus = status;
        await page.getByRole('button', { name: '刷新页面', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
        if (status !== 200) await page.getByText(title, { exact: true }).waitFor();
        await clusterLink.waitFor({ state: visible ? 'visible' : 'hidden' });
        assert.equal(await search.inputValue(), 'entry-cluster-01', 'cluster refresh must preserve the search scope');
      }
      await search.fill(''); await clusterLink.waitFor();
      await clusterLink.click();
      await page.waitForURL(`**/clusters/${clusterId}/overview`);
      if(width===390) await page.getByRole('link',{name:'集群',exact:true}).click();
      else await page.getByRole('button', { name: '返回集群列表', exact: true }).click();
      await page.waitForURL('**/clusters');
      await clusterLink.waitFor(); await clusterLink.click();
      await page.waitForURL(`**/clusters/${clusterId}/overview`);
      if (width === 390) {
        await page.getByRole('button', { name: '打开集群工作区导航', exact: true }).click();
        await page.locator('.ant-dropdown:visible .ant-dropdown-menu-submenu-title').filter({ hasText: '工作负载' }).hover();
        await page.getByRole('menuitem', { name: 'Pod', exact: true }).click();
      } else {
        const podLink = page.getByRole('link', { name: 'Pod', exact: true });
        if (!await podLink.isVisible()) await page.locator('.cluster-workspace-menu .ant-menu-submenu-title').filter({ hasText: '工作负载' }).click();
        await podLink.click();
      }
      await page.waitForURL(`**/clusters/${clusterId}/workloads/pods`);
      const podTable = page.locator('.resource-table-shell').first();
      const podName = podTable.locator('a:visible,button:visible').filter({ hasText: /^entry-pod-01$/ }).first();
      await podName.waitFor();
      assert.ok(reads.some(read => read.path === '/api/workloads' && read.params.clusterId === clusterId && read.params.pageSize === '25'));
      await page.getByRole('combobox', { name: '选择命名空间', exact: true }).click();
      await page.locator('.ant-select-item-option-content').getByText('empty', { exact: true }).click();
      await podName.waitFor({ state: 'hidden' });
      assert.ok(reads.some(read => read.path === '/api/workloads' && read.params.namespace === 'empty'));
      await page.getByRole('combobox', { name: '选择命名空间', exact: true }).click();
      await page.locator('.ant-select-item-option-content').getByText('prod', { exact: true }).click();
      await podName.waitFor();
      const podSearch = podTable.getByRole('textbox', { name: '搜索资源', exact: true });
      await podSearch.fill('entry-pod-26');
      await podTable.locator('a:visible,button:visible').filter({hasText:/^entry-pod-26$/}).first().waitFor();
      await podName.waitFor({ state: 'hidden' });
      await podSearch.fill(''); await podName.waitFor();
      await page.locator('.ant-pagination-next:visible:not(.ant-pagination-disabled)').waitFor();
      await page.locator('.ant-pagination-next:visible').click();
      await podTable.locator('a:visible,button:visible').filter({hasText:/^entry-pod-26$/}).first().waitFor();
      await page.locator('.ant-pagination-prev:visible').click(); await podName.waitFor();
      await podSearch.fill('entry-pod-01'); await podName.waitFor();
      for (const [status, title, visible] of [[503, 'Pod刷新失败，当前内容可能已过期', true], [403, 'Pod访问权限校验失败', false], [503, 'Pod加载失败', false], [200, '', true]]) {
        podStatus = status;
        await page.getByRole('button', { name: '刷新页面', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
        if (status !== 200) await page.getByText(title, { exact: true }).waitFor();
        await podName.waitFor({ state: visible ? 'visible' : 'hidden' });
        assert.equal(await podSearch.inputValue(), 'entry-pod-01', 'refresh must preserve the search scope');
      }
      await podSearch.fill(''); await podName.waitFor();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('keyword'));
      const baseline = page.url();
      await podName.click();
      const drawer = page.locator('.resource-detail-drawer-wrapper').last();
      await drawer.waitFor();
      await drawer.getByText('entry-pod-01', { exact: true }).first().waitFor();
      assert.equal(await podSearch.inputValue(), '');
      assert.equal(await podTable.locator('a:visible,button:visible').filter({hasText:/^entry-pod-02$/}).first().isVisible(), true, 'opening detail preserves the list');
      await drawer.locator('.ant-drawer-close').click();
      await drawer.waitFor({ state: 'hidden' });
      assert.equal(page.url(), baseline, 'closing detail restores the original resource URL');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page cannot overflow horizontally');
      assert.deepEqual(writes, [], 'no test may reach a mutating API');
      assert.deepEqual(unexpected, [], 'every external request has an explicit fixture');
      assert.deepEqual(errors, []);

      await page.goto(`${origin}/clusters/${clusterId}/namespaces`, { waitUntil: 'domcontentloaded' });
      const namespaceTable = page.locator('.resource-table-shell').first();
      const namespaceRow = namespaceTable.getByRole('button', { name: 'prod', exact: true });
      await namespaceRow.waitFor();
      assert.ok(reads.some(read => read.path === '/api/namespaces' && read.params.clusterId === clusterId));
      for (const [status, title, visible] of [[503, 'Namespace刷新失败，当前内容可能已过期', true], [403, 'Namespace访问权限校验失败', false], [503, 'Namespace加载失败', false], [200, '', true]]) {
        namespaceStatus = status;
        await page.getByRole('button', { name: '刷新页面', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
        if (status !== 200) await page.getByText(title, { exact: true }).waitFor();
        await namespaceRow.waitFor({ state: visible ? 'visible' : 'hidden' });
      }
      namespaceEmpty = true;
      await page.getByRole('button', { name: '刷新页面', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
      await page.getByText('暂无资源数据', { exact: true }).waitFor();

      await page.goto(`${origin}/clusters/${clusterId}/nodes`, { waitUntil: 'domcontentloaded' });
      const nodeTable = page.locator('.resource-table-shell').first();
      const nodeRow = nodeTable.locator('a:visible').filter({ hasText: /^node-01$/ }).first();
      await nodeRow.waitFor();
      assert.ok(reads.some(read => read.path === `/api/clusters/${clusterId}/nodes` && read.status === 200));
      for (const [status, title, visible] of [[503, '工作节点刷新失败，当前内容可能已过期', true], [403, '工作节点访问权限校验失败', false], [503, '工作节点加载失败', false], [200, '', true]]) {
        nodeStatus = status;
        await page.getByRole('button', { name: '刷新页面', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
        if (status !== 200) await page.getByText(title, { exact: true }).waitFor();
        await nodeRow.waitFor({ state: visible ? 'visible' : 'hidden' });
      }
      nodesEmpty = true;
      await page.getByRole('button', { name: '刷新页面', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
      await page.getByText('暂无符合条件的工作节点', { exact: true }).waitFor();
      assert.deepEqual(writes, [], 'Namespace and Node scenarios must remain read-only');
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
      checks++;
      console.log(`PASS list entries ${theme} ${width}px: clusters, Pod, Namespace and Node list boundaries`);
    } catch (error) {
      console.error(JSON.stringify({ theme, width, reads, unexpected, errors, pagination: await page.locator('.ant-pagination').allTextContents() }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  console.log(`PASS ${checks} actual Next list-entry cases; HTTP writes and WebSockets isolated`);
} finally { await browser.close(); }
