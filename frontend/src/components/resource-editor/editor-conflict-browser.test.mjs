import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { load } from 'js-yaml';

const origin = 'http://editor-conflict.test';
const initialYaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web\n  namespace: prod\n  resourceVersion: "10"\ndata:\n  note: initial-note\n  color: initial-color\n  untouched: initial-untouched\n';
const draftYaml = initialYaml.replace('initial-note', 'draft-note').replace('initial-color', 'draft-color');
const latestYaml = initialYaml.replace('"10"', '"11"').replace('initial-note', 'server-note').replace('initial-color', 'server-color').replace('initial-untouched', 'server-untouched');

async function openEditor({embedded=false}={}) {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import ResourceEditorPage, {EditorDocument} from './resource-editor-page';
        import {EditorView} from '@codemirror/view';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        const read=()=>client.getQueryCache().getAll().find(query=>query.queryKey[0]==='resource-editor-original');
        window.readStatus=()=>read()?.state.error?.status;
        window.refreshRead=()=>client.refetchQueries({predicate:query=>query===read()});
        window.editorText=()=>EditorView.findFromDOM(document.querySelector('.cm-content')).state.sliceDoc();
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>{${embedded}?<EditorDocument embedded clusterId="fixture-cluster" token="fixture-token" initialKind="ConfigMap" initialVersion="v1" initialNamespace="prod" initialYaml={${JSON.stringify(initialYaml)}} initialMode="yaml" readOnly={false} returnTo="" resourceOptions={[]} onRetryRead={()=>window.refreshRead()}/>:<ResourceEditorPage/>}</QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{ name: 'external-contexts', setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/auth-context|next\/navigation)$/}, args=>({path:args.path,namespace:'test-context'}));
      builder.onLoad({filter:/.*/,namespace:'test-context'}, args=>({contents:args.path==='next/navigation'
        ? 'export const useRouter=()=>({push(href){window.navigations.push(href)}});export const useSearchParams=()=>new URLSearchParams(window.location.search);'
        : 'export const useAuth=()=>({role:"admin",accessToken:"fixture-token",username:"fixture-user",isInitializing:false});',loader:'js'}));
    }}],
    define: {'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"development"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/editor-conflict-test.js',
  });
  const browser = await chromium.launch({headless:true,channel:process.env.YAML_EDITOR_BROWSER_CHANNEL||'chrome'});
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  const network = {readStatus:200,comparisonStatus:200,writeStatus:409,posts:[],unexpected:[]};
  const fulfill = (route, status, data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  await page.route(`${origin}/**`, async route=>{
    const request = route.request();
    if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><a href="/configs/configmaps?clusterId=fixture-cluster#details">Other resource list</a><script>window.navigations=[]</script>'});
    const path = new URL(request.url()).pathname;
    if(request.method()==='POST' && path==='/api/resources/editor/submit') {
      const body=request.postDataJSON();
      network.posts.push(body);
      if(!body.dryRun && network.writeStatus!==200)return fulfill(route,network.writeStatus,{message:'Fixture concurrent edit',code:'RESOURCE_VERSION_CONFLICT'});
      return fulfill(route,200,{dryRun:body.dryRun,items:[{apiVersion:'v1',kind:'ConfigMap',name:'web',namespace:'prod',resourceVersion:body.dryRun?'11':'12',message:'fixture-only'}],total:1,message:'Fixture saved'});
    }
    if(request.method()!=='GET') {network.unexpected.push(`${request.method()} ${path}`);return fulfill(route,500,{message:'Unexpected write blocked'});}
    if(path==='/api/resources/discovery/catalog')return fulfill(route,200,{clusterId:'fixture-cluster',items:[{id:'configmaps',clusterId:'fixture-cluster',group:'',version:'v1',kind:'ConfigMap',resource:'configmaps',namespaced:true,verbs:['get','update','patch'],lastDiscoveredAt:'2026-10-11T00:00:00Z'}],total:1,stale:false,timestamp:'2026-10-11T00:00:00Z'});
    if(path==='/api/resources/yaml')return fulfill(route,network.readStatus,network.readStatus===200?{yaml:initialYaml}:{message:network.readStatus===403?'Fixture forbidden':'Fixture unavailable'});
    if(path==='/api/resources/dynamic/detail')return fulfill(route,network.comparisonStatus,network.comparisonStatus===200?{clusterId:'fixture-cluster',group:'',version:'v1',resource:'configmaps',kind:'ConfigMap',namespace:'prod',name:'web',yaml:latestYaml,raw:load(latestYaml),timestamp:'2026-10-11T00:00:00Z'}:{message:network.comparisonStatus===403?'Fixture forbidden':'Fixture unavailable'});
    network.unexpected.push(`GET ${path}`);
    return fulfill(route,500,{message:'Unexpected read blocked'});
  });
  await page.goto(`${origin}/resources/edit?clusterId=fixture-cluster&kind=ConfigMap&name=web&namespace=prod&mode=yaml&returnTo=%2Fconfigs%2Fconfigmaps`);
  const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
  if(css)await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});
  await editor.waitFor();
  const close=async()=>{await browser.close();assert.deepEqual(network.unexpected,[]);assert.deepEqual(errors,[]);};
  return {page,editor,network,close};
}

async function createConflict(fixture) {
  const {page,editor}=fixture;
  await editor.fill(draftYaml);
  await page.getByRole('button',{name:/校验并预览$/}).click();
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await page.getByRole('button',{name:'对比最新版本',exact:true}).click();
}

test('real conflict radios require every field and merge only a draft that must be dry-run again with latest resourceVersion', async()=>{
  const fixture=await openEditor();
  const {page,editor,network}=fixture;
  try {
    await createConflict(fixture);
    const dialog=page.getByRole('dialog',{name:'对比与解决版本冲突'});
    await dialog.waitFor();
    const merge=dialog.getByRole('button',{name:'合并到编辑草稿',exact:true});
    assert.equal(await merge.isDisabled(),true);
    assert.equal(await dialog.getByRole('radio').count(),4);
    await dialog.getByRole('row').filter({has:page.getByText('data.note',{exact:true})}).getByRole('radio',{name:'我的草稿',exact:true}).check();
    assert.equal(await merge.isDisabled(),true,'selecting one field must not implicitly resolve other fields');
    await dialog.getByRole('row').filter({has:page.getByText('data.color',{exact:true})}).getByRole('radio',{name:'服务器',exact:true}).check();
    assert.equal(await merge.isDisabled(),false);
    await merge.click();
    await dialog.waitFor({state:'hidden'});
    const merged=load(await page.evaluate(()=>window.editorText()));
    assert.deepEqual(merged.data,{note:'draft-note',color:'server-color',untouched:'server-untouched'});
    assert.equal(merged.metadata.resourceVersion,'11');
    assert.equal(network.posts.length,2,'resolving a conflict must never write to the server');
    assert.equal(await page.getByRole('button',{name:'确认保存',exact:true}).count(),0,'the old preview must be invalidated after merging');
    await page.getByRole('button',{name:/校验并预览$/}).click();
    await page.getByRole('button',{name:'确认保存',exact:true}).waitFor();
    assert.equal(network.posts[2].dryRun,true);
    assert.equal(network.posts[2].resourceVersion,'11');
    assert.deepEqual(load(network.posts[2].yaml),merged);
    network.writeStatus=200;
    await page.getByRole('button',{name:'确认保存',exact:true}).click();
    await page.getByText('Fixture saved',{exact:true}).waitFor();
    assert.equal(network.posts[3].dryRun,false);
    assert.equal(network.posts[3].resourceVersion,'11');
    assert.deepEqual(load(network.posts[3].yaml),merged);
    assert.match(await editor.textContent(),/12/);
  } finally {await fixture.close();}
});

test('canceling real leave confirmations preserves unsaved CodeMirror content and exact navigation intent',async()=>{
  const fixture=await openEditor();
  const {page,editor,network}=fixture;
  try {
    await editor.fill(draftYaml);
    await page.getByRole('button',{name:/^返\s*回$/}).click();
    let dialog=page.getByRole('dialog',{name:'离开资源编辑器？'});
    await dialog.getByRole('button',{name:'继续编辑',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    assert.deepEqual(await page.evaluate(()=>window.navigations),[]);
    await page.getByRole('link',{name:'Other resource list',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'离开资源编辑器？'});
    await dialog.getByRole('button',{name:'继续编辑',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    await page.getByRole('link',{name:'Other resource list',exact:true}).click();
    await dialog.getByRole('button',{name:'离开编辑器',exact:true}).click();
    await page.waitForFunction(()=>window.navigations.length===1);
    assert.deepEqual(await page.evaluate(()=>window.navigations),['/configs/configmaps?clusterId=fixture-cluster#details']);
    assert.equal(network.posts.length,0);
  } finally {await fixture.close();}
});

test('page refresh 503 retains draft while 403 hides it until a successful reread',async()=>{
  const fixture=await openEditor();
  const {page,editor,network}=fixture;
  try {
    await editor.fill(draftYaml);
    network.readStatus=503;
    await page.evaluate(()=>window.refreshRead());
    await page.getByText('资源刷新失败，已保留当前草稿',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    network.readStatus=403;
    await page.evaluate(()=>window.refreshRead());
    await page.getByText('当前资源读取权限已失效',{exact:true}).waitFor();
    assert.equal(await editor.count(),0);
    assert.equal(await page.getByRole('button',{name:'校验并预览',exact:true}).count(),0);
    network.readStatus=503;
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await editor.count(),0);
    network.readStatus=200;
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    await editor.waitFor();
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    assert.equal(network.posts.length,0);
  } finally {await fixture.close();}
});

test('denied latest-version comparison hides the draft and closes write actions until reread succeeds',async()=>{
  const fixture=await openEditor();
  const {page,editor,network}=fixture;
  try {
    network.comparisonStatus=403;
    await createConflict(fixture);
    await page.getByText('当前资源读取权限已失效',{exact:true}).waitFor();
    assert.equal(await editor.count(),0);
    assert.equal(await page.getByRole('button',{name:'校验并预览',exact:true}).count(),0);
    network.comparisonStatus=503;
    const failedRetry=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/resources/dynamic/detail'&&response.status()===503);
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    await failedRetry;
    assert.equal(await editor.count(),0,'failed retry cannot restore cached access after compare denial');
    network.comparisonStatus=200;
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'对比与解决版本冲突'});
    await dialog.getByRole('button',{name:'继续编辑',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await editor.waitFor();
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    assert.equal(network.posts.length,2);
  } finally {await fixture.close();}
});

test('invalid YAML cannot open a latest-version comparison or discard the invalid draft',async()=>{
  const fixture=await openEditor();
  const {page,editor,network}=fixture;
  try {
    const invalid='apiVersion: v1\nkind: ConfigMap\nmetadata: [\n';
    await createConflict(fixture);
    await page.getByRole('dialog',{name:'对比与解决版本冲突'}).getByRole('button',{name:'继续编辑',exact:true}).click();
    await editor.fill(invalid);
    const compare=page.getByRole('button',{name:'对比最新版本',exact:true});
    assert.equal(await compare.isDisabled(),true,'invalid YAML has no manifest available for a comparison');
    assert.equal(await page.evaluate(()=>window.editorText()),invalid);
    assert.equal(network.posts.length,2);
  } finally {await fixture.close();}
});

test('embedded document can retry a denied comparison without relying on the parent query or losing its draft',async()=>{
  const fixture=await openEditor({embedded:true});
  const {page,editor,network}=fixture;
  try {
    network.comparisonStatus=403;
    await createConflict(fixture);
    await page.getByText('当前资源读取权限已失效',{exact:true}).waitFor();
    network.comparisonStatus=503;
    const failedRetry=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/resources/dynamic/detail'&&response.status()===503);
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    await failedRetry;
    assert.equal(await editor.count(),0);
    network.comparisonStatus=200;
    await page.getByRole('button',{name:'重新读取',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'对比与解决版本冲突'});
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'继续编辑',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.editorText()),draftYaml);
    assert.equal(network.posts.length,2);
  } finally {await fixture.close();}
});
