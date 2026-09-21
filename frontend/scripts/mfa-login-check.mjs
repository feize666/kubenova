import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let acceptCode = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/login') || path.endsWith('/oidc/exchange')) return route.fulfill({ json: { data: { mfaRequired: true, challengeToken: 'a'.repeat(43), expiresIn: 300 } } });
    if (path.endsWith('/mfa/verify')) {
      assert.deepEqual(route.request().postDataJSON(), { challengeToken: 'a'.repeat(43), code: '123456', method: 'totp' });
      return acceptCode
        ? route.fulfill({ json: { data: { accessToken: 'test-access', refreshToken: 'test-refresh', user: { username: 'mfa-test', role: 'user' }, expiresAt: new Date(Date.now() + 600000).toISOString() } } })
        : route.fulfill({ status: 401, json: { message: 'Invalid verification code' } });
    }
    return route.fulfill({ json: { data: { enabled: false } } });
  });
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/login');
  await page.getByLabel('账号', { exact: true }).fill('mfa-test');
  await page.getByLabel('密码', { exact: true }).fill('test-only-password');
  await page.locator('button[type="submit"]').click();
  await page.getByLabel('验证码', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByLabel('密码', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes('a'.repeat(43))), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('aiops_auth_access') || sessionStorage.getItem('aiops_auth_session_access')), null);
  await page.screenshot({ path: '/tmp/kubenova-mfa-challenge.png', fullPage: true });
  await page.getByLabel('验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并登录', exact: true }).click();
  await page.getByLabel('密码', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '');
  assert.equal(new URL(page.url()).pathname, '/login');
  console.log('PASS MFA challenge does not authenticate or persist secrets; rejected one-use challenge returns to fresh login');
  acceptCode = true;
  await page.goto('http://127.0.0.1:3000/login/oidc?code=test-only&state=test-only');
  await page.getByLabel('验证码', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('aiops_auth_session_access')), null);
  await page.getByLabel('验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '验证并登录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3000/');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('aiops_auth_session_access')), 'test-access');
  assert.equal(await page.evaluate(() => localStorage.getItem('aiops_auth_access')), null);
  console.log('PASS OIDC challenge routes to verification; only verified response installs session tokens');
} finally { await browser.close(); }
