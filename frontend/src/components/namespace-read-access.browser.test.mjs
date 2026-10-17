import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('namespace candidates hide denied remote cache through transient failures and remount until a successful read', async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {NamespaceSelect,NamespaceOptionList} from './namespace-select';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.candidatesIdle=()=>client.isFetching()===0;
      function Fixture(){const [mount,setMount]=React.useState(0);return <>
        <button onClick={()=>client.refetchQueries({queryKey:['namespaces']})}>Refresh candidates</button>
        <button onClick={()=>setMount(mount+1)}>Reopen candidates</button>
        <NamespaceSelect key={'select'+mount} value='' onChange={()=>{}} clusterId='cluster-a'/>
        <NamespaceOptionList key={'list'+mount} value='' onChange={()=>{}} onSelect={()=>{}} clusterId='cluster-a'/>
      </>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'fixture-auth', setup(builder) {
      builder.onResolve({ filter: /auth-context$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useAuth=()=>({accessToken:"fixture",isInitializing:false});', loader: 'js' }));
    } }],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/namespace-read-test.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let status = 200;
    let reads = 0;
    await page.route('http://namespace-test.local/**', route => {
      const request = route.request();
      if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      assert.equal(request.method(), 'GET');
      assert.equal(new URL(request.url()).pathname, '/api/namespaces');
      reads++;
      return route.fulfill({ status, json: status === 200 ? { items: [{ namespace: 'private-namespace', name: 'private-namespace', clusterId: 'cluster-a' }], total: 1 } : { message: 'fixture unavailable' } });
    });
    await page.goto('http://namespace-test.local/');
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const option = page.getByRole('listbox', { name: '命名空间列表', exact: true }).getByRole('option', { name: 'private-namespace', exact: true });
    await option.waitFor();
    const checkSelect = async present => {
      const select = page.getByRole('combobox', { name: '选择命名空间', exact: true });
      await select.click();
      const candidate = page.locator('.ant-select-item-option-content').filter({ hasText: 'private-namespace' });
      if (present) await candidate.waitFor();
      else assert.equal(await candidate.count(), 0, 'Select must not expose denied remote candidates');
      await select.press('Escape');
    };
    await checkSelect(true);
    const refresh = async next => {
      await page.waitForFunction(() => window.candidatesIdle());
      status = next;
      const before = reads;
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/namespaces');
      await page.getByRole('button', { name: 'Refresh candidates' }).click();
      assert.equal((await response).status(), next);
      assert.ok(reads > before);
      await page.waitForFunction(() => window.candidatesIdle());
    };
    await refresh(503);
    await option.waitFor();
    await refresh(403);
    await option.waitFor({ state: 'hidden' });
    await checkSelect(false);
    await refresh(503);
    assert.equal(await option.count(), 0);
    await checkSelect(false);
    await page.getByRole('button', { name: 'Reopen candidates' }).click();
    assert.equal(await option.count(), 0);
    await refresh(200);
    await option.waitFor();
    await checkSelect(true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
