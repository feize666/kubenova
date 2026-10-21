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
  const actionPage = await browser.newPage();
  const actionErrors = [];
  actionPage.on('pageerror', error => actionErrors.push(error.message));
  await actionPage.addInitScript(data => {
    localStorage.setItem('aiops_auth_access', data.accessToken);
    localStorage.setItem('aiops_auth_user', data.user.username);
    localStorage.setItem('aiops_auth_role', data.user.role);
    localStorage.setItem('aiops_auth_expires_at', data.expiresAt);
  }, auth);
  const releaseUrl = 'https://github.com/feize666/kubenova/releases/tag/v1.2';
  const assetBase = 'https://github.com/feize666/kubenova/releases/download/v1.2/';
  const updateStatus = {
    deploymentMode: 'compose', checkState: 'available', releaseNotes: 'UI executor regression fixture', migrationRequired: false,
    runningVersion: 'v1.1', installedVersion: 'v1.1', latestVersion: 'v1.2', updateAvailable: true,
    latestReleaseUrl: releaseUrl, latestReleasePublishedAt: '2026-10-18T00:00:00.000Z', lastUpdateCheckAt: '2026-10-18T00:00:00.000Z',
    buildType: 'release', updateCheckError: null, releaseValidationMessage: null, releaseReady: true,
    downloadUrl: assetBase + 'kubenova-ubuntu.tar.gz', checksumUrl: assetBase + 'kubenova-ubuntu.tar.gz.sha256', manifestUrl: assetBase + 'release-manifest.json',
    manualUpdateReason: '', backupVersion: 'v1.0', rollbackCandidates: [{ version: 'v1.0', backupAvailable: true }], backupAvailable: true,
    installStatus: 'idle', installable: true, updateExecutorReady: true, installProgress: null, releaseMode: 'pointer-swap',
    preflight: { id: 'preflight-ui-test', status: 'passed', targetVersion: 'v1.2', deploymentMode: 'compose', expiresAt: new Date(Date.now() + 60000).toISOString(), backupTargetId: 'backup-ui-test', migrationTargetId: 'migration-ui-test', message: 'passed', checks: [{ name: 'executor', status: 'passed', message: 'ready' }] },
    postReleaseAudit: { enabled: false, strategy: 'async-after-release', status: 'idle', lastRunAt: null, lastSummary: null },
    lastOperation: null, lastOperationResult: null, timestamp: new Date().toISOString(),
  };
  const release = { tag: 'v1.2', name: 'KubeNova v1.2', url: releaseUrl, publishedAt: updateStatus.latestReleasePublishedAt, notes: 'UI executor regression fixture', downloadUrl: updateStatus.downloadUrl, checksumUrl: updateStatus.checksumUrl, manifestUrl: updateStatus.manifestUrl, releaseReady: true };
  const submittedActions = [];
  await actionPage.route('**/api/system/update/status', route => route.fulfill({ json: updateStatus }));
  await actionPage.route('**/api/system/update/releases', route => route.fulfill({ json: { items: [release], total: 1, timestamp: new Date().toISOString() } }));
  await actionPage.route('**/api/system/update/history', route => route.fulfill({ json: { items: [], total: 0, timestamp: new Date().toISOString() } }));
  await actionPage.route('**/api/system/update/check', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    return route.fulfill({ json: updateStatus });
  });
  await actionPage.route('**/api/system/update/install', async route => {
    submittedActions.push({ action: 'install', body: route.request().postDataJSON() });
    return route.fulfill({ json: { ...updateStatus, installStatus: 'queued', installProgress: { taskId: 'mock-install', targetVersion: 'v1.2', phase: 'queued', percent: 0, message: 'test task', startedAt: new Date().toISOString() } } });
  });
  await actionPage.route('**/api/system/update/rollback', async route => {
    submittedActions.push({ action: 'rollback', body: route.request().postDataJSON() });
    return route.fulfill({ json: { ...updateStatus, installStatus: 'idle' } });
  });
  await actionPage.goto(base + '/settings/update');
  await actionPage.getByRole('button', { name: '确认更新并启动 v1.2' }).waitFor();
  assert.ok(await actionPage.getByRole('button', { name: '一键回滚并启动' }).isVisible());
  const currentVersion = actionPage.getByText('v1.1', { exact: true }).first();
  await Promise.all([
    actionPage.waitForResponse(response => response.url().endsWith('/api/system/update/check') && response.request().method() === 'POST'),
    actionPage.getByRole('button', { name: '检查更新', exact: true }).click(),
  ]);
  assert.ok(await currentVersion.isVisible(), 'checking updates must keep the displayed version instead of flashing to a blank skeleton');
  await actionPage.getByRole('button', { name: '一键回滚并启动' }).click();
  await Promise.all([
    actionPage.waitForResponse(response => response.url().endsWith('/api/system/update/rollback') && response.request().method() === 'POST'),
    actionPage.getByRole('button', { name: '确认回滚并启动' }).click(),
  ]);
  await actionPage.getByRole('button', { name: '确认更新并启动 v1.2' }).click();
  await Promise.all([
    actionPage.waitForResponse(response => response.url().endsWith('/api/system/update/install') && response.request().method() === 'POST'),
    actionPage.getByRole('button', { name: '确认更新并启动', exact: true }).click(),
  ]);
  assert.deepEqual(submittedActions.map(item => item.action), ['rollback', 'install']);
  assert.deepEqual(actionErrors, []);
  await actionPage.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(missingAssets, []);
  console.log('PASS update route: real login/API checks, desktop/mobile, explicit errors, stable content during checks, one-click install/rollback UI handoff, no JS errors or missing assets');
} finally { await browser.close(); }
