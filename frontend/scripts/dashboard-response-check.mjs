import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['malformed', 'valid', 'scoped']) {
    const valid = mode !== 'malformed';
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      for (const [key, value] of Object.entries({ access: 'fixture-access', refresh: 'fixture-refresh', user: 'fixture-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    });
    let requested = false;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: [], total: 0 };
      if (path.endsWith('/auth/me')) data = { user: { username: 'fixture-admin', role: 'admin' } };
      if (path === '/api/capabilities') data = [];
      if (path.includes('/dashboard/stats')) {
        requested = true;
        data = valid ? { clusters: { total: 17, healthy: 17, warning: 0 }, workloads: { total: 0, healthy: 0, unhealthy: 0 }, alerts: { critical: 0, warning: 0, total: 0 }, namespaces: 0 } : { items: [] };
        if (mode === 'scoped') {
          data.healthScore = 0;
          data.workloads = { total: 23, healthy: 23, unhealthy: 0 };
          const available = { freshness: 'fresh', capturedAt: new Date().toISOString(), source: 'control-plane-cache' };
          const unavailable = { freshness: 'unavailable', capturedAt: null, source: 'none', degradedReason: '仅统计授权命名空间' };
          data.metrics = { clusters: available, namespaces: available, workloads: available, pods: available, alerts: unavailable, healthScore: unavailable };
        }
      }
      return route.fulfill({ json: { data } });
    });
    await page.goto('http://127.0.0.1:3000/');
    if (valid) await page.getByText('17', { exact: true }).first().waitFor();
    else await page.getByText('仪表盘数据格式异常，请刷新重试', { exact: true }).waitFor();
    assert.ok(requested);
    assert.deepEqual(errors, []);
    assert.equal(await page.getByText('仪表盘数据加载失败', { exact: true }).count(), valid ? 0 : 1);
    if (mode === 'scoped') {
      await page.getByText('活跃告警 --', { exact: true }).waitFor();
      await page.getByText('风险分 --', { exact: true }).waitFor();
      await page.getByText('23', { exact: true }).first().waitFor();
      assert.equal(await page.getByText('100 / 100', { exact: true }).count(), 0);
      assert.equal(await page.getByText('稳定', { exact: true }).count(), 0);
    }
    await page.close();
  }
  console.log('PASS malformed response recovery, valid counts, and scoped unavailable metrics without false zero/health values');
} finally { await browser.close(); }
