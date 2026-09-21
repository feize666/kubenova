import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => console.error(error.message));
  const user = { id: 'identity-test', username: 'identity-member', name: 'Identity Member', role: 'user', isActive: true, createdAt: new Date().toISOString() };
  let identities = [];
  let mutations = 0;
  let profileUpdates = 0;
  await page.addInitScript(() => {
    for (const [key, value] of Object.entries({ access: 'test-token', refresh: 'test-refresh', user: 'test-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) {
      sessionStorage.setItem(`aiops_auth_session_${key}`, value);
    }
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data = { items: [], total: 0 };
    if (path === '/api/capabilities') data = [];
    if (path.endsWith('/auth/me')) data = { user: { id: 'admin-test', username: 'test-admin', role: 'admin' } };
    if (/\/users$/.test(path)) data = { items: [user], total: 1, page: 1, pageSize: 10 };
    if (path.endsWith('/users/identity-test') && request.method() === 'PATCH') {
      assert.deepEqual(request.postDataJSON(), { username: 'identity-member' });
      profileUpdates++;
      data = user;
    }
    if (path.includes('/external-identities')) {
      if (request.method() === 'POST') {
        assert.deepEqual(request.postDataJSON(), { issuer: 'https://identity.example.com/realms/test', subject: 'subject-1' });
        identities = [{ id: 'binding-1', ...request.postDataJSON(), createdAt: new Date().toISOString() }];
        mutations++;
        data = identities[0];
      } else if (request.method() === 'DELETE') {
        assert.ok(path.endsWith('/binding-1'));
        identities = [];
        mutations++;
        data = { removed: true };
      } else data = { items: identities };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto('http://127.0.0.1:3000/users');
  await page.getByRole('button', { name: 'identity-member 更多操作' }).click();
  await page.getByText('编辑', { exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel('用户名', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] input')?.value === 'identity-member');
  assert.equal(await editDialog.getByRole('combobox').count(), 0, 'profile editor must not grant roles');
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/user-profile-editor.png', fullPage: true, animations: 'disabled' });
  await editDialog.getByRole('button', { name: /^保\s*存$/ }).click();
  await editDialog.waitFor({ state: 'hidden' });
  assert.equal(profileUpdates, 1, 'profile save must submit only account details');
  await page.getByRole('button', { name: 'identity-member 更多操作' }).click();
  await page.getByText('企业身份', { exact: true }).click();
  await page.getByText('尚未绑定企业身份', { exact: true }).waitFor();
  await page.getByLabel('Issuer', { exact: true }).fill('https://identity.example.com/realms/test');
  await page.getByLabel('Subject', { exact: true }).fill('subject-1');
  await page.getByRole('button', { name: '绑定身份', exact: true }).click();
  await page.getByText('Subject: subject-1', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^解\s*绑$/ }).click();
  assert.equal(mutations, 1, 'opening confirmation must not delete the identity');
  await page.getByRole('button', { name: /^取\s*消$/ }).click();
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  assert.equal(mutations, 1);
  await page.getByRole('button', { name: /^解\s*绑$/ }).click();
  await page.getByRole('tooltip').getByRole('button', { name: /^解\s*绑$/ }).click();
  await page.getByText('尚未绑定企业身份', { exact: true }).waitFor();
  assert.equal(mutations, 2);
  console.log('PASS profile editing without role assignment; identity binding, refresh, cancel and confirmed removal (mocked API)');
} catch (error) {
  console.error(await page?.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
