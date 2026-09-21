import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASELINE_URL || 'http://localhost:3000';
const out = resolve('../tmp/console-stage2');
const cluster = process.env.BASELINE_CLUSTER || 'cms2ikyur0004u3v8cyyafy96';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
async function ready(path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.locator('.bootstrap-screen').waitFor({ state: 'hidden' });
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
}
async function check(name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, `${name}: horizontal overflow`);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  results.push({ name, overflow });
}
try {
  await mkdir(out, { recursive: true });
  if (process.env.SHELL_MOCK_AUTH === '1') {
    await page.addInitScript(() => {
      for (const [key, value] of Object.entries({ access: 'shell-fixture', refresh: 'fixture-refresh', user: 'fixture-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      // Malformed successful responses must show the dashboard error state, not crash the shell.
      if (path.includes('/dashboard')) return route.fulfill({ json: { data: { items: [] } } });
      let data = { items: [], total: 0 };
      if (path.endsWith('/auth/me')) data = { user: { username: 'fixture-admin', role: 'admin' } };
      if (path === '/api/capabilities') data = [];
      if (path === `/api/clusters/${cluster}`) data = { id: cluster, name: 'Fixture cluster', runtimeStatus: 'running', nodeSummary: { items: [], total: 0 }, platform: {}, metadata: {} };
      return route.fulfill({ json: { data } });
    });
    await page.goto(base);
  } else {
  assert.ok(process.env.BASELINE_USER && process.env.BASELINE_PASSWORD, 'Explicit test credentials or SHELL_MOCK_AUTH=1 required');
  await page.goto(base);
  await page.locator('input').nth(0).fill(process.env.BASELINE_USER || 'admin@local.dev');
  await page.locator('input[type=password]').fill(process.env.BASELINE_PASSWORD || 'admin123456');
  await page.getByRole('button', { name: /登录控制台/ }).click();
  await page.getByText('进入集群工作区', { exact: true }).waitFor();
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      localStorage.setItem('kubenova-theme-mode', value);
      localStorage.setItem('kubenova.sidebar.collapsed', 'false');
    }, theme);
    await ready('/');
    await page.getByRole('button', { name: '收起侧边导航', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('.app-sidebar').getBoundingClientRect().width - 72) < 1);
    await check(`home-collapsed-${theme}`);
    await ready(`/clusters/${cluster}/workloads/pods`);
    await page.getByRole('button', { name: '展开侧边导航', exact: true }).waitFor();
    assert.equal(Math.round(await page.locator('.app-sidebar').evaluate(el => el.getBoundingClientRect().width)), 72);
    await check(`pods-collapsed-${theme}`);
    await page.getByRole('button', { name: '展开侧边导航', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('.app-sidebar').getBoundingClientRect().width - 248) < 1);
    await check(`pods-expanded-${theme}`);
    for (const kind of ['logs', 'terminal']) {
      await ready(`/clusters/${cluster}/${kind}`);
      assert.equal(await page.locator('.app-sidebar').count(), 0);
      await page.getByRole('button', { name: /返回资源/ }).waitFor();
      assert.equal(await page.locator('.runtime-status-strip').count(), 1);
      await check(`${kind}-${theme}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(`/clusters/${cluster}/workloads/pods`);
  const duration = await page.locator('.app-sidebar').evaluate(el => getComputedStyle(el).transitionDuration);
  assert.ok(duration.split(',').every(value => parseFloat(value) === 0), `reduced motion: ${duration}`);
  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['workloads/pods', 'logs', 'terminal']) {
      await ready(`/clusters/${cluster}/${path}`);
      await check(`${path.replaceAll('/', '-')}-${width}`);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ results, errors, reducedMotion: duration }, null, 2));
  console.log(JSON.stringify({ samples: results.length, errors, reducedMotion: duration }));
} catch (error) {
  console.error(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 1800) }));
  throw error;
} finally {
  await browser.close();
}
