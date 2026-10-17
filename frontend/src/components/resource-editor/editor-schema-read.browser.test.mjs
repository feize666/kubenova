import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { load } from 'js-yaml';

const origin = 'http://editor-schema-read.test';
const yaml = 'apiVersion: example.io/v1\nkind: Widget\nmetadata:\n  name: fixture-widget\n  namespace: fixture-ns\nspec:\n  value: initial\n';

async function openFixture() {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {EditorDocument} from './resource-editor-page';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}});window.refresh=()=>client.refetchQueries({queryKey:['resource-editor-schema']});
      import {serializeResourceDocuments} from '@/lib/resource-editor';import {EditorView} from '@codemirror/view';
      const root=createRoot(document.getElementById('root'));let token='fixture-token';window.lastYaml=${JSON.stringify(yaml)};
      window.editorText=()=>EditorView.findFromDOM(document.querySelector('.cm-content')).state.sliceDoc();
      window.mount=()=>root.render(<QueryClientProvider client={client}><EditorDocument embedded clusterId="fixture-cluster" token={token} initialKind="Widget" initialVersion="example.io/v1" initialNamespace="fixture-ns" initialYaml={window.lastYaml} initialMode="form" readOnly={false} resource="widgets" resourceOptions={[]} onDraftChange={manifest=>window.lastYaml=serializeResourceDocuments([manifest])} onClose={()=>{}}/></QueryClientProvider>);
      window.unmount=()=>root.render(<QueryClientProvider client={client}/>);window.changeToken=next=>{token=next;window.mount();};window.mount();`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'contexts', setup(builder) { builder.onResolve({ filter: /^(?:@\/components\/auth-context|next\/navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('auth-context') ? 'export const useAuth=()=>({role:"admin",accessToken:"fixture-token",username:"fixture-user",isInitializing:false});' : 'export const useRouter=()=>({push(){}});export const useSearchParams=()=>new URLSearchParams();', loader: 'js' })); } }],
    define: { 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""', 'process.env.NODE_ENV': '"test"' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/editor-schema-read-test.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  const page = await browser.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let schemaStatus = 200;
  const unexpected = [];
  await page.routeWebSocket(/.*/, socket => { unexpected.push('WebSocket'); socket.close(); });
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/resources/editor/schema') {
      if (schemaStatus === 200) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'crd', schema: { type: 'object', properties: { apiVersion: { type: 'string' }, kind: { type: 'string' }, metadata: { type: 'object' }, spec: { type: 'object', properties: { value: { type: 'string', title: 'Widget value' } } } } } }) });
      return route.fulfill({ status: schemaStatus, contentType: 'application/json', body: JSON.stringify({ message: schemaStatus === 403 ? 'schema denied' : 'schema unavailable' }) });
    }
    unexpected.push(`${request.method()} ${request.url()}`); return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"unexpected request"}' });
  });
  await page.goto(origin);
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.getByRole('textbox', { name: 'Widget value', exact: true }).waitFor();
  return { page, setStatus(value) { schemaStatus = value; }, async close() { await browser.close(); assert.deepEqual(errors, []); assert.deepEqual(unexpected, [], 'all HTTP/socket traffic is isolated and no resource write occurs'); } };
}

test('schema form keeps its authorized snapshot through 503 and never exposes denied fields until 200 recovery', async () => {
  const fixture = await openFixture();
  const { page } = fixture;
  try {
    const field = page.getByRole('textbox', { name: 'Widget value', exact: true });
    await field.fill('draft-value');
    fixture.setStatus(503);
    await page.evaluate(() => window.refresh());
    await field.waitFor();
    assert.equal(await field.inputValue(), 'draft-value', '503 must retain the last usable schema and local draft');
    await page.getByRole('button', { name: /重\s*试$/ }).waitFor();

    fixture.setStatus(403);
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/resources/editor/schema' && response.status() === 403);
    await page.getByRole('button', { name: /重\s*试$/ }).click(); await denied;
    await field.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox', { name: 'Widget value', exact: true }).count(), 0, '403 must not display denied schema fields');
    assert.equal(load(await page.evaluate(() => window.editorText())).spec.value, 'draft-value', 'schema denial is not resource-read denial: YAML draft remains available');

    fixture.setStatus(503);
    await page.evaluate(() => window.refresh());
    await page.getByRole('textbox', { name: '资源 YAML', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Widget value', exact: true }).count(), 0, 'later outage/remount must not revive denied schema');
    await page.evaluate(() => window.unmount());
    await page.getByRole('tab', { name: '表单', exact: true }).waitFor({state:'detached'});
    const remounted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/resources/editor/schema' && response.status() === 503);
    await page.evaluate(() => window.mount());
    await remounted;
    await page.getByRole('textbox', { name: '资源 YAML', exact: true }).waitFor();
    assert.equal(await field.count(), 0, 'remount with a failed refetch must not revive denied cached schema');

    fixture.setStatus(200);
    await page.getByRole('button', { name: /重\s*试$/ }).click();
    await page.getByRole('textbox', { name: 'Widget value', exact: true }).waitFor();
    assert.equal(await field.inputValue(), 'draft-value');
  } finally { await fixture.close(); }
});

// Omitting token or namespace from the schema scope would expose another context's fields.
test('schema fields do not leak across token and YAML namespace changes', async () => {
  const fixture = await openFixture(); const {page} = fixture;
  try {
    fixture.setStatus(503);
    await page.evaluate(() => window.changeToken('different-account'));
    await page.getByRole('textbox', { name: '资源 YAML', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Widget value', exact: true }).count(), 0);
    fixture.setStatus(200); await page.evaluate(() => window.refresh());
    await page.getByRole('textbox', { name: 'Widget value', exact: true }).waitFor();
    await page.getByRole('tab', {name:'YAML',exact:true}).click();
    const text=await page.evaluate(() => window.editorText());
    fixture.setStatus(503);
    await page.getByRole('textbox', {name:'资源 YAML',exact:true}).fill(text.replace('fixture-ns','other-namespace'));
    await page.getByRole('tab', {name:'表单',exact:true}).waitFor();
    await page.waitForFunction(() => document.querySelector('[role="tab"]')?.getAttribute('aria-disabled') === 'true');
    assert.equal(await page.getByRole('textbox', { name: 'Widget value', exact: true }).count(), 0);
    assert.equal(load(await page.evaluate(() => window.editorText())).metadata.namespace, 'other-namespace');
  } finally {await fixture.close();}
});
