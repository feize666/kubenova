import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const requests = [];
const errors = [];
let receiverEnabled = false;
let receiverConfigured = false;
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    for (const [key, value] of Object.entries({ access: 'test-token', refresh: 'test-refresh', user: 'test-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) {
      sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    }
  });
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    let data = { items: [], total: 0 };
    if (path.endsWith('/auth/me')) data = { user: { id: 'admin-test', username: 'test-admin', role: 'admin' } };
    if (path === '/api/capabilities') data = [];
    if (/\/clusters\/[ab]$/.test(path)) data = { id: path.slice(-1), name: path.slice(-1), displayName: path.slice(-1), runtimeStatus: 'running', lastSyncTime: null, nodeSummary: { total: 0, ready: 0, notReady: 0, items: [], degraded: false, degradationReason: null }, platform: { cniPlugin: null, criRuntime: null, kubernetesVersion: 'v1.30.0' }, metadata: { environment: 'test', provider: 'custom', region: null, environmentType: null } };
    if (path.endsWith('/catalog')) data = { dataSourceKinds: [], notificationChannels: ['webhook', 'email'], defaults: {} };
    if (path.endsWith('/receiver/rotate')) { receiverEnabled = true; receiverConfigured = true; data = { token: 'test-once-only-receiver-token' }; }
    if (path.endsWith('/receiver')) {
      if (req.method() === 'DELETE') receiverEnabled = false;
      data = { configured: receiverConfigured, enabled: receiverEnabled, updatedAt: null };
    }
    if (path.endsWith('/deliveries')) {
      const second = url.searchParams.has('cursor');
      const failed = url.searchParams.get('status') === 'failed';
      data = { items: [{ id: second ? 'd2' : 'd1', alertTitle: failed ? 'Failure record' : second ? 'Second record' : 'First record', templateId: 'test-channel', event: 'firing', status: failed ? 'failed' : 'sent', attempts: 1, createdAt: new Date().toISOString(), error: failed ? 'Delivery failed' : null }], nextCursor: second || failed ? null : 'd1' };
    }
    if (path.includes('/notification-templates')) {
      const clusterId = url.searchParams.get('clusterId');
      const body = req.postData() ? req.postDataJSON() : null;
      requests.push({ method: req.method(), clusterId, body });
      const record = { id: `channel-${clusterId}`, clusterId, name: `channel-${clusterId}`, channel: 'webhook', endpoint: 'https://notify.invalid', bodyTemplate: '{}', enabled: true, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      data = req.method() === 'GET' ? { items: [record], total: 1 } : record;
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto('http://127.0.0.1:3000/clusters/a/observability/configuration');
  await page.getByRole('tab', { name: '通知模板', exact: true }).click();
  await page.getByRole('cell', { name: 'channel-a 启用', exact: true }).waitFor();
  await page.getByRole('button', { name: /添加通知模板/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('通知名称', { exact: true }).fill('unsaved-a');
  await page.evaluate(() => window.history.pushState({}, '', '/clusters/b/observability/configuration'));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '通知模板', exact: true }).click();
  await page.getByRole('cell', { name: 'channel-b 启用', exact: true }).waitFor();
  assert.equal(await page.getByText('channel-a', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /添加通知模板/ }).click();
  await page.getByLabel('通知名称', { exact: true }).fill('new-b');
  await page.getByLabel('Endpoint', { exact: true }).fill('https://notify.invalid');
  await page.getByRole('dialog').getByRole('button', { name: /^保\s*存$/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(requests.some(request => request.method === 'GET' && request.clusterId === 'a'));
  assert.ok(requests.some(request => request.method === 'GET' && request.clusterId === 'b'));
  const creates = requests.filter(request => request.method === 'POST');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.clusterId, 'b');
  assert.equal(creates[0].body.name, 'new-b');
  await page.getByRole('button', { name: /添加通知模板/ }).click();
  await page.getByLabel('通知名称', { exact: true }).fill('mail-b');
  await page.getByLabel('渠道', { exact: true }).click();
  await page.getByTitle('邮件', { exact: true }).click();
  await page.getByLabel('收件邮箱', { exact: true }).fill('not-an-email');
  await page.getByRole('dialog').getByRole('button', { name: /^保\s*存$/ }).click();
  await page.locator('.ant-form-item-explain-error').first().waitFor();
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  await page.getByLabel('收件邮箱', { exact: true }).fill('ops@example.com');
  await page.getByRole('dialog').getByRole('button', { name: /^保\s*存$/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(requests.some(request => request.method === 'POST' && request.body.channel === 'email' && request.body.endpoint === 'ops@example.com' && request.body.clusterId === 'b'));
  await page.getByRole('tab', { name: '投递记录', exact: true }).click();
  await page.getByRole('cell', { name: 'First record', exact: true }).waitFor();
  await page.getByRole('button', { name: '下一页投递记录', exact: true }).click();
  await page.getByRole('cell', { name: 'Second record', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '下一页投递记录', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '上一页投递记录', exact: true }).click();
  await page.getByRole('cell', { name: 'First record', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '投递状态', exact: true }).click();
  await page.getByTitle('投递失败', { exact: true }).click();
  await page.getByRole('cell', { name: 'Failure record', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '上一页投递记录', exact: true }).isDisabled(), true);
  if (process.env.NOTIFICATION_SCREENSHOT) await page.screenshot({ path: process.env.NOTIFICATION_SCREENSHOT, fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '告警接收', exact: true }).click();
  await page.getByRole('button', { name: /生成令牌/ }).click();
  await page.getByRole('button', { name: /确认生成/ }).click();
  await page.getByRole('dialog', { name: '新的接收令牌' }).waitFor();
  assert.equal(await page.getByLabel('新接收令牌', { exact: true }).inputValue(), 'test-once-only-receiver-token');
  await page.getByRole('dialog').getByRole('button', { name: /^关\s*闭$/ }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('新接收令牌', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /停用接收/ }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await page.getByText('已停用', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('test-once-only-receiver-token')), false);
  await page.getByRole('button', { name: /轮换令牌/ }).click();
  await page.getByRole('button', { name: /确认生成/ }).click();
  await page.getByRole('dialog', { name: '新的接收令牌' }).waitFor();
  await page.evaluate(() => window.history.pushState({}, '', '/clusters/a/observability/configuration'));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('新接收令牌', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS scoped notifications, email validation, history pagination/filter, receiver rotation/disable, token clearing/storage isolation (mocked API, port 3000)');
} catch (error) {
  console.error(errors);
  console.error(await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
