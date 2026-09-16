import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASELINE_URL || 'http://localhost:3000';
const clusterId = process.env.BASELINE_CLUSTER || 'cms2ikyur0004u3v8cyyafy96';
const out = resolve('../tmp/log-center-check');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let queries = [];
let sourceMode = 'ready';
let queryMode = 'success';
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
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).waitFor({ timeout: 15000 });
  await page.locator('input').nth(0).fill(process.env.BASELINE_USER || 'admin@local.dev');
  await page.locator('input[type=password]').fill(process.env.BASELINE_PASSWORD || 'admin123456');
  await page.getByRole('button', { name: /登录控制台/ }).click();
  await page.getByText('进入集群工作区', { exact: true }).waitFor();
  await ready();
  await page.getByRole('heading', { name: '日志中心', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'real-unconfigured.png') });

  await page.route('**/api/observability/data-sources?**', async route => {
    if (sourceMode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'unavailable' }) });
    const items = sourceMode === 'empty' ? [] : [
      { id: 'fixture-source', clusterId, kind: 'elasticsearch', name: 'Browser test source', enabled: true, status: 'unknown', endpoint: 'https://es.example.test', secretRef: 'env:KUBENOVA_ES_API_KEY_PRIMARY', metadata: { retainedSetting: 'preserve', logQuery: { indexPattern: 'logs-*', clusterField: 'tenant.cluster', namespaceField: 'tenant.namespace' } } },
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
    assert.ok(Date.parse(input.to) - Date.parse(input.from) <= 86400000);
    if (queryMode === 'slow') {
      startedSlow?.();
      await new Promise(resolve => { releaseSlow = resolve; });
      await route.fulfill(json({ rows: [{ ...rows[0], message: 'OBSOLETE RESPONSE' }] })).catch(() => {});
    } else if (queryMode === 'error') {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'unavailable' }) });
    } else {
      await route.fulfill(json({ rows: queryMode === 'empty' ? [] : rows }));
    }
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('kubenova-theme-mode', value), theme);
    await ready();
    await page.getByText('尚未查询', { exact: true }).waitFor();
    const namespaceBox = await page.locator('.namespace-filter-select').boundingBox();
    const searchBox = await page.getByRole('textbox', { name: '搜索日志文本' }).locator('..').boundingBox();
    assert.ok(Math.abs(namespaceBox.y - searchBox.y) < 5, `desktop namespace and search must share a toolbar row: ${JSON.stringify({ namespaceBox, searchBox })}`);
    const prior = queries.length;
    await page.getByRole('button', { name: /查询$/ }).click();
    await page.getByText('browser-fixture', { exact: true }).waitFor();
    assert.equal(queries.length, prior + 1);
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
  assert.deepEqual(errors, []);
  const report = { mockedQueries: queries.length, errors, states: ['result', 'expanded', 'filter-reset', 'empty-result', 'query-error', 'no-source', 'source-error'], screenshots: 7, liveElasticsearch: false };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  releaseSlow?.();
  await browser.close();
}
