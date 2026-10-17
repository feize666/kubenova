import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('real cluster drawer preserves authorized refresh snapshots and guards revoked detail and exports', async t => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {ClusterDetailDrawer} from './cluster-detail-drawer';import '../app/globals.css';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.idle=()=>client.isFetching()===0;
      function Fixture(){const [,render]=React.useReducer(x=>x+1,0);window.renderDrawer=()=>flushSync(()=>render());return <ClusterDetailDrawer open={window.drawerOpen} token={window.token} cluster={window.cluster} runtimeStatus={window.runtimeStatus} onClose={()=>{window.drawerOpen=false;render();}}/>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'auth-boundary', setup(builder) {
      builder.onResolve({ filter: /auth-context$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useAuth=()=>({role:"admin",accessToken:window.token});', loader: 'js' }));
    } }],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/cluster-detail-browser.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const scenario of ['refresh', 'denial', 'identity', 'offline', 'no-kubeconfig', 'denied-offline']) await t.test(scenario, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      let status = 200;
      const requests = [], prohibited = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const detail = other => ({ id: 'cluster-a', name: 'private-cluster-name', displayName: other ? 'identity-b-detail' : 'private-display-name', runtimeStatus: 'running', lastSyncTime: '2026-10-13T00:00:00Z', nodeSummary: { total: 1, ready: 1, notReady: 0, items: [{ id: 'node-a', name: other ? 'identity-b-node' : 'private-node-a', role: 'worker', ready: true, kubeletVersion: 'v1.32.0' }], degraded: false, degradationReason: null }, platform: { cniPlugin: 'private-cni', criRuntime: 'containerd', kubernetesVersion: 'v1.32.0' }, metadata: { environment: 'private-environment', provider: 'private-provider', region: 'private-region', environmentType: 'public-cloud' } });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET' || url.pathname.includes('kubeconfig')) { prohibited.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        if (url.host !== 'cluster-detail-test.local' || url.pathname !== '/api/clusters/cluster-a') { prohibited.push(url.href); return route.abort(); }
        requests.push(request.headers().authorization);
        return route.fulfill({ status, json: status === 200 ? { data: detail(request.headers().authorization === 'Bearer identity-b') } : { message: 'fixture unavailable' } });
      });
      try {
        await page.goto('http://cluster-detail-test.local/');
        await page.evaluate(scenario => {
          window.token = 'identity-a'; window.drawerOpen = true;
          window.cluster = { id: 'cluster-a', key: 'cluster-a', name: 'private-list-name', state: 'active', status: scenario === 'offline' ? 'offline' : 'running', hasKubeconfig: scenario !== 'no-kubeconfig', environment: 'private-list-environment', provider: 'private-list-provider', nodeCount: 1 };
        }, scenario);
        await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
        await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
        const dialog = () => page.locator('.ant-drawer-section[role="dialog"]');
        const text = () => dialog().innerText();
        const exportButton = () => dialog().getByRole('button', { name: /导出 kubeconfig/ });
        const refresh = async code => {
          status = code;
          const before = requests.length;
          await dialog().getByRole('button', { name: /刷\s*新/, exact: true }).click();
          await page.waitForFunction(() => window.idle());
          assert.ok(requests.length > before);
        };
        if (scenario === 'offline' || scenario === 'no-kubeconfig') {
          await dialog().getByText(scenario === 'offline' ? '集群当前离线' : '集群处于离线模式', { exact: true }).waitFor();
          assert.equal(requests.length, 0, 'offline/no-kubeconfig must not start real detail reads');
          assert.equal(await exportButton().count(), 0);
        } else {
          await dialog().getByText('private-node-a', { exact: true }).waitFor();
          assert.ok((await text()).includes('private-cni'));
          assert.ok(await exportButton().isEnabled());
          await exportButton().click();
          await page.getByRole('button', { name: /取\s*消/, exact: true }).click();
          await page.locator('.ant-modal-confirm').waitFor({ state: 'detached' });
          if (scenario === 'refresh') {
            await refresh(503);
            assert.ok((await text()).includes('private-node-a'), 'ordinary 503 must retain the authorized node snapshot');
            assert.ok((await text()).includes('private-cni'));
            assert.ok((await text()).includes('当前内容可能已过期'));
            assert.ok(await exportButton().isDisabled(), 'stale detail cannot export credentials');
          } else if (scenario === 'identity') {
            status = 503;
            await page.evaluate(() => { window.token = 'identity-b'; window.renderDrawer(); });
            await page.waitForFunction(() => window.idle());
            assert.ok(!(await text()).includes('private-'), 'new identity must not inherit prior nodes, title or list metadata');
            assert.ok(await exportButton().isDisabled());
            await refresh(200);
            await dialog().getByText('identity-b-node', { exact: true }).waitFor();
          } else {
            await refresh(403);
            assert.ok(!(await text()).includes('private-'), 'denial hides nodes, platform, title and list fallback');
            assert.ok((await text()).includes('当前资源内容已隐藏'));
            assert.ok(await exportButton().isDisabled(), 'denial disables credential export');
            if (scenario === 'denied-offline') {
              await page.evaluate(() => { window.runtimeStatus = 'offline'; window.renderDrawer(); });
              assert.ok(!(await text()).includes('private-'), 'same-scope offline fallback cannot bypass denied detail');
            } else {
              await refresh(503);
              assert.ok(!(await text()).includes('private-'));
              assert.ok(await exportButton().isDisabled());
              await dialog().locator('.ant-drawer-close').click();
              await page.evaluate(() => { window.drawerOpen = true; window.renderDrawer(); });
              await page.waitForFunction(() => window.idle());
              assert.ok(!(await text()).includes('private-'), 'closing/reopening cannot revive denied cache');
              await refresh(200);
              await dialog().getByText('private-node-a', { exact: true }).waitFor();
              assert.ok(await exportButton().isEnabled());
            }
          }
        }
        assert.deepEqual(prohibited, [], 'all APIs stay in fixtures; no mutation or kubeconfig download');
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
