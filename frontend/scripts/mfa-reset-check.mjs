import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  for (const oidc of [false, true]) {
    const context = await browser.newContext({ viewport: { width: oidc ? 390 : 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(oidc => {
      sessionStorage.setItem('aiops_auth_session_access', 'test-only-access');
      sessionStorage.setItem('aiops_auth_session_user', 'test-owner');
      sessionStorage.setItem('aiops_auth_session_role', 'admin');
      if (oidc) sessionStorage.setItem('kubenova_oidc_reset_target', 'target');
    }, oidc);
    let prepared = 0;
    let confirmed = 0;
    let loginExchange = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/capabilities') return route.fulfill({ json: { data: [] } });
      if (path.endsWith('/auth/me')) return route.fulfill({ json: { user: { username: 'test-owner', role: 'admin' } } });
      if (path.endsWith('/mfa/status')) return route.fulfill({ json: { enabled: true, canManageMfa: true, passwordReauthenticationAvailable: !oidc } });
      if (path === '/api/users/target') return route.fulfill({ json: { id: 'target', username: 'test-target', mfaEnabled: true } });
      if (path.endsWith('/mfa/reset/prepare') || path.endsWith('/mfa/reset/oidc/exchange')) {
        const body = route.request().postDataJSON();
        assert.equal(body.targetUserId, 'target'); assert.equal(body.code, '123456');
        if (oidc) assert.ok(body.callbackUrl.includes('code=test-code')); else assert.equal(body.password, 'test-password');
        prepared++;
        return route.fulfill({ json: { token: 'a'.repeat(43), expiresIn: 300 } });
      }
      if (path.endsWith('/mfa/reset/confirm')) { confirmed++; return route.fulfill({ json: { userId: 'target', mfaEnabled: false } }); }
      if (path.endsWith('/auth/oidc/exchange')) loginExchange++;
      return route.fulfill({ json: { data: { items: [], total: 0, enabled: false } } });
    });
    await page.goto(`http://127.0.0.1:3000${oidc ? '/login/oidc?code=test-code&state=test-state' : '/authorization/mfa-reset?target=target'}`);
    await page.getByRole('heading', { name: '重置多因素验证' }).waitFor();
    if (!oidc) await page.getByLabel('您的当前密码').fill('test-password');
    await page.getByLabel('验证码或恢复码').fill('123456');
    await page.getByRole('button', { name: '验证身份', exact: true }).click();
    await page.getByRole('button', { name: '确认重置 MFA', exact: true }).waitFor();
    assert.equal(prepared, 1); assert.equal(confirmed, 0); assert.equal(loginExchange, 0);
    const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    for (const value of ['test-password', '123456', 'a'.repeat(43), 'test-code']) assert.ok(!storage.includes(value));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/kubenova-reset-${oidc ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: '确认重置 MFA', exact: true }).click();
    await page.waitForURL('**/users');
    assert.equal(confirmed, 1); assert.deepEqual(errors, []);
    await context.close();
  }
  for (const mode of ['forbidden', 'wrong-password', 'expired-proof', 'mixed-purpose']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(mode => {
      sessionStorage.setItem('aiops_auth_session_access', 'test-access');
      sessionStorage.setItem('aiops_auth_session_user', 'test-owner');
      sessionStorage.setItem('aiops_auth_session_role', 'admin');
      if (mode === 'mixed-purpose') {
        sessionStorage.setItem('kubenova_oidc_reset_target', 'target');
        sessionStorage.setItem('kubenova_oidc_purpose', 'enrollment');
      }
    }, mode);
    let confirmations = 0;
    let exchanges = 0;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/capabilities') return route.fulfill({ json: { data: [] } });
      if (path.endsWith('/auth/me')) return route.fulfill({ json: { user: { username: 'test-owner', role: 'admin' } } });
      if (path.endsWith('/mfa/status')) return route.fulfill({ json: { enabled: false, canManageMfa: mode !== 'forbidden', passwordReauthenticationAvailable: true } });
      if (path === '/api/users/target') return route.fulfill({ json: { id: 'target', username: 'test-target', mfaEnabled: true } });
      if (path.endsWith('/mfa/reset/prepare')) return route.fulfill(mode === 'wrong-password'
        ? { status: 401, json: { message: 'Invalid credentials' } }
        : { json: { token: 'a'.repeat(43), expiresIn: 1 } });
      if (path.endsWith('/confirm')) confirmations++;
      if (path.endsWith('/exchange')) exchanges++;
      return route.fulfill({ json: { data: { items: [], enabled: false } } });
    });
    await page.goto(`http://127.0.0.1:3000${mode === 'mixed-purpose' ? '/login/oidc?code=fixture' : '/authorization/mfa-reset?target=target'}`);
    if (mode === 'forbidden') await page.getByText('无法读取目标账号或没有 MFA 管理权限，请返回用户管理检查。').waitFor();
    else if (mode === 'mixed-purpose') await page.getByText('单点登录失败', { exact: true }).waitFor();
    else {
      await page.getByLabel('您的当前密码').fill('fixture-password');
      await page.getByRole('button', { name: '验证身份', exact: true }).click();
      if (mode === 'wrong-password') await page.getByText('身份验证失败，请检查密码和验证码后重试。').waitFor();
      else await page.getByText('验证已过期，请重新验证身份。').waitFor();
    }
    assert.equal(await page.getByRole('button', { name: '确认重置 MFA', exact: true }).count(), 0);
    assert.equal(confirmations, 0); assert.equal(exchanges, 0);
    await context.close();
  }
  console.log('PASS mocked reset success and denial paths: permission, credentials, expiry, purpose mixing; no unintended confirmation');
} finally { await browser.close(); }
