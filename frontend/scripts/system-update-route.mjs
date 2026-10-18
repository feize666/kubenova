import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.UPDATE_QA_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [], missingAssets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/_next/static/') && !response.ok()) missingAssets.push(response.url());
  });
  const login = await page.request.post(base + '/api/v1/auth/login', { data: {
    username: process.env.UI_TECH_USER || 'admin@local.dev', password: process.env.UI_TECH_PASS || 'admin123456',
  }});
  assert.ok(login.ok(), 'real API login must succeed');
  const envelope = await login.json(), auth = envelope.data ?? envelope;
  assert.ok(auth.accessToken, 'real API must return an access token');
  await page.addInitScript(data => {
    localStorage.setItem('aiops_auth_access', data.accessToken);
    localStorage.setItem('aiops_auth_user', data.user.username);
    localStorage.setItem('aiops_auth_role', data.user.role);
    localStorage.setItem('aiops_auth_expires_at', data.expiresAt);
  }, auth);
  await page.goto(base + '/settings/update');
  await page.getByRole('heading', { name: '系统更新', exact: true }).waitFor();
  await page.getByText('当前运行版本', { exact: true }).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('在线升级'));
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/system/update/check') && response.request().method() === 'POST', { timeout: 30000 }),
    page.getByRole('button', { name: '检查更新', exact: true }).click(),
  ]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `update route must fit ${width}px`);
  }
  for (const endpoint of ['status', 'releases', 'history']) {
    const response = await page.request.get(base + '/api/system/update/' + endpoint, { headers: { authorization: 'Bearer ' + auth.accessToken } });
    assert.ok(response.ok(), `${endpoint} must return an authorized response`);
  }
  await page.route('**/api/system/update/*', route => route.fulfill({ status: 503, json: { message: 'Update API unavailable in regression fixture' } }));
  await page.reload();
  await page.getByText('未能确认最新版本', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText('操作记录读取失败', { exact: true }).evaluate(node => node.scrollIntoView({ block: 'center' }));
  await page.getByText('操作记录读取失败', { exact: true }).waitFor();
  assert.ok(await page.getByRole('heading', { name: '系统更新', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  assert.deepEqual(missingAssets, []);
  console.log('PASS real update route: login, rendered page, forced check, desktop/mobile, API reads, explicit 503 errors, no JS errors or missing assets');
} finally { await browser.close(); }
