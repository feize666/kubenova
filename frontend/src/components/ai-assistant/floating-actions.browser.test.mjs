import assert from 'node:assert/strict';
import test from 'node:test';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';

test('floating actions require preview and explicit confirmation and invalidate on context change', async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{FloatingActions}from'./floating-actions';
      const descriptors=[{id:'restart',label:'重启应用',kind:'resource-operation',operation:'restart-workload',riskLevel:'low',target:{kind:'Deployment',name:'web'}}];
      descriptors.push({id:'query',label:'查询实例',kind:'resource-operation',operation:'query-pods-overview',riskLevel:'low'});
      function Fixture(){const[cluster,setCluster]=React.useState('cluster-a');return <><button onClick={()=>setCluster('cluster-b')}>切换集群</button><FloatingActions descriptors={descriptors} token="fixture" sessionId="session-a" clusterId={cluster} namespace="apps"/></>}
      createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: '/tmp/floating-actions-fixture.js',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""' },
  });
  stop();
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const requests = [];
    const errors = [];
    let expired = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://floating-actions.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      requests.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { data: path.endsWith('/preview')
        ? { status: 'ok', approvalId: 'approval-fixture', expiresAt: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }
        : { status: 'success', operation: route.request().postDataJSON().action.operation, requestId: 'request-fixture',
          result: [{ resourceType: 'Pod', resourceId: 'web-pod', action: 'query', status: 'success', details: { name: 'web-pod' } }] } } });
    });
    await page.goto('http://floating-actions.test/');
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const restart = page.getByRole('button', { name: '重启应用', exact: true });
    const dialog = page.getByRole('dialog', { name: '确认 AI 操作' });
    await restart.click();
    await dialog.waitFor();
    assert.equal(requests.length, 1, 'a model-labelled low-risk write still requires confirmation');
    assert.match(await dialog.innerText(), /cluster-a/);
    await dialog.getByRole('button', { name: /取\s*消/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.length, 1, 'cancel must not dispatch');
    await restart.click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
    await page.getByText(/操作执行成功/).waitFor();
    const execution = requests.find(item => item.path.endsWith('/execute'));
    assert.equal(execution.body.approvalId, 'approval-fixture');
    assert.equal(execution.body.action.target.clusterId, 'cluster-a');
    assert.equal(execution.body.action.target.namespace, 'apps');
    assert.equal(execution.body.action.sessionId, 'session-a');
    await restart.click();
    await dialog.waitFor();
    await page.getByRole('button', { name: '切换集群' }).evaluate(button => button.click());
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.ant-modal-wrap') || getComputedStyle(document.querySelector('.ant-modal-wrap')).display === 'none');
    assert.equal(requests.filter(item => item.path.endsWith('/execute')).length, 1);
    expired = true;
    await restart.click();
    await dialog.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] pre')?.textContent?.includes('cluster-b'));
    await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
    await page.getByText('操作确认已过期，请重新预览').waitFor();
    assert.equal(requests.filter(item => item.path.endsWith('/execute')).length, 1);
    await page.getByRole('button', { name: '查询实例', exact: true }).click();
    await page.getByText(/操作执行成功：query-pods-overview/).waitFor();
    await page.getByText('查看操作结果', { exact: true }).click();
    await page.getByText(/"resourceId": "web-pod"/).waitFor();
    assert.equal(requests.filter(item => item.path.endsWith('/preview')).length, 4, 'read-only query must not create an approval');
    assert.equal(requests.filter(item => item.path.endsWith('/execute')).length, 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
