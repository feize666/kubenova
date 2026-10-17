import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

async function fixture() {
  const bundle=await build({stdin:{contents:`import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import ResourceEditorPage from './resource-editor-page';
    import {EditorView} from '@codemirror/view';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:Infinity}}});
    window.refreshCandidates=async(kind)=>client.refetchQueries({queryKey:['resource-editor-'+kind],type:'active'});
    window.candidatesIdle=()=>client.isFetching()===0;
    window.editorText=()=>EditorView.findFromDOM(document.querySelector('.cm-content')).state.sliceDoc();
    function App(){const [revision,setRevision]=React.useState(0);const [mount,setMount]=React.useState(0);
      window.changeScope=(token,cluster)=>{window.testToken=token;window.history.replaceState({},'', '/?kind=ConfigMap&mode=yaml'+(cluster?'&clusterId='+cluster:''));setRevision(value=>value+1)};
      window.remount=()=>setMount(value=>value+1);
      return <ResourceEditorPage key={mount} revision={revision}/>;}
    window.testToken='account-a';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);`,resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx'},plugins:[{name:'external-contexts',setup(builder){
      builder.onResolve({filter:/^(?:@\/components\/auth-context|next\/navigation)$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({push(){}});export const useSearchParams=()=>new URLSearchParams(window.location.search);':'export const useAuth=()=>({accessToken:window.testToken,username:"fixture-user",role:"admin",isInitializing:false});',loader:'js'}));
    }}],define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""'},bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/editor-candidates-read.js'});
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  const state={clusters:200,catalog:200,writes:[],errors:[]};
  page.on('pageerror',error=>state.errors.push(error.message));
  await page.route('http://editor-candidates.test/**',route=>{
    const request=route.request();if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
    if(request.method()!=='GET'){state.writes.push(request.url());return route.fulfill({status:500,json:{message:'No writes allowed'}});}
    const url=new URL(request.url());const token=request.headers().authorization?.replace('Bearer ','');
    if(url.pathname==='/api/clusters')return route.fulfill({status:state.clusters,json:state.clusters===200?{items:[{id:'cluster-a',name:token==='account-a'?'Private cluster A':'Private cluster B',state:'active'}],total:1}:{message:'Candidates unavailable'}});
    if(url.pathname==='/api/resources/discovery/catalog')return route.fulfill({status:state.catalog,json:state.catalog===200?{clusterId:url.searchParams.get('clusterId'),items:[{id:'configmaps',group:'',version:'v1',kind:'ConfigMap',resource:'configmaps',namespaced:true,verbs:['get','create','update','patch']}],total:1,stale:false,timestamp:'2026-10-13T00:00:00Z'}:{message:'Catalog unavailable'}});
    return route.fulfill({status:500,json:{message:'Unexpected read '+url.pathname}});
  });
  await page.goto('http://editor-candidates.test/?kind=ConfigMap&mode=yaml');
  const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;if(css)await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  const refresh=async(kind,status)=>{state[kind]=status;await page.evaluate(kind=>window.refreshCandidates(kind),kind);await page.waitForFunction(()=>window.candidatesIdle());};
  const close=async()=>{await browser.close();assert.deepEqual(state.writes,[]);assert.deepEqual(state.errors,[]);};
  return {page,state,refresh,close};
}

test('editor cluster candidates never expose denied cache and recover after a fresh read',async()=>{
  const f=await fixture();const {page,refresh}=f;
  try {
    const select=page.getByRole('combobox');await select.click();await page.getByText('Private cluster A',{exact:true}).waitFor();await select.press('Escape');
    await refresh('clusters',503);await select.click();await page.getByText('Private cluster A',{exact:true}).waitFor();await select.press('Escape');
    await refresh('clusters',403);assert.equal(await select.isDisabled(),true,'denied clusters must not remain selectable');
    await refresh('clusters',503);assert.equal(await select.isDisabled(),true,'failed reads after denial must not restore selectable cached clusters');
    await page.evaluate(()=>window.remount());assert.equal(await page.getByRole('combobox').isDisabled(),true);
    await refresh('clusters',200);await page.getByRole('combobox').click();await page.getByText('Private cluster A',{exact:true}).waitFor();await page.getByRole('combobox').press('Escape');
    await page.evaluate(()=>window.changeScope('account-b',''));await page.waitForFunction(()=>window.candidatesIdle());await page.getByRole('combobox').click();await page.getByText('Private cluster B',{exact:true}).waitFor();assert.equal(await page.locator('.ant-select-item-option-content').filter({hasText:'Private cluster A'}).count(),0);
  } finally {await f.close();}
});

test('catalog denial locks real editor writes while retaining its YAML draft until a fresh successful read',async()=>{
  const f=await fixture();const {page,refresh}=f;
  try {
    await page.evaluate(()=>window.changeScope('account-a','cluster-a'));
    const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});await editor.waitFor();await page.waitForFunction(()=>window.candidatesIdle());
    const draft='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: unsaved-private\n  namespace: default\ndata:\n  note: keep-draft\n';await editor.fill(draft);
    await refresh('catalog',503);assert.equal(await page.evaluate(()=>window.editorText()),draft);
    await refresh('catalog',403);await editor.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'校验并预览',exact:true}).count(),0,'denied catalog must not leave a writable editor');
    await refresh('catalog',503);assert.equal(await editor.count(),0);
    await refresh('catalog',200);await editor.waitFor();assert.equal(await page.evaluate(()=>window.editorText()),draft,'permission recovery must not overwrite the unsaved draft');
    await refresh('catalog',403);await page.evaluate(()=>window.remount());assert.equal(await editor.count(),0,'remount must not expose denied catalog cache');
    await page.evaluate(()=>window.changeScope('account-a','cluster-b'));await page.waitForFunction(()=>window.candidatesIdle());assert.equal(await editor.count(),0,'new cluster failing its own read remains protected');
    await refresh('catalog',200);await editor.waitFor();assert.doesNotMatch(await page.evaluate(()=>window.editorText()),/unsaved-private/,'changed cluster must not inherit another cluster draft');
    f.state.catalog=503;await page.evaluate(()=>window.changeScope('account-b','cluster-b'));await page.waitForFunction(()=>window.candidatesIdle());assert.equal(await editor.count(),0,'changed token must not inherit a previous token catalog');
    await refresh('catalog',200);await editor.waitFor();
  } finally {await f.close();}
});

test('revoking the chosen cluster hides its editor without discarding the in-memory draft',async()=>{
  const f=await fixture();const {page,refresh}=f;
  try {
    await page.getByRole('combobox').click();await page.getByText('Private cluster A',{exact:true}).click();
    const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});await editor.waitFor();
    const draft='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: chosen-cluster-draft\n  namespace: default\n';await editor.fill(draft);
    await refresh('clusters',503);assert.equal(await page.evaluate(()=>window.editorText()),draft);
    await refresh('clusters',403);await editor.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'校验并预览',exact:true}).count(),0);
    await refresh('clusters',503);assert.equal(await editor.count(),0);
    await refresh('clusters',200);await editor.waitFor();assert.equal(await page.evaluate(()=>window.editorText()),draft);
  } finally {await f.close();}
});
