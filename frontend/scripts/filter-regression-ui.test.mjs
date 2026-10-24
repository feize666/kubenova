import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

test('filter matrix uses the actual Pod namespace picker and resource search on built pages', async () => {
  const origin=process.env.FILTER_QA_URL || 'http://127.0.0.1:3000';
  const source=readFileSync(new URL('./filter-regression-matrix.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/main\(\)\.catch\([\s\S]*$/,'');
  const context=vm.createContext({process:{env:{FILTER_BASE_URL:origin,FILTER_TIMEOUT_MS:process.env.FILTER_QA_TIMEOUT_MS||'30000'}},URL,URLSearchParams,existsSync,console});
  vm.runInContext(`${source}\nthis.matrix={ALL_CASES,resolveSampleClusterAndNamespace,assertUrlRestore,assertFetchTriggeredByFilters};`,context);
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL || 'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
    const errors=[],unexpected=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('aiops_auth_access','filter-fixture');
      localStorage.setItem('aiops_auth_user','Filter Fixture');
      localStorage.setItem('aiops_auth_role','admin');
      localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova.console.utility-sidebar.collapsed','1');
    });
    await page.routeWebSocket('**/*',socket=>socket.close());
    const stamp='2026-10-12T00:00:00Z',clusterId='filter-fixture-cluster';
    await page.route('**/api/**',route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname;
      const fulfill=data=>route.fulfill({json:{data}});
      if(request.method()!=='GET') {unexpected.push(`${request.method()} ${path}`);return route.fulfill({status:405,json:{message:'Writes blocked'}});}
      if(path==='/api/v1/auth/me')return fulfill({user:{username:'Filter Fixture',role:'admin'},expiresAt:'2030-01-01T00:00:00Z'});
      if(path==='/api/capabilities'||path==='/api/ai-assistant/sessions')return fulfill([]);
      if(path==='/api/system/update/status')return fulfill({updateAvailable:false});
      if(path.startsWith('/api/users/preferences/table/'))return fulfill(null);
      if(path.endsWith('/events/stream'))return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
      if(path==='/api/clusters')return fulfill({items:[{id:clusterId,name:'Filter Fixture Cluster',state:'active',hasKubeconfig:true}],total:1});
      if(path==='/api/cluster-health')return fulfill({items:[{clusterId,runtimeStatus:'running'}],total:1});
      if(path==='/api/namespaces')return fulfill({items:[{id:'prod-id',clusterId,clusterName:'Filter Fixture Cluster',namespace:'prod',state:'active',labels:{},createdAt:stamp,updatedAt:stamp}],total:1,page:1,pageSize:500,timestamp:stamp});
      if(path==='/api/workloads'||path==='/api/network') {
        const kind=url.searchParams.get('kind'),keyword=url.searchParams.get('keyword')||'';
        const row={id:'filter-row',name:'filter-fixture-pod',namespace:'prod',clusterId,kind,state:'active',labels:{app:'fixture'},statusJson:{phase:'Running'},spec:{},replicas:1,readyReplicas:1,createdAt:stamp,updatedAt:stamp};
        const items=row.name.includes(keyword)?[row]:[];
        return fulfill({items,total:items.length,page:1,pageSize:25,timestamp:stamp});
      }
      unexpected.push(`GET ${path}`);return route.fulfill({status:500,json:{message:'Missing filter fixture'}});
    });
    const sample=await context.matrix.resolveSampleClusterAndNamespace(page);
    assert.equal(sample.clusterId,clusterId);
    assert.equal(sample.namespace,'prod');
    for(const id of ['workloads-pods','network-services']) {
      const entry=context.matrix.ALL_CASES.find(item=>item.id===id);
      await context.matrix.assertUrlRestore(page,entry,sample);
      await context.matrix.assertFetchTriggeredByFilters(page,entry,sample);
      assert.equal(new URL(page.url()).searchParams.get('namespace'),'prod');
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpected,[]);
  } finally {await browser.close();}
});
