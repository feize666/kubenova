import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('real drawer renders paginated owned pods, navigates by ID, returns, and guards denied snapshots', async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {ResourceDetailDrawer} from './resource-detail-drawer';
        import {defaultQueryOptions} from '../../lib/query/policies';
        const client=new QueryClient({defaultOptions:{queries:{...defaultQueryOptions.queries,retry:false,retryDelay:0}}});
        window.refreshPods=()=>client.refetchQueries({predicate:q=>q.queryKey[0]==='detail-pod-relations'});
        window.readStatus=()=>client.getQueryCache().getAll().find(q=>q.queryKey[0]==='detail-pod-relations')?.state.error?.status;
        window.navigation=[];
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><ResourceDetailDrawer open token="account-a" request={{kind:'Deployment',id:'web-id'}} onClose={()=>{}} onNavigateRequest={r=>window.navigation.push(r)}/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{ name: 'unrelated-surfaces', setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/auth-context|next\/navigation|@\/components\/runtime-workbench\/pod-runtime-overlay|@\/components\/resource-yaml-drawer|@\/components\/resource-detail\/workload-access)$/}, args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents:
        args.path==='next/navigation' ? 'export const useRouter=()=>({push(){throw new Error("unexpected route navigation")}});export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/clusters/c1/workloads";'
        : args.path==='@/components/auth-context' ? 'export const useAuth=()=>({role:"admin",accessToken:"account-a",username:"test",isInitializing:false});'
        : args.path.endsWith('pod-runtime-overlay') ? 'export const PodRuntimeOverlay=()=>null;'
        : args.path.endsWith('workload-access') ? 'export const WorkloadAccess=()=>null;'
        : 'export const ResourceYamlDrawer=()=>null;', loader:'js'}));
    }}],
    define: {'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"test"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/detail-pod-list-browser.js',
  });
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(8000);
  const errors=[];
  const requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  let status=200;
  let failKind='Pod';
  const pod=(name,refs,labels={app:'shared'})=>({id:name+'-id',clusterId:'c1',namespace:'prod',kind:'Pod',name,replicas:1,readyReplicas:1,state:'active',labels,statusJson:{phase:'Running',ownerReferences:refs,podIP:'10.0.0.1',nodeName:'node-1'},createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'});
  const pods=[...Array.from({length:200},(_,i)=>pod('other-'+i,[{kind:'ReplicaSet',name:'other-rs',uid:'rs-other',controller:true}])),pod('owned-page2',[{kind:'ReplicaSet',name:'web-rs',uid:'rs-uid',controller:true}])];
  const rs={...pod('web-rs',[]),kind:'ReplicaSet',statusJson:{uid:'rs-uid',ownerReferences:[{kind:'Deployment',name:'web',uid:'web-uid',controller:true}]}};
  const detail=(isPod)=>({
    descriptor:{resourceKind:isPod?'Pod':'Deployment',sections:['overview','runtime','metadata','associations','events'],capabilities:{rawSpec:true,rawStatus:true,relationships:true},fieldsBySection:{}},
    overview:{id:isPod?'owned-page2-id':'web-id',kind:isPod?'Pod':'Deployment',name:isPod?'owned-page2':'web',clusterId:'c1',namespace:'prod',state:'active',createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'},
    rawSpec:isPod?{}:{selector:{matchLabels:{app:'shared'}}},rawStatus:{uid:isPod?'pod-uid':'web-uid'},
    runtime:{replicas:1,readyReplicas:1,containerDetails:[]},metadata:{labels:{app:'shared'},annotations:{},ownerReferences:[],configUsages:[]},
    associations:[],relationships:[],events:{items:[],status:'empty'},network:{},storage:{},generatedAt:'2026-10-11T00:00:00Z',
  });
  try {
    await page.route('**/*',async route=>{
      const request=route.request();
      const url=new URL(request.url());
      if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      if(request.method()!=='GET')throw new Error('mutations forbidden in fixture');
      assert.equal(url.host,'detail-test.local');
      if(url.pathname==='/api/clusters')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[{id:'c1',name:'Fixture'}],total:1})});
      if(url.pathname==='/api/cluster-health')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[],total:0})});
      if(url.pathname.endsWith('/detail'))return route.fulfill({contentType:'application/json',body:JSON.stringify(detail(url.pathname.includes('/pod/')))});
      assert.equal(url.pathname,'/api/workloads');
      const kind=url.searchParams.get('kind'); const currentPage=Number(url.searchParams.get('page')||1);
      requests.push({kind,page:currentPage,cluster:url.searchParams.get('clusterId'),namespace:url.searchParams.get('namespace'),token:request.headers().authorization,keyword:url.searchParams.get('keyword')});
      const resultStatus=kind===failKind?status:200;
      const source=kind==='Pod'?pods:kind==='ReplicaSet'?[rs]:[];
      return route.fulfill({status:resultStatus,contentType:'application/json',body:JSON.stringify(resultStatus===200?{items:source.slice((currentPage-1)*200,currentPage*200),total:source.length,page:currentPage,pageSize:200}:{message:'Fixture denied/unavailable'})});
    });
    await page.goto('http://detail-test.local/');
    const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
    if(css)await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    await page.getByRole('tab',{name:'Pod 列表',exact:true}).click();
    console.log('stage: initial pods');
    // The table uses anchors without href, so query the accessible text directly.
    const podLink=page.locator('.ant-table a').filter({hasText:'owned-page2'});
    await podLink.waitFor();
    assert.equal(await page.locator('.ant-table tbody tr.ant-table-row').count(),1);
    assert.ok(requests.some(request=>request.kind==='Pod'&&request.page===2));
    assert.ok(requests.every(request=>request.cluster==='c1'&&request.namespace==='prod'&&request.token==='Bearer account-a'));
    assert.equal(requests.some(request=>request.kind==='Job'),false);
    await podLink.click();
    console.log('stage: pod clicked');
    await page.getByRole('tab',{name:'日志',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.navigation),[{kind:'Pod',id:'owned-page2-id'}]);
    await page.getByRole('button',{name:/返\s*回/}).click();
    console.log('stage: returned');
    await page.getByRole('tab',{name:'Pod 列表',exact:true}).click();
    await podLink.waitFor();
    console.log('stage: refresh failure');
    status=503;
    await page.getByRole('tab',{name:'概览',exact:true}).click();
    await page.getByRole('tab',{name:'Pod 列表',exact:true}).click();
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await podLink.count(),1,'returning to the tab must reread relations even with production cache defaults');
    await page.evaluate(()=>window.refreshPods());
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await podLink.count(),1,'ordinary 503 keeps authorized snapshot');
    status=403; failKind='ReplicaSet';
    await page.evaluate(()=>window.refreshPods());
    await page.waitForFunction(()=>window.readStatus()===403);
    assert.equal(await podLink.count(),0,'intermediary denial blocks cached pod membership');
    status=503;
    await page.evaluate(()=>window.refreshPods());
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await podLink.count(),0,'503 does not reauthorize denied cache');
    await page.getByRole('tab',{name:'概览',exact:true}).click();
    await page.getByRole('tab',{name:'Pod 列表',exact:true}).click();
    assert.equal(await podLink.count(),0,'remount cannot expose denied cached pods');
    status=200;
    await page.evaluate(()=>window.refreshPods());
    await podLink.waitFor();
    assert.deepEqual(errors,[]);
    assert.equal(page.url(),'http://detail-test.local/');
    console.log('fixture browser: page 2 / name -> Pod ID / drawer return / 503 snapshot / RS403 -> 503 -> remount -> recovery verified');
  } finally {await browser.close();}
});
