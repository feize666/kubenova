import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('security rendered consumers isolate revoked snapshots and identity changes', async t => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import SecurityPage from './page';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.refresh=()=>client.refetchQueries();window.idle=()=>client.isFetching()===0;
      function Fixture(){const [key,setKey]=React.useState(0);const [,render]=React.useReducer(x=>x+1,0);window.remount=()=>flushSync(()=>setKey(k=>k+1));window.rerender=()=>flushSync(()=>render());return <SecurityPage key={key}/>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{name:'fixture',setup(builder){
      builder.onResolve({filter:/auth-context$/},()=>({path:'auth',namespace:'fixture'}));
      builder.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
      builder.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
      builder.onResolve({filter:/\/resource-detail$/},()=>({path:'resourceDetail',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:args.path==='auth'?'export const useAuth=()=>({accessToken:window.token,isInitializing:false,user:{role:"super-admin"}});':args.path==='navigation'?'export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({replace(){},push(){}});export const usePathname=()=>"/security";':args.path==='link'?'export default function Link(p){return <a {...p}/>;}':'export const ResourceDetailDrawer=()=>null;'}));
    }}], define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""'}, bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/security-read-test.js',
  });
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  try {
    for(const kind of ['events','audit-logs','stats','clusters']) await t.test(kind,async()=>{
      const page=await browser.newPage();page.setDefaultTimeout(12000);
      let status=200;let reads=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('http://security-test.local/**',route=>{
        const req=route.request();if(req.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
        assert.equal(req.method(),'GET','fixture prohibits mutation');
        const path=new URL(req.url()).pathname;
        const selected=path===(kind==='clusters'?'/api/clusters':`/api/security/${kind}`);
        if(selected)reads++;
        const token=req.headers().authorization;const other=token?.includes('identity-b');
        let json={items:[],total:0};
        if(path==='/api/security/events')json={items:[{id:'e',severity:'high',title:other?'other-event':'private-event',type:'SecretExposure',resourceName:'private-secret',cluster:'c',namespace:'prod',occurredAt:'2026-10-13T00:00:00Z',status:'open'}],total:1};
        if(path==='/api/security/audit-logs')json={items:[{id:'a',actor:other?'other-actor':'private-actor',role:'admin',action:'query',resourceType:'Secret',resourceId:'secret',result:'success',timestamp:'2026-10-13T00:00:00Z'}],total:1};
        if(path==='/api/security/stats')json={criticalVulnerabilities:other?882:731,openEvents:731,complianceScore:97,todayAuditLogs:731};
        if(path==='/api/clusters')json={items:[{id:'c',name:other?'other-cluster':'private-cluster',state:'active',hasKubeconfig:true}],total:1};
        if(path==='/api/cluster-health')json={items:[{clusterId:'c',runtimeStatus:'running'}],total:1};
        return route.fulfill({status:selected?status:200,json:selected&&status!==200?{message:'fixture denied'}:json});
      });
      await page.goto('http://security-test.local/');await page.evaluate(()=>window.token='identity-a');
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
      if(kind==='audit-logs')await page.getByRole('tab',{name:'审计日志'}).click();
      await page.waitForFunction(()=>window.idle());
      const text=kind==='events'?'private-event':kind==='audit-logs'?'private-actor':kind==='stats'?'731':'private-cluster';
      const visible=()=>page.locator('body').innerText();
      if(kind==='clusters'){await page.getByRole('button').filter({hasText:'资源范围'}).first().click();await page.getByRole('combobox').first().click();}
      if(kind==='clusters')await page.getByText(text,{exact:true}).last().waitFor();
      assert.ok((await visible()).includes(text),'initial authorized data rendered');
      if(kind==='events')await page.getByText('private-event',{exact:true}).first().click();
      if(kind==='audit-logs')await page.getByText('private-actor',{exact:true}).first().click();
      if(kind==='events'||kind==='audit-logs')assert.ok(await page.getByRole('dialog').isVisible(),'business details must actually be opened');
      const refresh=async code=>{await page.waitForFunction(()=>window.idle());status=code;const before=reads;await page.evaluate(()=>window.refresh());await page.waitForFunction(()=>window.idle());assert.ok(reads>before);};
      await refresh(503);assert.ok((await visible()).includes(text),'transient failure preserves snapshot');
      await refresh(403);assert.ok(!(await visible()).includes(text),'denied snapshot must disappear from rendered page and details');
      if(kind==='stats'){assert.ok((await visible()).includes('尚未读取'));assert.ok(!(await visible()).includes('评分区间 健康'));}
      await refresh(503);assert.ok(!(await visible()).includes(text),'denial must remain latched');
      await page.evaluate(()=>window.remount());await page.waitForFunction(()=>window.idle());
      if(kind==='audit-logs'){await page.getByRole('tab',{name:'审计日志'}).click();await page.waitForFunction(()=>window.idle());}
      assert.ok(!(await visible()).includes(text),'remount must not revive denied snapshot');
      await refresh(200);
      if(kind==='audit-logs')await page.getByRole('tab',{name:'审计日志'}).click();
      if(kind==='clusters'){await page.getByRole('button').filter({hasText:'资源范围'}).first().click();await page.getByRole('combobox').first().click();}
      if(kind==='clusters')await page.getByText(text,{exact:true}).last().waitFor();
      assert.ok((await visible()).includes(text),'successful reload restores data');
      if(kind==='events')await page.getByText('private-event',{exact:true}).first().click();
      if(kind==='audit-logs')await page.getByText('private-actor',{exact:true}).first().click();
      status=503;await page.evaluate(()=>{window.token='identity-b';window.rerender();});await page.waitForFunction(()=>window.idle());
      if(kind==='audit-logs'){await page.getByRole('tab',{name:'审计日志'}).click();await page.waitForFunction(()=>window.idle());}
      assert.ok(!(await visible()).includes(text),`identity change must not expose previous data: ${await visible()}`);
      assert.deepEqual(errors,[]);await page.close();
    });
  } finally {await browser.close();}
});
