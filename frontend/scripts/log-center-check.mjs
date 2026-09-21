import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASELINE_URL || 'http://localhost:3000';
const isolated = process.env.LOG_CENTER_MOCK_AUTH === '1';
let fixtureRole = 'admin';
const clusterId = process.env.BASELINE_CLUSTER || 'cms2ikyur0004u3v8cyyafy96';
const out = resolve('../tmp/log-center-check');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let queries = [];
let sourceMode = 'ready';
let queryMode = 'success';
let previewDenied = false;
let previewInput;
let releaseSlow;
let startedSlow;
const rows = [{ id: 'test-row', timestamp: '2026-09-16T00:00:00Z', namespace: 'apps', pod: 'browser-fixture', container: 'main', message: 'BROWSER FIXTURE <script>text only</script>\nExpanded log message' }];
const json = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
async function ready() {
  await page.goto(`${base}/clusters/${clusterId}/log-center`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bootstrap-screen').waitFor({ state: 'hidden' });
}
try {
  await mkdir(out, { recursive: true });
  if (isolated) {
    await page.addInitScript(() => {
      for (const [key, value] of Object.entries({ access: 'fixture-token', refresh: 'fixture-refresh', user: 'fixture-admin', role: sessionStorage.getItem('aiops_auth_session_role') || 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: [], total: 0 };
      if (path.endsWith('/auth/me')) data = { user: { username: 'fixture-admin', role: fixtureRole } };
      if (path === '/api/capabilities') data = [];
      if (path === '/api/namespaces') data = { items: [{ id: 'namespace-apps', clusterId, clusterName: 'Fixture cluster', namespace: 'apps', state: 'Active', labels: {}, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z' }], total: 1, timestamp: '2026-09-16T00:00:00Z' };
      if (path === `/api/clusters/${clusterId}`) data = { id: clusterId, name: 'Fixture cluster', runtimeStatus: 'running', nodeSummary: { items: [], total: 0 }, platform: {}, metadata: {} };
      return route.fulfill(json(data));
    });
  } else {
  assert.ok(process.env.BASELINE_USER && process.env.BASELINE_PASSWORD, 'Supply explicit test credentials or LOG_CENTER_MOCK_AUTH=1');
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).waitFor({ timeout: 15000 });
  await page.locator('input').nth(0).fill(process.env.BASELINE_USER || 'admin@local.dev');
  await page.locator('input[type=password]').fill(process.env.BASELINE_PASSWORD || 'admin123456');
  await page.getByRole('button', { name: /登录控制台/ }).click();
  await page.getByText('进入集群工作区', { exact: true }).waitFor();
  }
  await ready();
  await page.getByRole('heading', { name: '日志中心', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, isolated ? 'fixture-unconfigured.png' : 'real-unconfigured.png') });

  await page.route('**/api/log-center/sources?**', async route => {
    assert.equal(new URL(route.request().url()).searchParams.get('clusterId'), clusterId);
    if (sourceMode === 'denied') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) });
    if (sourceMode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'unavailable' }) });
    const items = sourceMode === 'empty' ? [] : [
      { id: 'fixture-source', clusterId, kind: 'elasticsearch', name: 'Browser test source', enabled: true },
      { id: 'foreign', clusterId: 'foreign', kind: 'elasticsearch', name: 'Forbidden foreign source', enabled: true, status: 'unknown' },
      { id: 'global', kind: 'elasticsearch', name: 'Forbidden global source', enabled: true, status: 'unknown' },
    ];
    await route.fulfill(json({ items, total: items.length }));
  });
  await page.route('**/api/log-center/query', async route => {
    const input = route.request().postDataJSON();
    queries.push(input);
    assert.equal(input.clusterId, clusterId);
    assert.equal(input.dataSourceId, 'fixture-source');
    if (fixtureRole === 'viewer') assert.equal(input.namespace, 'apps');
    assert.ok(Date.parse(input.to) - Date.parse(input.from) <= 86400000);
    if (queryMode === 'slow') {
      startedSlow?.();
      await new Promise(resolve => { releaseSlow = resolve; });
      await route.fulfill(json({ rows: [{ ...rows[0], message: 'OBSOLETE RESPONSE' }] })).catch(() => {});
    } else if (queryMode === 'denied') {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) });
    } else if (queryMode === 'error') {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'unavailable' }) });
    } else {
      await route.fulfill(json({ rows: queryMode === 'empty' ? [] : rows }));
    }
  });
  for (const theme of ['light', 'dark']) {
    await page.route('**/api/log-center/collection/preview', route => {
      const input = route.request().postDataJSON();
      previewInput = input;
      assert.equal(input.clusterId, clusterId);
      assert.equal(input.dataSourceId, 'fixture-source');
      if (previewDenied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) });
      return route.fulfill(json({ image: 'filebeat:fixture', manifests: { apiVersion: 'v1', kind: 'List', items: [{ apiVersion: 'apps/v1', kind: 'DaemonSet', metadata: { name: 'kubenova-filebeat' } }] }, config: { trusted: true }, indexTemplate: { scope: clusterId }, lifecyclePolicy: { days: input.retentionDays }, logQuery: { namespaceUidField: 'kubernetes.namespace_uid' } }));
    });
    await page.evaluate(value => localStorage.setItem('kubenova-theme-mode', value), theme);
    await ready();
    await page.getByText('尚未查询', { exact: true }).waitFor();
    await page.getByRole('button', { name: '采集预览' }).click();
    await page.getByText('filebeat:fixture', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '保留策略', exact: true }).click();
    await page.getByRole('spinbutton', { name: '日志保留天数' }).fill('30');
    await page.getByRole('tabpanel').filter({ visible: true }).getByText(/"days": 30/).waitFor();
    const caName = page.getByRole('textbox', { name: 'CA Secret 名称', exact: true });
    await caName.fill('elastic-ca');
    await caName.press('Tab');
    await page.getByText('filebeat:fixture', { exact: true }).waitFor();
    assert.equal(previewInput.caSecretName, 'elastic-ca');
    await page.getByRole('tab', { name: '部署清单', exact: true }).click({ timeout: 5000 });
    await page.getByRole('tabpanel').filter({ visible: true }).getByText(/"kind": "DaemonSet"/).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => {
        const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return rect && rect.x >= 0 && rect.right <= innerWidth + 1;
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: resolve(out, `preview-${theme}-${width}.png`), animations: 'disabled' });
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1440, height: 900 });
    previewDenied = true;
    await page.getByRole('button', { name: '采集预览' }).click();
    await page.getByText('无法生成采集预览', { exact: true }).waitFor();
    assert.equal(await page.getByText('filebeat:fixture', { exact: true }).count(), 0);
    previewDenied = false;
    await page.getByRole('dialog').getByRole('button', { name: /重\s*试/ }).click();
    await page.getByText('filebeat:fixture', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const namespaceBox = await page.locator('.namespace-filter-select').boundingBox();
    const searchBox = await page.getByRole('textbox', { name: '搜索日志文本' }).locator('..').boundingBox();
    assert.ok(Math.abs(namespaceBox.y - searchBox.y) < 5, `desktop namespace and search must share a toolbar row: ${JSON.stringify({ namespaceBox, searchBox })}`);
    const prior = queries.length;
    await page.getByRole('textbox', { name: 'Pod 名称精确筛选' }).fill('browser-fixture');
    await page.getByRole('textbox', { name: '容器名称精确筛选' }).fill('main');
    await page.getByRole('button', { name: /查询$/ }).click();
    await page.getByText('browser-fixture', { exact: true }).waitFor();
    assert.equal(queries.length, prior + 1);
    assert.equal(queries.at(-1).pod, 'browser-fixture');
    assert.equal(queries.at(-1).container, 'main');
    await page.locator('.ant-table-row-expand-icon').click();
    await page.getByText(/Expanded log message/).last().waitFor();
    assert.equal(await page.locator('script').filter({ hasText: 'text only' }).count(), 0);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: resolve(out, `fixture-${theme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  queryMode = 'slow';
  const slowStarted = new Promise(resolve => { startedSlow = resolve; });
  await page.getByRole('button', { name: /查询$/ }).click();
  await slowStarted;
  await page.getByRole('textbox', { name: '搜索日志文本' }).fill('new filter');
  await page.getByText('尚未查询', { exact: true }).waitFor();
  releaseSlow();
  queryMode = 'empty';
  await page.getByRole('button', { name: /查询$/ }).click();
  await page.getByText('未找到匹配日志', { exact: true }).waitFor();
  assert.equal(await page.getByText('OBSOLETE RESPONSE', { exact: true }).count(), 0);
  queryMode = 'error';
  await page.getByRole('button', { name: /查询$/ }).click();
  await page.getByText('日志查询失败', { exact: true }).waitFor();
  sourceMode = 'empty';
  await ready();
  await page.getByText('当前集群未配置可用日志数据源', { exact: true }).waitFor();
  sourceMode = 'failure';
  await ready();
  await page.getByText('无法读取日志数据源', { exact: true }).waitFor();
  if (isolated) {
    fixtureRole = 'viewer';
    sourceMode = 'ready';
    queryMode = 'success';
    await page.evaluate(() => sessionStorage.setItem('aiops_auth_session_role', 'viewer'));
    await ready();
    await page.getByText('请选择命名空间', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /数据源配置/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '采集预览' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /查询$/ }).count(), 0);
    const beforeScoped = queries.length;
    await page.getByRole('combobox', { name: '选择命名空间' }).click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: /^apps$/ }).click();
    await page.getByText('尚未查询', { exact: true }).waitFor();
    assert.equal(queries.length, beforeScoped);
    await page.getByRole('button', { name: /查询$/ }).click();
    await page.getByText('browser-fixture', { exact: true }).waitFor();
    queryMode = 'denied';
    await page.getByRole('button', { name: /查询$/ }).click();
    await page.getByText('当前账号无日志查询权限', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '选择命名空间' }).click();
    await page.getByText('全部命名空间', { exact: true }).last().click();
    await page.getByText('请选择命名空间', { exact: true }).waitFor();
    assert.equal(await page.getByText('browser-fixture', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /查询$/ }).count(), 0);
    sourceMode = 'denied';
    await ready();
    await page.getByText('无法读取日志数据源', { exact: true }).waitFor();
    assert.equal(await page.getByText('当前集群未配置可用日志数据源', { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  const report = { mockedQueries: queries.length, errors, states: ['result', 'expanded', 'filter-reset', 'empty-result', 'query-error', 'no-source', 'source-error', ...(isolated ? ['reader-namespace-required', 'reader-scoped-query', 'reader-denied', 'source-denied'] : [])], screenshots: 7, liveElasticsearch: false };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  releaseSlow?.();
  await browser.close();
}
