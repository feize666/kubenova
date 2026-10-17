import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { load } from 'js-yaml';

const probe=await build({stdin:{contents:'import {EditorView} from "@codemirror/view";window.editorText=()=>EditorView.findFromDOM(document.querySelector(".cm-content")).state.sliceDoc();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',logLevel:'silent'});
const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
let page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],writes=[];
let status=200;
let namespaced=true;
page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{
  localStorage.setItem('aiops_auth_access','schema-route-fixture');localStorage.setItem('aiops_auth_user','Schema QA');localStorage.setItem('aiops_auth_role','admin');localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
});
await context.routeWebSocket('**/*',socket=>socket.close());
await context.route('**/api/**',route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const ok=data=>route.fulfill({json:{data}});
  if(request.method()!=='GET'){writes.push(path);return route.abort();}
  if(path==='/api/v1/auth/me')return ok({user:{username:'Schema QA',role:'admin'},expiresAt:'2030-01-01T00:00:00Z'});
  if(path==='/api/resources/discovery/catalog')return ok({clusterId:'schema-qa',items:[
    {id:'other-widgets',group:'other.example.io',version:'v1',kind:'Widget',resource:'widgets',namespaced:!namespaced,verbs:['get','create','update','patch']},
    {id:'widgets',group:'example.io',version:'v1',kind:'Widget',resource:'widgets',namespaced,verbs:['get','create','update','patch']},
  ],total:2});
  if(path==='/api/resources/yaml')return ok({yaml:'apiVersion: example.io/v1\nkind: Widget\nmetadata:\n  name: web\n  namespace: prod\n  resourceVersion: "4"\nspec:\n  value: initial\n'});
  if(path==='/api/resources/editor/schema')return route.fulfill({status,json:status===200?{data:{source:'crd',schema:{type:'object',properties:{apiVersion:{type:'string'},kind:{type:'string'},metadata:{type:'object'},spec:{type:'object',properties:{value:{type:'string',title:'Widget value'}}}}}}}:{message:'Schema fixture unavailable'}});
  if(path==='/api/clusters/schema-qa')return ok({id:'schema-qa',name:'Schema QA',runtimeStatus:'running'});
  if(path==='/api/v1/clusters/events/stream')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(path==='/api/capabilities'||path==='/api/ai-assistant/sessions')return ok([]);
  if(path==='/api/system/update/status')return ok({updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'});
  return ok({items:[],total:0});
});
try{
  await page.goto((process.env.RESOURCE_EDITOR_QA_URL||'http://127.0.0.1:3000')+'/clusters/schema-qa/resources/editor?kind=Widget&apiVersion=example.io%2Fv1&resource=widgets&namespace=prod&name=web&mode=form');
  await page.addScriptTag({content:probe.outputFiles[0].text});
  const field=page.getByRole('textbox',{name:'Widget value',exact:true});
  await field.fill('draft-value');
  const refetch=async code=>{
    status=code;await page.getByRole('button',{name:'刷新页面',exact:true}).filter({visible:true}).first().click();
  };
  await refetch(503);
  await page.getByText('资源 Schema刷新失败，当前内容可能已过期',{exact:true}).waitFor();
  assert.equal(await field.inputValue(),'draft-value');
  status=403;await page.getByRole('button',{name:/重\s*试$/}).click();
  await field.waitFor({state:'hidden'});
  assert.equal(load(await page.evaluate(()=>window.editorText())).spec.value,'draft-value');
  status=503;await page.getByRole('button',{name:/重\s*试$/}).click();
  await page.getByText('资源 Schema加载失败',{exact:true}).waitFor();assert.equal(await field.count(),0);
  status=200;await page.getByRole('button',{name:/重\s*试$/}).click();
  await field.waitFor();assert.equal(await field.inputValue(),'draft-value');
  // A cluster-scoped custom kind must not inherit an unrelated list namespace.
  namespaced=false;
  await page.close();
  page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('kubenova-editor-draft:'))localStorage.removeItem(key);});
  await page.goto((process.env.RESOURCE_EDITOR_QA_URL||'http://127.0.0.1:3000')+'/clusters/schema-qa/resources/editor?kind=Widget&apiVersion=example.io%2Fv1&resource=widgets&namespace=prod&mode=form');
  await page.getByRole('textbox',{name:'资源名称',exact:true}).fill('cluster-widget');
  await page.getByRole('textbox',{name:'Widget value',exact:true}).fill('cluster-scoped');
  assert.equal(await page.getByRole('textbox',{name:'资源命名空间',exact:true}).count(),0);
  try { await page.getByRole('tab',{name:'YAML',exact:true}).click(); }
  catch(error){throw new Error(await page.locator('body').innerText(),{cause:error});}
  await page.getByRole('textbox',{name:'资源 YAML',exact:true}).waitFor();
  await page.addScriptTag({content:probe.outputFiles[0].text});
  const clusterManifest=load(await page.evaluate(()=>window.editorText()));
  assert.equal(clusterManifest.metadata.name,'cluster-widget');
  assert.equal(clusterManifest.metadata.namespace,undefined);
  assert.equal(clusterManifest.apiVersion,'example.io/v1');
  assert.equal(clusterManifest.spec.value,'cluster-scoped');
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS Next custom resource schema: snapshot / denial / YAML preservation / retry recovery / no writes');
}finally{await browser.close();}
