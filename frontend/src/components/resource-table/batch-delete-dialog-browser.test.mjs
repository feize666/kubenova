import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('390px batch confirmation contains long identities and reports mixed results without retrying', async () => {
  const bundle = await build({
    stdin: {
      loader: 'tsx', resolveDir: new URL('../../../', import.meta.url).pathname,
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {BatchDeleteDialog} from './src/components/resource-table/batch-delete-dialog';
        import {ThemeProvider} from './src/components/theme-context';
        import './src/app/globals.css';
        const targets=[
          {id:'a',clusterId:'production-cluster-beijing',namespace:'production-payments',name:'payments-api-1234567890-abcde',uid:'uid-a'},
          {id:'b',clusterId:'production-cluster-beijing',namespace:'production-payments',name:'payments-worker-1234567890-abcde',uid:'uid-b'}
        ];
        window.attempts=[];
        function Fixture(){const [open,setOpen]=React.useState(true);return open?
          <BatchDeleteDialog targets={targets} execute={async target=>{window.attempts.push(target.id);if(target.id==='b')throw Error('permission denied');}}
            onClose={()=>setOpen(false)} onComplete={results=>window.results=results}/>:<p>已关闭</p>;}
        createRoot(document.getElementById('root')).render(<ThemeProvider><Fixture/></ThemeProvider>);`,
    },
    define: { 'process.env.NODE_ENV': '"test"' }, bundle: true, write: false,
    format: 'iife', jsx: 'automatic', outfile: 'tmp/batch-dialog-browser.js', logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const unexpected = [], errors = [];
    await context.route('**/*', route => {
      if (route.request().resourceType() === 'document' && new URL(route.request().url()).host === 'batch-fixture.local') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><div id="root"></div></body></html>' });
      }
      unexpected.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://batch-fixture.local/');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await page.getByRole('button', { name: '确认删除', exact: true }).isEnabled(), false);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'dialog must remain within the mobile viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'long target identities must not overflow the mobile page');
    await page.getByRole('textbox', { name: '输入 DELETE 以确认操作' }).fill('DELETE');
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await page.getByText('处理完成：成功 1，失败 1', { exact: true }).waitFor();
    await page.getByText('失败：permission denied', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.attempts), ['a', 'b']);
    assert.deepEqual(await page.evaluate(() => window.results.map(result => result.status)), ['succeeded', 'failed']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.BATCH_QA_SCREENSHOT) await page.screenshot({ path: process.env.BATCH_QA_SCREENSHOT });
    await page.getByRole('button', { name: /^关\s*闭$/ }).click();
    await page.getByText('已关闭', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.attempts), ['a', 'b'], 'closing mixed results must not retry targets');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, [], 'fixture must never contact external resources');
    await context.close();
  } finally { await browser.close(); }
});
