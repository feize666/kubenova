import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Exercise the built Next route; every API and runtime socket is isolated.
const origin = process.env.RUNTIME_QA_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
const cases = [
  { name: 'wrapped desktop', viewport: { width: 1440, height: 900 }, json: false },
  { name: 'wrapped mobile', viewport: { width: 390, height: 844 }, json: false },
  { name: 'formatted JSON', viewport: { width: 1000, height: 800 }, json: true },
];

try {
  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: scenario.viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], unexpected = [], sockets = [], sessions = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(() => {
      for (const [key, value] of Object.entries({ aiops_auth_access: 'runtime-qa', aiops_auth_user: 'Runtime QA', aiops_auth_role: 'admin', aiops_auth_expires_at: '2030-01-01T00:00:00Z' })) localStorage.setItem(key, value);
      localStorage.setItem('kubenova.console.utility-sidebar.collapsed', '1');
    });
    await context.routeWebSocket('**/*', socket => {
      if (socket.url() === `${origin.replace(/^http/, 'ws')}/qa-logs`) sockets.push(socket);
      else socket.close();
    });
    await context.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const fulfill = data => route.fulfill({ json: { data } });
      if (path === '/api/logs/stream' && request.method() === 'POST') {
        sessions.push(request.postDataJSON());
        return fulfill({ sessionId: 'qa-session', gatewayWsUrl: `${origin.replace(/^http/, 'ws')}/qa-logs`, sessionState: 'ready', target: { clusterId: 'fixture-cluster', namespace: 'prod', pod: 'qa-pod', container: 'main', availableContainers: ['main'] } });
      }
      if (request.method() !== 'GET') {
        unexpected.push(`${request.method()} ${path}`);
        return route.abort();
      }
      if (path === '/api/v1/auth/me') return fulfill({ user: { username: 'Runtime QA', role: 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path === '/api/capabilities' || path === '/api/ai-assistant/sessions') return fulfill([]);
      if (path === '/api/clusters') return fulfill({ items: [{ id: 'fixture-cluster', name: 'Fixture', state: 'active', hasKubeconfig: true }], total: 1 });
      if (path === '/api/cluster-health') return fulfill({ items: [{ clusterId: 'fixture-cluster', runtimeStatus: 'running' }] });
      if (path === '/api/system/update/status') return fulfill({ updateAvailable: false });
      if (path === '/api/v1/clusters/events/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': QA fixture\n\n' });
      if (path === '/api/logs') return fulfill({ items: [], total: 0 });
      unexpected.push(`${request.method()} ${path}`);
      return route.abort();
    });
    try {
      await page.goto(`${origin}/logs?clusterId=fixture-cluster&namespace=prod&pod=qa-pod&container=main`, { waitUntil: 'networkidle' });
      await page.locator('.logs-workbench-shell.ops-frame-shell--streaming').waitFor();
      assert.equal(sockets.length, 1);
      if (scenario.json) await page.getByRole('switch', { name: '启用日志格式化' }).click();
      const records = Array.from({ length: 6200 }, (_, index) => {
        const record = `retained-${String(index).padStart(5, '0')}`;
        return scenario.json ? JSON.stringify({ record, message: 'historical payload', status: 'INFO' }) : `${record} ${'x'.repeat(500)}`;
      });
      sockets[0].send(JSON.stringify({ type: 'log', content: records.join('\n') }));
      await page.waitForFunction(() => document.querySelector('.runtime-status-strip')?.textContent?.includes('6000/6000'));
      await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('retained-06199'));
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载日志' }).click()]);
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const downloaded = Buffer.concat(chunks).toString();
      assert.match(downloaded, /retained-00200/);
      assert.doesNotMatch(downloaded, /retained-00199/);
      await page.getByRole('button', { name: '查找日志' }).click();
      const search = page.getByPlaceholder('查找', { exact: true });
      await search.fill('retained-00200');
      await page.getByText('已定位到匹配项', { exact: true }).waitFor();
      await search.fill('retained-00199');
      await page.getByText('暂无结果', { exact: true }).waitFor();
      for (let batch = 0; batch < 5; batch += 1) {
        sockets[0].send(JSON.stringify({ type: 'log', content: Array.from({ length: 25 }, (_, index) => `burst-${batch}-${index}`).join('\n') }));
      }
      await page.getByRole('button', { name: '查看 125 条新日志并恢复滚动跟随' }).waitFor();
      await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('retained-00325'));
      await search.fill('retained-00200');
      await page.getByText('暂无结果', { exact: true }).waitFor();
      await search.fill('retained-00325');
      await page.getByText('已定位到匹配项', { exact: true }).waitFor();
      assert.equal(sessions.length, 1, 'local rendering must not recreate the log session');
      assert.deepEqual(unexpected, []);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log(`PASS ${scenario.name}: retained records searchable and downloadable, expired records absent after burst`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
