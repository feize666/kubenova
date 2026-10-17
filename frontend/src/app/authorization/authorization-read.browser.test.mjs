import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Clearing every error loses transient snapshots; exposing cached data revives denied rows.
test('authorization rendered reads preserve transient snapshots without reviving denied or cross-token data', async t => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import AuthorizationPage from './page';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.refresh=()=>client.refetchQueries({type:'active'});window.idle=()=>client.isFetching()===0;
      function Fixture(){const [key,setKey]=React.useState(0);const [,render]=React.useReducer(x=>x+1,0);
        window.remount=()=>flushSync(()=>setKey(k=>k+1));window.switchToken=value=>flushSync(()=>{window.token=value;render();});
        return <AuthorizationPage key={key}/>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name:'fixture-boundaries', setup(builder) {
      builder.onResolve({filter:/auth-context$/},()=>({path:'auth',namespace:'fixture'}));
      builder.onResolve({filter:/^(\.\/create-grant|\.\/group-manager|\.\/native-access-settings|@\/app\/users\/page)$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:args.path==='auth'
        ? 'export const useAuth=()=>({accessToken:window.token});'
        : 'export const CreateGrant=()=>null;export const GroupManager=()=>null;export const NativeAccessSettingsPanel=()=>null;export default function UsersPage(){return null;}'}));
    }}],
    define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/authorization-read-test.js',
  });
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  try {
    for(const kind of ['grants','audit']) await t.test(kind,async()=>{
      const page=await browser.newPage();page.setDefaultTimeout(10000);
      let status=200;let reads=0;const errors=[];const writes=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{
        const request=route.request();
        if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
        if(request.method()!=='GET'){writes.push(request.url());return route.abort('blockedbyclient');}
        const path=new URL(request.url()).pathname;
        assert.equal(path,kind==='grants'?'/api/users/access-grants':'/api/users/authorization-changes');reads++;
        const other=request.headers().authorization==='Bearer identity-b';
        const json=kind==='grants'
          ? {items:[{id:'grant-a',principal:{type:'user',username:other?'other-principal':'private-principal'},cluster:{id:'cluster-a',name:'Private Cluster'},role:'viewer',state:'active',validFrom:'2026-01-01T00:00:00Z',expiresAt:null,namespaces:[{name:'prod',uid:'ns-a'}],capabilities:['logs'],version:1,updatedAt:'2026-10-13T00:00:00Z'}],total:1,timestamp:'2026-10-13T00:00:00Z'}
          : {items:[{id:'change-a',actorUserId:other?'other-actor':'private-actor',affectedUserId:'user-a',grantId:'grant-a',version:1,reason:'grant-created',committedAt:'2026-10-13T00:00:00Z'}],total:41,page:1,pageSize:20};
        return route.fulfill({status,json:status===200?json:{message:'fixture unavailable'}});
      });
      await page.goto('http://authorization-test.local/');await page.evaluate(()=>window.token='identity-a');
      await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
      const activate=()=>page.getByRole('tab',{name:kind==='grants'?'集群访问授权':'授权审计',exact:true}).click();
      await activate();
      const text=kind==='grants'?'private-principal':'private-actor';
      const visible=()=>page.locator('body').innerText();
      await page.getByText(text,{exact:true}).waitFor();await page.waitForFunction(()=>window.idle());
      if(kind==='grants'){
        await page.getByRole('button',{name:/^撤\s*销$/}).click();
        await page.getByRole('button',{name:/^取\s*消$/}).click();
        assert.deepEqual(writes,[],'opening and cancelling revoke must not write');
      }
      const refresh=async code=>{status=code;const before=reads;await page.evaluate(()=>window.refresh());await page.waitForFunction(()=>window.idle());assert.ok(reads>before);};
      await refresh(503);assert.ok((await visible()).includes(text),'transient failure preserves authorized snapshot');
      assert.equal(await page.locator('.ant-alert-warning').count(),1,'snapshot failure provides warning feedback');
      await refresh(403);assert.ok(!(await visible()).includes(text),'denial hides private rows');
      if(kind==='audit')assert.equal(await page.locator('.ant-pagination-item-3').count(),0,'denial hides cached pagination total');
      await refresh(503);assert.ok(!(await visible()).includes(text),'transient failure cannot unlatch denial');
      await page.evaluate(()=>window.remount());await activate();await page.waitForFunction(()=>window.idle());
      assert.ok(!(await visible()).includes(text),'remount cannot revive a denied cache');
      await refresh(200);await page.getByText(text,{exact:true}).waitFor();
      status=503;await page.evaluate(()=>window.switchToken('identity-b'));await page.waitForFunction(()=>window.idle());
      assert.ok(!(await visible()).includes(text),'new identity cannot render old snapshot');
      await refresh(200);await page.getByText(kind==='grants'?'other-principal':'other-actor',{exact:true}).waitFor();
      assert.ok(!(await visible()).includes(text),'successful new-token read remains isolated');
      await page.evaluate(()=>window.switchToken(null));
      assert.ok(!(await visible()).includes(kind==='grants'?'other-principal':'other-actor'),'signed-out render hides identity data');
      assert.deepEqual(writes,[],'read regression never performs authorization writes');assert.deepEqual(errors,[]);
      await page.close();
    });
  } finally {await browser.close();}
});
