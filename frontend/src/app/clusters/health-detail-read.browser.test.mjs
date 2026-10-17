import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('opened cluster health details hide revoked snapshots and disable unavailable actions', async t => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import ClustersPage from './page';import '../../app/globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
        window.refresh=()=>client.refetchQueries({queryKey:['cluster-health-detail']});window.idle=()=>client.isFetching()===0;
        function Fixture(){const [,render]=React.useReducer(x=>x+1,0);window.rerender=()=>flushSync(()=>render());return <ClustersPage/>;}
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx',
    },
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({ filter: /auth-context$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents:
        args.path === 'auth' ? 'export const useAuth=()=>({accessToken:window.token,isInitializing:false,role:"super-admin",user:{role:"super-admin"}});'
          : args.path === 'navigation' ? 'export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({replace(){},push(){}});export const usePathname=()=>"/clusters";'
            : 'export default function Link(p){return <a {...p}/>;}',
      }));
    } }],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/health-detail-read.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const denied of [401, 403]) await t.test(`health read ${denied}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(12000);
      let status = 200;
      let reads = 0;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://health-detail-test.local/**', route => {
        const request = route.request();
        if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        assert.equal(request.method(), 'GET', 'health fixture prohibits mutation and manual probes');
        const path = new URL(request.url()).pathname;
        const summary = { clusterId: 'health-cluster', clusterName: 'test-cluster', lifecycleState: 'active', runtimeStatus: 'running', ok: true, latencyMs: 1, checkedAt: '2026-10-13T00:00:00Z', reason: null, source: 'auto', isStale: false };
        if (path === '/api/cluster-health/health-cluster') {
          reads++;
          const otherIdentity = request.headers().authorization?.includes('identity-b');
          return route.fulfill({ status, json: status === 200 ? { summary, detail: { timeoutMs: 10000, failureCount: 0, payload: { diagnostic: otherIdentity ? 'other-identity-diagnostic' : 'private-health-diagnostic' } } } : { message: 'fixture unavailable' } });
        }
        if (path === '/api/clusters') return route.fulfill({ json: { items: [{ id: 'health-cluster', name: 'test-cluster', state: 'active', hasKubeconfig: true, status: 'running', environment: '本地', provider: 'fixture' }], total: 1, page: 1, pageSize: 25 } });
        if (path === '/api/cluster-health') return route.fulfill({ json: { items: [summary], total: 1, page: 1, pageSize: 25, timestamp: summary.checkedAt } });
        return route.fulfill({ json: { items: [], total: 0 } });
      });
      await page.goto('http://health-detail-test.local/');
      await page.evaluate(() => { window.token = 'identity-a'; });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
      const openHealth = async () => {
        await page.locator('tr').filter({ hasText: 'test-cluster' }).getByRole('button', { name: '操作', exact: true }).click();
        await page.getByRole('menuitem', { name: /健康详情/ }).click();
        await page.waitForFunction(() => window.idle());
      };
      const visible = () => page.getByRole('dialog').innerText();
      const probe = () => page.getByRole('dialog').getByRole('button', { name: /立即探测/ });
      const refresh = async code => {
        await page.waitForFunction(() => window.idle());
        status = code;
        const before = reads;
        await page.evaluate(() => window.refresh());
        await page.waitForFunction(() => window.idle());
        assert.ok(reads > before, 'refresh must fetch the opened health detail');
      };
      try {
        await openHealth();
        assert.ok((await visible()).includes('private-health-diagnostic'));
        assert.ok(await probe().isEnabled(), 'authorized fresh health supports actions');
        await refresh(denied);
        assert.ok(!(await visible()).includes('private-health-diagnostic'), 'revoked health diagnostics must disappear');
        assert.ok(await probe().isDisabled(), 'denied health cannot run manual probe');
        await refresh(503);
        assert.ok(!(await visible()).includes('private-health-diagnostic'), 'a transient error cannot revive a revoked snapshot');
        assert.ok(await probe().isDisabled());
        await page.getByRole('dialog').locator('.ant-drawer-close').click();
        await openHealth();
        assert.ok(!(await visible()).includes('private-health-diagnostic'), 'reopening preserves the denial guard');
        await refresh(200);
        assert.ok((await visible()).includes('private-health-diagnostic'));
        assert.ok(await probe().isEnabled());
        await refresh(503);
        assert.ok((await visible()).includes('private-health-diagnostic'), 'ordinary network failure preserves an authorized snapshot');
        assert.ok((await visible()).includes('当前内容可能已过期'), 'retained health data must be marked stale');
        assert.ok(await probe().isDisabled(), 'stale detail cannot trigger a manual probe');
        await page.getByRole('dialog').getByRole('button', { name: /重试/ }).click();
        await page.waitForFunction(() => window.idle());
        status = 503;
        await page.evaluate(() => { window.token = 'identity-b'; window.rerender(); });
        await page.waitForFunction(() => window.idle());
        assert.ok(!(await visible()).includes('private-health-diagnostic'), 'new identity cannot inherit prior diagnostics');
        assert.ok(await probe().isDisabled());
        await refresh(200);
        assert.ok((await visible()).includes('other-identity-diagnostic'));
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});

if (process.env.LOCAL_HEALTH_URL) test('actual Next health drawer preserves the page and guards refreshed diagnostics', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('aiops_auth_access', 'health-fixture');
      localStorage.setItem('aiops_auth_user', 'Health QA');
      localStorage.setItem('aiops_auth_role', 'admin');
      localStorage.setItem('aiops_auth_expires_at', '2030-01-01T00:00:00Z');
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    let status = 200;
    let reads = 0;
    const writes = [];
    const errors = [];
    const cluster = { id: 'health-cluster', name: 'health-fixture-cluster', state: 'active', hasKubeconfig: true, status: 'running', environment: '本地', provider: 'fixture' };
    const summary = { clusterId: cluster.id, clusterName: cluster.name, lifecycleState: 'active', runtimeStatus: 'running', ok: true, latencyMs: 1, checkedAt: '2026-10-13T00:00:00Z', reason: null, source: 'auto', isStale: false };
    await context.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const ok = data => route.fulfill({ json: { data } });
      if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
      if (path === '/api/v1/auth/me') return ok({ user: { username: 'Health QA', role: 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (path.startsWith('/api/users/preferences/table/')) return ok(null);
      if (path === '/api/clusters') return ok({ items: [cluster], total: 1, page: 1, pageSize: 25 });
      if (path === '/api/cluster-health') return ok({ items: [summary], total: 1 });
      if (path === '/api/cluster-health/health-cluster') {
        reads++;
        return status === 200 ? ok({ summary, detail: { timeoutMs: 10000, failureCount: 0, payload: { diagnostic: 'private-next-health' } } }) : route.fulfill({ status, json: { message: 'fixture unavailable' } });
      }
      return ok([]);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.LOCAL_HEALTH_URL}/clusters`, { waitUntil: 'domcontentloaded' });
    await page.locator('tr').filter({ hasText: cluster.name }).getByRole('button', { name: '操作', exact: true }).click();
    await page.getByRole('menuitem', { name: /健康详情/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(/private-next-health/).waitFor();
    const url = page.url();
    for (const [code, title, shown] of [[503, '健康详情刷新失败，当前内容可能已过期', true], [403, '健康详情访问权限校验失败', false], [503, '健康详情加载失败', false], [200, '', true]]) {
      status = code;
      const before = reads;
      await dialog.getByRole('button', { name: /刷新健康详情/ }).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('.ant-drawer-footer button')].some(button => button.textContent.includes('刷新健康详情') && button.classList.contains('ant-btn-loading')));
      assert.ok(reads > before, 'drawer refresh fetches the open health query');
      if (title) await dialog.getByText(title, { exact: true }).waitFor();
      await dialog.getByText(/private-next-health/).waitFor({ state: shown ? 'visible' : 'hidden' });
      assert.equal(await dialog.getByRole('button', { name: /立即探测/ }).isEnabled(), code === 200);
      assert.equal(page.url(), url);
    }
    await dialog.locator('.ant-drawer-close').click();
    await page.locator('tr').filter({ hasText: cluster.name }).waitFor();
    assert.equal(page.url(), url, 'closing health details preserves the list route');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
