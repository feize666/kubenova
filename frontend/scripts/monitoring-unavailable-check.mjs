import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  for (const score of [null, 0]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      for (const [key, value] of Object.entries({ access: 'fixture-access', refresh: 'fixture-refresh', user: 'fixture-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data = { items: [], total: 0 };
      if (path.endsWith('/auth/me')) data = { user: { username: 'fixture-admin', role: 'admin' } };
      if (path === '/api/capabilities') data = [];
      if (path.endsWith('/observability/summary')) data = { range: '24h', timestamp: new Date().toISOString(), healthScore: score, activeAlerts: { critical: 0, warning: 0, total: 0 }, sourceStatus: [], entities: [], signalPanels: [], recentEvents: [], externalLinks: [], timeRange: { from: '', to: '' }, degraded: true };
      return route.fulfill({ json: { data } });
    });
    await page.goto('http://127.0.0.1:3000/clusters/fixture-cluster/observability');
    const metric = page.locator('.ops-metric-tile').filter({ has: page.getByText('健康分', { exact: true }) });
    await metric.waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await metric.locator('.ops-metric-tile__value-main').innerText(), score === null ? '--' : '0');
    assert.equal(await metric.getAttribute('data-tone'), score === null ? 'neutral' : 'success');
    assert.equal(await metric.locator('.ops-metric-tile__value-suffix').count(), score === null ? 0 : 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS unavailable health is neutral --; real zero retained; no page errors (mocked API)');
} finally { await browser.close(); }
