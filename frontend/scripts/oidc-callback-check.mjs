import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  for (const enabled of [false, true]) {
    const context = await browser.newContext();
    const loginPage = await context.newPage();
    await loginPage.route('**/api/v1/auth/oidc/status', route => route.fulfill({ json: { data: { enabled } } }));
    await loginPage.goto('http://127.0.0.1:3000/login');
    await loginPage.waitForLoadState('networkidle');
    const link = loginPage.getByRole('button', { name: /企业单点登录/ });
    assert.equal(await link.count(), enabled ? 1 : 0);
    if (enabled) {
      await loginPage.route('**/api/v1/auth/oidc/prepare', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
      await link.click();
      await loginPage.getByText('企业登录暂不可用，请稍后重试或联系管理员。', { exact: true }).waitFor();
      assert.equal(new URL(loginPage.url()).pathname, '/login');
      assert.equal(await link.isEnabled(), true);
    }
    await context.close();
  }
  console.log('PASS login shows SSO only when the provider is enabled');
  const page = await browser.newPage();
  let exchanges = 0;
  await page.route('**/api/v1/auth/oidc/exchange', async route => {
    exchanges++;
    assert.equal(route.request().method(), 'POST');
    assert.ok(route.request().postDataJSON().callbackUrl.includes('code=test-code'));
    await route.fulfill({ json: { accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: new Date(Date.now() + 600000).toISOString(), user: { username: 'oidc-test', role: 'user' } } });
  });
  await page.goto('http://127.0.0.1:3000/login/oidc?code=test-code&state=test-state');
  await page.waitForURL('http://127.0.0.1:3000/', { timeout: 15000 });
  assert.equal(exchanges, 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('aiops_auth_session_access')), 'test-access');
  assert.equal(await page.evaluate(() => localStorage.getItem('aiops_auth_access')), null);
  assert.ok(!page.url().includes('test-code'));
  console.log('PASS OIDC callback exchanges once, stores a session and removes the authorization code from the URL');
} finally { await browser.close(); }
