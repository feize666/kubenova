import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// A naked query or an unconditional error return must not expose revoked data
// or discard the last authorized snapshot during an ordinary outage.
test('workload access retains authorized rows on 503 but never restores denied rows without 200', async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {WorkloadAccess} from './workload-access';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}});
      const root=createRoot(document.getElementById('root'));
      window.refresh=()=>client.refetchQueries({queryKey:['resource-access']});
      window.queryState=()=>{const q=client.getQueryCache().getAll()[0];return {status:q?.state.error?.status,fetchStatus:q?.state.fetchStatus};};
      const detail={overview:{clusterId:'cluster-a',namespace:'prod',kind:'Deployment',name:'web'}};
      window.mount=()=>root.render(<QueryClientProvider client={client}><WorkloadAccess detail={detail}/></QueryClientProvider>);
      window.unmount=()=>root.render(<QueryClientProvider client={client}/>);
      window.mount();`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'unrelated-editor-and-auth', setup(builder) {
      builder.onResolve({filter:/^@\/components\/(?:auth-context|ops|resource-editor\/resource-editor-page)$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('auth-context')
        ? 'export const useAuth=()=>({accessToken:"account-a"});'
        : args.path.endsWith('/ops') ? 'export const OpsDrawerShell=()=>null;'
        : 'export const EditorDocument=()=>null;', loader:'js'}));
    }}],
    define:{'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"test"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/workload-access-browser.js',
  });
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(8000);
  let status=200;
  let reads=0;
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const workload={apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'web',namespace:'prod',uid:'web-id'},spec:{selector:{matchLabels:{app:'web'}},template:{metadata:{labels:{app:'web'}}}}};
  const service={apiVersion:'v1',kind:'Service',metadata:{name:'private-service',namespace:'prod',uid:'service-id'},spec:{type:'ClusterIP',selector:{app:'web'},ports:[{port:80,targetPort:8080}],clusterIP:'10.0.0.1'}};
  const fixture={workload,canMutate:false,limit:200,lists:[{kind:'Deployment',items:[workload],incomplete:false},{kind:'Service',items:[service],incomplete:false},{kind:'Pod',items:[],incomplete:false},{kind:'Ingress',items:[],incomplete:false},{kind:'Endpoints',items:[],incomplete:false},{kind:'EndpointSlice',items:[],incomplete:false}]};
  try {
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      assert.equal(request.method(),'GET','real writes are prohibited');
      assert.equal(url.pathname,'/api/resources/access/context');
      assert.equal(url.searchParams.get('clusterId'),'cluster-a');
      assert.equal(url.searchParams.get('namespace'),'prod');
      assert.equal(request.headers().authorization,'Bearer account-a');
      reads++;
      await new Promise(resolve=>setTimeout(resolve,50));
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?fixture:{message:'Fixture read failure'})});
    });
    await page.goto('http://access-test.local/');
    const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
    if(css)await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const row=page.locator('.ant-table a').filter({hasText:'private-service'});
    await row.waitFor();
    await page.evaluate(()=>{window.deniedFrames=[];new MutationObserver(()=>window.deniedFrames.push(document.querySelector('.ant-table')?.textContent?.includes('private-service')||false)).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});});
    status=503;
    await page.evaluate(()=>window.refresh());
    await page.waitForFunction(()=>window.queryState().status===503&&window.queryState().fetchStatus==='idle');
    assert.equal(await row.count(),1,'ordinary outage must retain the authorized service row');
    await page.getByText(/已保留最近一次成功读取的数据/).waitFor();
    status=403;
    await page.evaluate(()=>window.refresh());
    await page.waitForFunction(()=>window.queryState().status===403&&window.queryState().fetchStatus==='idle');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await row.count(),0,'403 must immediately hide cached service');
    await page.evaluate(()=>window.deniedFrames=[]);
    status=503;
    await page.evaluate(()=>window.refresh());
    await page.waitForFunction(()=>window.queryState().status===503&&window.queryState().fetchStatus==='idle');
    assert.equal(await row.count(),0,'503 cannot release revoked service cache');
    await page.evaluate(()=>window.unmount());
    await page.waitForFunction(()=>document.getElementById('root').textContent==='');
    const previousReads=reads;
    await page.evaluate(()=>window.mount());
    await page.waitForFunction(()=>window.queryState().fetchStatus==='fetching');
    await page.waitForFunction(()=>window.queryState().fetchStatus==='idle');
    assert.equal(reads,previousReads+1,'remount rereads without automatic retries');
    assert.equal(await row.count(),0,'remount cannot release revoked service cache');
    assert.ok((await page.evaluate(()=>window.deniedFrames)).every(visible=>!visible),'no denied render frame may expose cached service');
    assert.notEqual(await page.locator('#root').textContent(),'','denied read must retain actionable feedback, not an empty panel');
    status=200;
    await page.evaluate(()=>window.refresh());
    await row.waitFor();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
