import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Catches losing the one-time result when revoked sessions trigger logout.
const browser = await chromium.launch({ headless: true });
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const recoveryCodes = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(32, '0'));
try {
  const passwordContext = await browser.newContext();
  const page = await passwordContext.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let refreshRoute;
  let refreshStarted;
  const refreshRequested = new Promise(resolve => { refreshStarted = resolve; });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('test-seeded')) {
      sessionStorage.setItem('test-seeded', '1');
      sessionStorage.setItem('aiops_auth_session_access', 'mock-access');
      sessionStorage.setItem('aiops_auth_session_user', 'mfa-test-only');
      sessionStorage.setItem('aiops_auth_session_role', 'user');
      sessionStorage.setItem('aiops_auth_session_refresh', 'mock-refresh');
    }
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/capabilities') return route.fulfill({ json: { data: [] } });
    if (path.endsWith('/auth/refresh')) { refreshRoute = route; refreshStarted(); return; }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { user: { username: 'mfa-test-only', role: 'user' } } });
    if (path.endsWith('/mfa/status')) return route.fulfill({ json: { enabled: false, passwordReauthenticationAvailable: true } });
    if (path.endsWith('/mfa/enrollment')) return route.fulfill({ json: { token: 'a'.repeat(43), secret, expiresIn: 300 } });
    if (path.endsWith('/mfa/enrollment/confirm')) {
      assert.deepEqual(route.request().postDataJSON(), { token: 'a'.repeat(43), code: '123456' });
      return route.fulfill({ json: { recoveryCodes } });
    }
    return route.fulfill({ json: { data: { items: [], enabled: false } } });
  });
  await page.goto('http://127.0.0.1:3000/profile');
  await page.getByLabel('当前密码', { exact: true }).fill('test-only-password', { timeout: 5000 });
  await page.getByRole('button', { name: '验证身份', exact: true }).click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aiops:auth-expired', { detail: { message: 'expired' } })));
  await refreshRequested;
  await page.getByLabel('验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '启用多因素验证', exact: true }).click();
  await page.getByRole('heading', { name: '保存恢复码' }).waitFor();
  await refreshRoute.fulfill({ json: { accessToken: 'stale-access', refreshToken: 'stale-refresh', user: { username: 'mfa-test-only', role: 'user' }, expiresAt: new Date(Date.now() + 600000).toISOString() } });
  const otherTab = await page.context().newPage();
  await otherTab.route('**/api/**', route => route.fulfill({ json: { data: { enabled: false } } }));
  await otherTab.goto('http://127.0.0.1:3000/login');
  await otherTab.evaluate(() => {
    localStorage.setItem('aiops_auth_access', 'other-tab-old-session');
    localStorage.removeItem('aiops_auth_access');
  });
  await otherTab.close();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('aiops:auth-expired', { detail: { message: 'expired' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'aiops_auth_access', storageArea: localStorage }));
  });
  await page.waitForTimeout(100);
  await page.getByText(recoveryCodes[0], { exact: true }).waitFor();
  const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  for (const value of ['mock-access', 'mock-refresh', 'stale-access', 'stale-refresh', secret, recoveryCodes[0], 'a'.repeat(43)]) assert.ok(!storage.includes(value));
  await page.screenshot({ path: '/tmp/kubenova-mfa-recovery.png', fullPage: true });
  await page.reload();
  await page.waitForURL(url => url.pathname === '/login');
  assert.equal(await page.getByText(recoveryCodes[0], { exact: true }).count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log('PASS personal enrollment keeps recovery in memory across expiry/logout; reload loses codes and requires login');
  for (const outcome of ['success', 'consumed', 'missing-session', 'wrong-purpose']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const oidcPage = await context.newPage();
    await oidcPage.addInitScript(({ outcome }) => {
      localStorage.setItem('kubenova-theme-mode', 'dark');
      if (outcome !== 'missing-session') {
        sessionStorage.setItem('aiops_auth_session_access', 'mock-oidc-access');
        sessionStorage.setItem('aiops_auth_session_user', 'mfa-test-only');
        sessionStorage.setItem('aiops_auth_session_role', 'user');
      }
      sessionStorage.setItem('kubenova_oidc_purpose', outcome === 'wrong-purpose' ? 'invalid' : 'enrollment');
    }, { outcome });
    let enrollmentExchanges = 0;
    let loginExchanges = 0;
    let enrollmentPrepares = 0;
    await oidcPage.route('https://identity.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Test identity provider</title>' }));
    await oidcPage.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/capabilities') return route.fulfill({ json: { data: [] } });
      if (path.endsWith('/auth/me')) return route.fulfill({ json: { user: { username: 'mfa-test-only', role: 'user' } } });
      if (path.endsWith('/mfa/status')) return route.fulfill({ json: { enabled: false, passwordReauthenticationAvailable: false } });
      if (path.endsWith('/oidc/exchange')) loginExchanges++;
      if (path.endsWith('/oidc/enrollment/prepare')) {
        enrollmentPrepares++;
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers().authorization, 'Bearer mock-oidc-access');
        return route.fulfill({ json: { url: 'https://identity.example.test/authorize' } });
      }
      if (path.endsWith('/oidc/enrollment/exchange')) {
        enrollmentExchanges++;
        assert.equal(route.request().headers().authorization, 'Bearer mock-oidc-access');
        assert.ok(route.request().postDataJSON().callbackUrl.includes('code=test-only'));
        return outcome === 'consumed' ? route.fulfill({ status: 401, json: { message: 'Consumed transaction' } }) : route.fulfill({ json: { token: 'b'.repeat(43), secret, expiresIn: 300 } });
      }
      if (path.endsWith('/mfa/enrollment/confirm')) return route.fulfill({ status: 401, json: { message: 'Invalid code' } });
      return route.fulfill({ json: { data: { items: [], enabled: true } } });
    });
    await oidcPage.goto('http://127.0.0.1:3000/login/oidc?code=test-only&state=test-only');
    if (outcome === 'success') {
      await oidcPage.getByLabel('验证码', { exact: true }).waitFor();
      assert.equal(await oidcPage.evaluate(() => sessionStorage.getItem('aiops_auth_session_user')), 'mfa-test-only');
      await oidcPage.screenshot({ path: '/tmp/kubenova-mfa-mobile.png', fullPage: true });
      assert.equal(await oidcPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await oidcPage.getByLabel('验证码', { exact: true }).fill('123456');
      await oidcPage.getByRole('button', { name: '启用多因素验证', exact: true }).click();
      await oidcPage.getByText(/启用失败或请求已失效/).waitFor();
      assert.equal(await oidcPage.getByText(secret, { exact: true }).count(), 0);
      assert.equal(await oidcPage.getByLabel('当前密码', { exact: true }).count(), 0);
      await oidcPage.getByRole('button', { name: '通过企业账号验证身份', exact: true }).click();
      await oidcPage.waitForURL('https://identity.example.test/authorize');
      assert.equal(enrollmentPrepares, 1);
    } else await oidcPage.getByText('身份验证失败', { exact: true }).waitFor();
    assert.equal(enrollmentExchanges, ['success', 'consumed'].includes(outcome) ? 1 : 0);
    assert.equal(loginExchanges, 0);
    assert.ok(!oidcPage.url().includes('test-only'));
    await context.close();
  }
  console.log('PASS OIDC enrollment preserves principal, never uses login exchange, rejects invalid routing/session/consumed transactions; failed OTP drops secret');
} finally { await browser.close(); }
