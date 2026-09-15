import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.BASELINE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.BASELINE_URL || 'http://localhost:3000';
const out = resolve(process.env.BASELINE_OUTPUT || '../tmp/console-baseline');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const results = [];
let errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir(out, { recursive: true });
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /登录控制台/ }).waitFor();
  await page.locator('input').nth(0).fill(process.env.BASELINE_USER || 'admin@local.dev');
  await page.locator('input[type=password]').fill(process.env.BASELINE_PASSWORD || 'admin123456');
  await page.getByRole('button', { name: /登录控制台/ }).click();
  await page.getByText('进入集群工作区', { exact: true }).waitFor();
  const clusterId = process.env.BASELINE_CLUSTER || 'cms2ikyur0004u3v8cyyafy96';
  const routes = [
    ['home', '/'], ['clusters', '/clusters'], ['authorization', '/authorization'],
    ['settings', '/settings'], ['settings-ai', '/settings/ai'],
    ['pods', `/clusters/${clusterId}/workloads/pods`],
    ['deployments', `/clusters/${clusterId}/workloads/deployments`],
    ['services', `/clusters/${clusterId}/network/services`],
    ['pv', `/clusters/${clusterId}/storage/pv`],
    ['monitoring', `/clusters/${clusterId}/monitoring`],
    ['logs', `/clusters/${clusterId}/logs`], ['terminal', `/clusters/${clusterId}/terminal`],
  ];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('kubenova-theme-mode', value), theme);
    for (const [name, route] of routes) {
      errors = [];
      const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor({ timeout: 10000 }).catch(() => {});
      await page.locator('.bootstrap-screen').waitFor({ state: 'hidden', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
      const measurement = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')).filter((el) => el.getBoundingClientRect().height > 0);
        return {
          theme: document.documentElement.dataset.theme,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          buttonHeights: [...new Set(buttons.map((el) => Math.round(el.getBoundingClientRect().height)))].sort((a,b) => a-b),
          unlabeledButtons: buttons.filter((el) => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')).length,
          headings: Array.from(document.querySelectorAll('h1,h2')).map((el) => el.textContent),
        };
      });
      await page.screenshot({ path: resolve(out, `${name}-${theme}.png`) });
      const result = { name, route, status: response.status(), ...measurement, errors: [...errors] };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, route] of routes.filter(([name]) => ['home', 'pods', 'monitoring', 'logs', 'terminal'].includes(name))) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    await page.locator('main').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.locator('.bootstrap-screen').waitFor({ state: 'hidden', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await page.screenshot({ path: resolve(out, `${name}-mobile.png`) });
    results.push({ name, viewport: 'mobile', overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
  }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
