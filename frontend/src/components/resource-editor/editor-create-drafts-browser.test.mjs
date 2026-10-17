import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { load } from 'js-yaml';

const origin = 'http://editor-create-drafts.test';
const workloadYaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: fixture-web\n  namespace: fixture-ns\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: fixture-web\n  template:\n    metadata:\n      labels:\n        app: fixture-web\n    spec:\n      containers:\n        - name: web\n          image: nginx:fixture\n';
const configYaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture-config\n  namespace: fixture-ns\ndata:\n  note: fixture-note\n';

async function openEditor({kind = 'Deployment', yaml = workloadYaml, readOnly = false} = {}) {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {EditorDocument} from './resource-editor-page';
        import {EditorView} from '@codemirror/view';
        window.editorText=()=>EditorView.findFromDOM(document.querySelector('.cm-content')).state.sliceDoc();
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EditorDocument embedded clusterId="fixture-cluster" token="fixture-token" initialKind=${JSON.stringify(kind)} initialVersion=${JSON.stringify(kind === 'Deployment' ? 'apps/v1' : 'v1')} initialNamespace="fixture-ns" initialDraftYaml={${JSON.stringify(yaml)}} initialMode="form" readOnly={${readOnly}} returnTo="/fixture-return" resourceOptions={[]} onClose={()=>window.closeCount++}/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx',
    },
    plugins: [{name: 'external-contexts', setup(builder) {
      builder.onResolve({filter: /^(?:@\/components\/auth-context|next\/navigation)$/}, args => ({path: args.path, namespace: 'test-context'}));
      builder.onLoad({filter: /.*/, namespace: 'test-context'}, args => ({contents: args.path === 'next/navigation'
        ? 'export const useRouter=()=>({push(href){window.navigations.push(href)}});export const useSearchParams=()=>new URLSearchParams();'
        : 'export const useAuth=()=>({role:"admin",accessToken:"fixture-token",username:"fixture-user",isInitializing:false});', loader: 'js'}));
    }}],
    define: {'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""', 'process.env.NODE_ENV': '"development"'},
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/editor-create-drafts-test.js',
  });
  const browser = await chromium.launch({headless: true, channel: process.env.YAML_EDITOR_BROWSER_CHANNEL || 'chrome'});
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const network = {posts: [], unexpected: []};
  await page.route(`${origin}/**`, async route => {
    const request = route.request();
    if (request.resourceType() === 'document') return route.fulfill({contentType: 'text/html', body: '<div id="root"></div><script>window.navigations=[];window.closeCount=0</script>'});
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/api/resources/editor/submit') {
      const body = request.postDataJSON();
      network.posts.push(body);
      const manifest = load(body.yaml);
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({dryRun: body.dryRun, items: [{apiVersion: manifest.apiVersion, kind: manifest.kind, name: manifest.metadata.name, namespace: manifest.metadata.namespace, resourceVersion: 'fixture-version', message: 'fixture-only'}], total: 1, message: 'Fixture created'})});
    }
    network.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({status: 500, contentType: 'application/json', body: '{"message":"Unexpected external request blocked"}'});
  });
  await page.goto(origin);
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text;
  if (css) await page.addStyleTag({content: css});
  await page.addScriptTag({content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text});
  try {await page.getByRole('tab', {name: '表单', exact: true}).waitFor();}
  catch (error) {await browser.close(); assert.deepEqual(errors, [], 'fixture must render without errors'); throw error;}
  return {page, network, async close() {await browser.close(); assert.deepEqual(network.unexpected, []); assert.deepEqual(errors, []);}};
}

async function advancedStep(page) {
  await page.getByRole('button', {name: '下一步', exact: true}).click();
  await page.getByRole('button', {name: '下一步', exact: true}).click();
  await page.getByRole('textbox', {name: '高级亲和性', exact: true}).waitFor();
}

test('unapplied workload advanced input survives mode switches and cannot be bypassed by YAML validation', async () => {
  const fixture = await openEditor();
  const {page, network} = fixture;
  try {
    await advancedStep(page);
    await page.getByRole('textbox', {name: '高级亲和性', exact: true}).fill('{"nodeAffinity":{}}');
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    assert.equal(network.posts.length, 0, 'unapplied form input must not disappear and permit dry-run');
    await page.getByRole('tab', {name: '表单', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '高级亲和性', exact: true}).inputValue(), '{"nodeAffinity":{}}');
    await page.getByRole('button', {name: '应用此配置', exact: true}).click();
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    await page.getByRole('button', {name: '确认创建', exact: true}).waitFor();
    assert.deepEqual(load(network.posts[0].yaml).spec.template.spec.affinity, {nodeAffinity: {}});
  } finally {await fixture.close();}
});

test('invalid native map row survives mode switches until explicitly removed', async () => {
  const fixture = await openEditor({kind: 'ConfigMap', yaml: configYaml});
  const {page, network} = fixture;
  try {
    const labels = page.locator('.ant-form-item').filter({has: page.getByText('资源标签', {exact: true})});
    await labels.getByRole('button', {name: '新增键值', exact: true}).click();
    await page.getByRole('textbox', {name: '标签 键名', exact: true}).fill('__proto__');
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    assert.equal(network.posts.length, 0, 'invalid map row must not be discarded by changing modes');
    await page.getByRole('tab', {name: '表单', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '标签 键名', exact: true}).inputValue(), '__proto__');
    await page.getByRole('button', {name: '删除 标签 __proto__', exact: true}).click();
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    await page.getByRole('button', {name: '确认创建', exact: true}).waitFor();
    assert.deepEqual(load(network.posts[0].yaml).data, {note: 'fixture-note'});
  } finally {await fixture.close();}
});

test('importing YAML cannot silently replace an unapplied form buffer', async () => {
  const fixture = await openEditor({kind:'ConfigMap',yaml:configYaml});
  const {page,network} = fixture;
  try {
    await page.locator('.ant-form-item').filter({has:page.getByText('资源标签',{exact:true})}).getByRole('button',{name:'新增键值',exact:true}).click();
    await page.getByRole('textbox',{name:'标签 键名',exact:true}).fill('__proto__');
    await page.locator('input[type="file"][accept=".yml,.yaml,.json"]').setInputFiles({name:'replacement.yaml',mimeType:'application/yaml',buffer:Buffer.from(configYaml.replace('fixture-config','replacement-config'))});
    assert.equal(await page.getByRole('tab',{name:'表单',exact:true}).getAttribute('aria-selected'),'true','import must not replace or unmount pending form input');
    assert.equal(await page.getByRole('textbox',{name:'标签 键名',exact:true}).inputValue(),'__proto__');
    assert.equal(await page.getByRole('textbox',{name:'资源名称',exact:true}).inputValue(),'fixture-config');
    assert.equal(network.posts.length,0);
  } finally {await fixture.close();}
});

test('unapplied Secret keys prevent type changes from silently discarding their memory draft', async () => {
  const fixture = await openEditor({kind: 'Secret', yaml: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: fixture-secret\n  namespace: fixture-ns\ntype: Opaque\n'});
  const {page, network} = fixture;
  try {
    await page.getByRole('button', {name: '新增键值', exact: true}).last().click();
    await page.getByRole('textbox', {name: '新增 Secret 键名', exact: true}).fill('fixture-key');
    await page.getByLabel('新增 Secret 值', {exact: true}).fill('fixture-only-value');
    await page.getByText('镜像仓库', {exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '新增 Secret 键名', exact: true}).count(), 1, 'type switching must preserve or guard the unapplied input');
    await page.getByRole('button', {name: '应用新增键值', exact: true}).click();
    await page.getByText('镜像仓库', {exact: true}).click();
    await page.getByText('普通密钥', {exact: true}).click();
    await page.getByRole('button', {name: '显示并编辑内容', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: 'Secret fixture-key 值', exact: true}).inputValue(), 'fixture-only-value');
    assert.equal(network.posts.length, 0);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  } finally {await fixture.close();}
});

test('pending-only native map edits require confirmation before canceling an embedded editor', async () => {
  const fixture = await openEditor({kind: 'ConfigMap', yaml: configYaml});
  const {page} = fixture;
  try {
    await page.locator('.ant-form-item').filter({has: page.getByText('资源标签', {exact: true})}).getByRole('button', {name: '新增键值', exact: true}).click();
    assert.equal(await page.evaluate(() => {const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented;}), true, 'pending-only edits must protect a browser refresh too');
    await page.getByRole('button', {name: /^取\s*消$/}).click();
    assert.equal(await page.evaluate(() => window.closeCount), 0, 'unapplied input alone is an unsaved edit');
    const dialog = page.getByRole('dialog', {name: '离开资源编辑器？'});
    await dialog.getByRole('button', {name: '继续编辑', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '标签 键名', exact: true}).count(), 1);
    await page.getByRole('button', {name: /^取\s*消$/}).click();
    await dialog.getByRole('button', {name: '离开编辑器', exact: true}).click();
    assert.equal(await page.evaluate(() => window.closeCount), 1);
  } finally {await fixture.close();}
});

test('Secret upload decisions remain pending across a mode switch and cancel does not mutate the draft', async () => {
  const fixture = await openEditor({kind: 'Secret', yaml: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: fixture-secret\n  namespace: fixture-ns\ntype: Opaque\n'});
  const {page, network} = fixture;
  try {
    await page.getByLabel('上传密钥文件', {exact: true}).setInputFiles({name: 'fixture-key', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture-only-upload')});
    await page.getByRole('button', {name: '应用文件到草稿', exact: true}).waitFor();
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    await page.getByRole('tab', {name: '表单', exact: true}).click();
    assert.equal(await page.getByRole('button', {name: '取消上传', exact: true}).count(), 1, 'mode switch must not silently discard uploaded bytes');
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    assert.equal(network.posts.length, 0);
    await page.getByRole('button', {name: '取消上传', exact: true}).click();
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    await page.getByRole('button', {name: '确认创建', exact: true}).waitFor();
    assert.equal(load(network.posts[0].yaml).data?.['fixture-key'], undefined);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  } finally {await fixture.close();}
});

test('workload wizard checks required fields even when jumping directly to advanced settings', async () => {
  const fixture = await openEditor({yaml: workloadYaml.replace('name: fixture-web', 'name: ""').replace('image: nginx:fixture', 'image: ""')});
  const {page, network} = fixture;
  try {
    await page.getByRole('button', {name: '下一步', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '资源名称', exact: true}).isVisible(), true);
    await page.getByRole('textbox', {name: '资源名称', exact: true}).fill('fixture-web');
    await page.getByText('高级配置', {exact: true}).first().click();
    assert.equal(await page.getByRole('textbox', {name: '镜像', exact: true}).isVisible(), true);
    await page.getByRole('textbox', {name: '镜像', exact: true}).fill('nginx:fixture');
    await page.getByRole('button', {name: '下一步', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '高级亲和性', exact: true}).isVisible(), true);
    assert.equal(network.posts.length, 0);
  } finally {await fixture.close();}
});

test('form and YAML edit the same create draft and both submissions use its exact validated payload', async () => {
  const fixture = await openEditor({kind: 'ConfigMap', yaml: configYaml});
  const {page, network} = fixture;
  try {
    await page.getByRole('textbox', {name: '资源名称', exact: true}).fill('fixture-renamed');
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    const text = await page.evaluate(() => window.editorText());
    assert.equal(load(text).metadata.name, 'fixture-renamed');
    await page.getByRole('textbox', {name: '资源 YAML', exact: true}).fill(text.replace('fixture-note', 'fixture-yaml-note'));
    await page.getByRole('tab', {name: '表单', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '文本配置 note 值', exact: true}).inputValue(), 'fixture-yaml-note');
    await page.getByRole('button', {name: '校验并预览', exact: true}).click();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/resources/editor/submit');
    await page.getByRole('button', {name: '确认创建', exact: true}).click();
    await saved;
    assert.equal(network.posts.length, 2);
    assert.deepEqual(network.posts.map(body => {const payload = {...body}; delete payload.yaml; return payload;}), [
      {clusterId: 'fixture-cluster', namespace: 'fixture-ns', operation: 'create', dryRun: true},
      {clusterId: 'fixture-cluster', namespace: 'fixture-ns', operation: 'create', dryRun: false},
    ]);
    assert.equal(network.posts[0].yaml, network.posts[1].yaml);
    assert.deepEqual(load(network.posts[1].yaml), {apiVersion: 'v1', kind: 'ConfigMap', metadata: {name: 'fixture-renamed', namespace: 'fixture-ns'}, data: {note: 'fixture-yaml-note'}});
  } finally {await fixture.close();}
});

test('missing native required fields do not prevent switching to YAML to complete the draft', async () => {
  const fixture = await openEditor({kind: 'PersistentVolumeClaim', yaml: 'apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: fixture-pvc\n  namespace: fixture-ns\nspec: {}\n'});
  const {page, network} = fixture;
  try {
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    assert.equal(await page.getByRole('tab', {name: 'YAML', exact: true}).getAttribute('aria-selected'), 'true');
    await page.getByRole('textbox', {name: '资源 YAML', exact: true}).waitFor();
    await page.getByRole('button', {name: /^取\s*消$/}).click();
    assert.equal(await page.evaluate(() => window.closeCount), 1, 'untouched required fields alone must not count as unsaved input');
    assert.equal(network.posts.length, 0);
  } finally {await fixture.close();}
});

test('Docker credential draft cannot be discarded by input-method switch and has an explicit cancel action', async () => {
  const fixture = await openEditor({kind: 'Secret', yaml: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: fixture-secret\n  namespace: fixture-ns\ntype: kubernetes.io/dockerconfigjson\n'});
  const {page, network} = fixture;
  try {
    await page.getByRole('textbox', {name: '镜像仓库地址', exact: true}).fill('registry.fixture.test');
    await page.getByText('配置文件', {exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '镜像仓库地址', exact: true}).count(), 1, 'input-method switch must not hide unapplied credentials');
    await page.getByRole('button', {name: '取消凭据草稿', exact: true}).click();
    await page.getByText('配置文件', {exact: true}).click();
    await page.getByLabel('上传 .dockerconfigjson', {exact: true}).setInputFiles({name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from('{"auths":{}}')});
    await page.getByRole('button', {name: '取消上传', exact: true}).waitFor();
    await page.getByText('仓库凭据', {exact: true}).click();
    assert.equal(await page.getByRole('button', {name: '取消上传', exact: true}).count(), 1);
    await page.getByRole('button', {name: '取消上传', exact: true}).click();
    await page.getByText('仓库凭据', {exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '镜像仓库地址', exact: true}).inputValue(), '');
    assert.equal(network.posts.length, 0);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  } finally {await fixture.close();}
});

test('readonly real create form and YAML expose no writable submission path', async () => {
  const fixture = await openEditor({kind: 'ConfigMap', yaml: configYaml, readOnly: true});
  const {page, network} = fixture;
  try {
    assert.equal(await page.getByRole('textbox', {name: '资源名称', exact: true}).isDisabled(), true);
    assert.equal(await page.getByRole('button', {name: '校验并预览', exact: true}).isDisabled(), true);
    await page.getByRole('tab', {name: 'YAML', exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '资源 YAML', exact: true}).getAttribute('contenteditable'), 'false');
    await page.getByRole('button', {name: /^取\s*消$/}).click();
    assert.equal(await page.evaluate(() => window.closeCount), 1);
    assert.equal(network.posts.length, 0);
  } finally {await fixture.close();}
});

test('canceling an invalid unapplied Secret key clears its pending validation error', async () => {
  const fixture = await openEditor({kind: 'Secret', yaml: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: fixture-secret\n  namespace: fixture-ns\ntype: Opaque\n'});
  const {page, network} = fixture;
  try {
    await page.getByRole('button', {name: '新增键值', exact: true}).last().click();
    await page.getByRole('button', {name: '应用新增键值', exact: true}).click();
    await page.getByRole('textbox', {name: '新增 Secret 键名', exact: true}).locator('..').locator('..').getByRole('button', {name: /^取\s*消$/}).click();
    await page.getByText('镜像仓库', {exact: true}).click();
    assert.equal(await page.getByRole('textbox', {name: '镜像仓库地址', exact: true}).count(), 1, 'cancel must clear the invalid draft, not leave switching permanently blocked');
    assert.equal(network.posts.length, 0);
  } finally {await fixture.close();}
});
