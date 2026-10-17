import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { load } from 'js-yaml';

// Exercise the actual Next route; every API request is intercepted, including writes.
const origin=process.env.RESOURCE_EDITOR_QA_URL||'http://127.0.0.1:3000';
const clusterId='editor-conflict-qa';
const initial='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web\n  namespace: prod\n  resourceVersion: "10"\ndata:\n  note: initial-note\n  color: initial-color\n  untouched: initial-untouched\n';
const draft=initial.replace('initial-note','draft-note').replace('initial-color','draft-color');
const latest=initial.replace('"10"','"11"').replace('initial-note','server-note').replace('initial-color','server-color').replace('initial-untouched','server-untouched');
const probe=await build({stdin:{contents:'import {EditorView} from "@codemirror/view";window.editorText=()=>EditorView.findFromDOM(document.querySelector(".cm-content")).state.sliceDoc();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',logLevel:'silent'});
const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
const page=await context.newPage();
page.setDefaultTimeout(12000);
const errors=[],unexpected=[],posts=[];
let comparisonStatus=200,writeStatus=409;
page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{
  localStorage.setItem('aiops_auth_access','editor-conflict-fixture');
  localStorage.setItem('aiops_auth_user','Editor Conflict QA');
  localStorage.setItem('aiops_auth_role','admin');
  localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
  localStorage.setItem('kubenova.console.utility-sidebar.collapsed','1');
});
await context.routeWebSocket('**/*',socket=>socket.close());
await context.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const fulfill=(data,status=200)=>route.fulfill({status,json:{data}});
  if(request.method()==='POST'&&path==='/api/resources/editor/submit'){
    const body=request.postDataJSON();posts.push(body);
    if(!body.dryRun&&writeStatus!==200)return route.fulfill({status:writeStatus,json:{message:'Fixture concurrent edit',code:'RESOURCE_VERSION_CONFLICT'}});
    return fulfill({dryRun:body.dryRun,items:[{apiVersion:'v1',kind:'ConfigMap',namespace:'prod',name:'web',resourceVersion:body.dryRun?'11':'12'}],total:1,message:'Fixture saved'});
  }
  if(request.method()!=='GET'){unexpected.push(`${request.method()} ${path}`);return fulfill({message:'Unexpected write blocked'},500);}
  if(path==='/api/v1/auth/me')return fulfill({user:{username:'Editor Conflict QA',displayName:'Editor Conflict QA',role:'admin'},expiresAt:'2030-01-01T00:00:00Z'});
  if(path==='/api/capabilities'||path==='/api/ai-assistant/sessions')return fulfill([]);
  if(path==='/api/cluster-health')return fulfill({items:[],total:0});
  if(path==='/api/v1/clusters/events/stream')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(path==='/api/system/update/status')return fulfill({updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'});
  if(path===`/api/clusters/${clusterId}`)return fulfill({id:clusterId,name:'Editor QA',runtimeStatus:'running',connectionStatus:'connected'});
  if(path==='/api/clusters')return fulfill({items:[{id:clusterId,name:'Editor QA'}],total:1});
  if(path==='/api/resources/discovery/catalog')return fulfill({clusterId,items:[{id:'configmaps',clusterId,group:'',version:'v1',kind:'ConfigMap',resource:'configmaps',namespaced:true,verbs:['get','update','patch']}],total:1,stale:false});
  if(path==='/api/resources/yaml')return fulfill({clusterId,kind:'ConfigMap',name:'web',yaml:initial,resourceVersion:'10'});
  if(path==='/api/resources/dynamic/detail')return comparisonStatus===200?fulfill({clusterId,group:'',version:'v1',resource:'configmaps',kind:'ConfigMap',namespace:'prod',name:'web',yaml:latest,raw:load(latest)}):route.fulfill({status:comparisonStatus,json:{message:comparisonStatus===403?'Fixture forbidden':'Fixture unavailable'}});
  unexpected.push(`GET ${path}`);return fulfill({message:'Unexpected read blocked'},500);
});
try{
  await page.goto(`${origin}/clusters/${clusterId}/resources/editor?kind=ConfigMap&namespace=prod&name=web&mode=yaml&returnTo=%2Fconfigs%2Fconfigmaps`);
  await page.addScriptTag({content:probe.outputFiles[0].text});
  const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});
  await editor.fill(draft);
  await page.getByRole('button',{name:/校验并预览$/}).click();
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await page.getByRole('button',{name:'对比最新版本',exact:true}).click();
  const conflict=page.getByRole('dialog',{name:'对比与解决版本冲突'});
  const merge=conflict.getByRole('button',{name:'合并到编辑草稿',exact:true});
  assert.equal(await merge.isDisabled(),true);
  await conflict.getByRole('row').filter({has:page.getByText('data.note',{exact:true})}).getByRole('radio',{name:'我的草稿',exact:true}).check();
  assert.equal(await merge.isDisabled(),true);
  await conflict.getByRole('row').filter({has:page.getByText('data.color',{exact:true})}).getByRole('radio',{name:'服务器',exact:true}).check();
  await merge.click();await conflict.waitFor({state:'hidden'});
  const merged=load(await page.evaluate(()=>window.editorText()));
  assert.deepEqual(merged.data,{note:'draft-note',color:'server-color',untouched:'server-untouched'});
  assert.equal(merged.metadata.resourceVersion,'11');assert.equal(posts.length,2);
  assert.equal(await page.getByRole('button',{name:'确认保存',exact:true}).count(),0);
  await page.getByRole('button',{name:/校验并预览$/}).click();
  await page.getByRole('button',{name:'确认保存',exact:true}).waitFor();
  assert.equal(posts[2].dryRun,true);assert.equal(posts[2].resourceVersion,'11');
  assert.deepEqual(load(posts[2].yaml),merged);
  writeStatus=200;
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await page.getByText('Fixture saved',{exact:true}).waitFor();
  assert.equal(posts[3].dryRun,false);assert.equal(posts[3].resourceVersion,'11');
  assert.equal(load(await page.evaluate(()=>window.editorText())).metadata.resourceVersion,'12');
  await editor.fill(draft.replace('"10"','"12"'));
  await page.getByRole('button',{name:/^返\s*回$/}).click();
  const leave=page.getByRole('dialog',{name:'离开资源编辑器？'});
  await leave.getByRole('button',{name:'继续编辑',exact:true}).click();await leave.waitFor({state:'hidden'});
  assert.equal(load(await page.evaluate(()=>window.editorText())).data.note,'draft-note');
  writeStatus=409;
  await page.getByRole('button',{name:/校验并预览$/}).click();
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  comparisonStatus=403;
  await page.getByRole('button',{name:'对比最新版本',exact:true}).click();
  await page.getByText('当前资源读取权限已失效',{exact:true}).waitFor();
  assert.equal(await editor.count(),0);
  comparisonStatus=503;
  const deniedRetry=page.waitForResponse(response=>response.url().includes('/api/resources/dynamic/detail')&&response.status()===503);
  await page.getByRole('button',{name:'重新读取',exact:true}).click();await deniedRetry;
  assert.equal(await editor.count(),0);
  comparisonStatus=200;
  await page.getByRole('button',{name:'重新读取',exact:true}).click();
  await conflict.getByRole('button',{name:'继续编辑',exact:true}).click();await conflict.waitFor({state:'hidden'});
  assert.equal(load(await page.evaluate(()=>window.editorText())).data.note,'draft-note');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS Next editor route: 409 / explicit field merge / latest resourceVersion / repeated dry-run / mock save / leave cancel / 403 then 503 lock / reread restore');
}finally{await browser.close();}
