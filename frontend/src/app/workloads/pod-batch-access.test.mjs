import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) test(`Pod batch expires denied confirmations and retains only failed targets after mixed results at ${width}px/${theme}`, async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import PodsPage from './pods/page';
        import '../globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        window.refreshPods=()=>client.refetchQueries({queryKey:['workloads','pods']});
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><PodsPage/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx',
    },
    plugins: [{ name: 'page-context', setup(builder) {
      builder.onResolve({filter:/^(?:next\/navigation|@\/components\/(?:auth-context|cluster-workspace-context|theme-context)|@\/hooks\/use-cluster-namespace-filter)$/},args=>({path:args.path,namespace:'test-context'}));
      builder.onLoad({filter:/.*/,namespace:'test-context'},args=>({contents:args.path==='next/navigation'
        ? `export const useRouter=()=>({push(){throw new Error('unexpected navigation')},replace(){}});export const usePathname=()=>'/workloads/pods';export const useSearchParams=()=>new URLSearchParams();export const useParams=()=>({});`
        :args.path.endsWith('auth-context')
        ? `import React from 'react';export const useAuth=()=>{const [accessToken,setToken]=React.useState('fixture-token');React.useEffect(()=>{window.changeBatchToken=setToken;},[]);return {role:'admin',accessToken,username:'fixture-admin',isInitializing:false,isAuthenticated:true};};`
        :args.path.endsWith('theme-context')
        ? `export const useThemeMode=()=>({mode:${JSON.stringify(theme)},toggleTheme(){}});`
        :args.path.endsWith('use-cluster-namespace-filter')
        ? `import React from 'react';export const useClusterNamespaceFilter=()=>{const [namespace,setNamespace]=React.useState('default');React.useEffect(()=>{window.changeBatchNamespace=setNamespace;},[]);return {clusterId:'cluster-a',namespace,namespaceDisabled:false,namespacePlaceholder:'命名空间',onScopeChange(){}};};`
        : `export const useOptionalClusterWorkspace=()=>null;export const useClusterWorkspaceHref=value=>value;export const useClusterWorkspace=()=>({clusterId:'cluster-a'});`,loader:'js',resolveDir:process.cwd()}));
    }}],
    define:{'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"test"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/pod-batch-test.js',
  });
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  try {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    let status=200;
    let writes=0;
    let allowFixtureDelete=false;
    const attempts=[];
    let holdFirstWrite=false;
    let releaseFirstWrite;
    const row={id:'fixture-pod',clusterId:'cluster-a',namespace:'default',kind:'Pod',name:'qa-pod',replicas:1,readyReplicas:1,state:'active',status:'Running',statusJson:{uid:'uid-a',phase:'Running',containerNames:['web']},createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'};
    let rows=[row];
    await page.route('http://pod-test.local/**',async route=>{
      const request=route.request();
      const path=new URL(request.url()).pathname;
      if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      if(request.method()!=='GET'){
        writes++;
        if(allowFixtureDelete&&request.method()==='POST'&&/^\/api\/workloads\/fixture-pod(?:-b)?\/actions$/.test(path)){
          attempts.push({path,body:request.postDataJSON()});
          if(holdFirstWrite&&path==='/api/workloads/fixture-pod/actions')await new Promise(resolve=>{releaseFirstWrite=resolve;});
          if(path.includes('fixture-pod-b'))return route.fulfill({status:409,json:{message:'Fixture identity conflict'}});
          rows=rows.filter(item=>item.id!=='fixture-pod');
          return route.fulfill({json:{data:{success:true}}});
        }
        return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:'writes forbidden'})});
      }
      let data={items:[]};
      if(path==='/api/workloads') {
        if(status!==200)return route.fulfill({status,contentType:'application/json',body:JSON.stringify({message:status===403?'Forbidden':'Unavailable'})});
        data={items:rows,total:rows.length,timestamp:'2026-10-11T00:00:00Z'};
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
    });
    await page.goto('http://pod-test.local/');
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
    if(css)await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const rowHost=page.locator(width<768?'.resource-table-mobile-list':'.ant-table-tbody');
    const checkbox=rowHost.locator(width<768?'.ant-checkbox-input':'tr.ant-table-row .ant-checkbox-input');
    await checkbox.waitFor();
    await checkbox.check();
    await page.getByRole('button',{name:'批量删除',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.waitFor();
    await page.getByRole('textbox',{name:'输入 DELETE 以确认操作'}).fill('DELETE');
    status=503;
    await page.evaluate(()=>window.refreshPods());
    await page.getByText('Pod刷新失败，当前内容可能已过期',{exact:true}).waitFor();
    assert.equal(await dialog.count(),1,'ordinary refresh failures must preserve the confirmation and selection');
    status=403;
    await page.evaluate(()=>window.refreshPods());
    await page.getByText('Pod访问权限校验失败',{exact:true}).waitFor();
    assert.equal(await dialog.count(),0,'a denied read must dismiss stale target confirmation');
    assert.equal(await page.getByRole('button',{name:'批量删除',exact:true}).count(),0,'denied snapshots must not keep actionable selected targets');
    status=503;
    await page.evaluate(()=>window.refreshPods());
    assert.equal(await page.getByRole('button',{name:'批量删除',exact:true}).count(),0);
    status=200;
    await page.evaluate(()=>window.refreshPods());
    await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(),false,'recovered authorization requires a fresh selection');
    assert.equal(writes,0);
    await checkbox.check();
    await page.getByRole('button',{name:'批量删除',exact:true}).click();
    await page.getByRole('textbox',{name:'输入 DELETE 以确认操作'}).fill('DELETE');
    await page.evaluate(()=>window.changeBatchToken('fixture-token-new'));
    await dialog.waitFor({state:'hidden'});
    await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(),false,'account changes must invalidate previously selected targets');
    assert.equal(await page.getByRole('button',{name:'批量删除',exact:true}).count(),0);
    assert.equal(writes,0,'changing accounts must never execute an old confirmation');
    await checkbox.check();
    await page.getByRole('button',{name:'批量删除',exact:true}).click();
    await page.getByRole('textbox',{name:'输入 DELETE 以确认操作'}).fill('DELETE');
    await page.evaluate(()=>window.changeBatchNamespace('other'));
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button',{name:'批量删除',exact:true}).count(),0);
    assert.equal(writes,0,'changing namespaces must never execute an old confirmation');
    await page.evaluate(()=>window.changeBatchNamespace('default'));
    await checkbox.waitFor();
    assert.equal(await checkbox.isChecked(),false,'returning to a namespace must not restore stale selected targets');
    rows=[row,{...row,id:'fixture-pod-b',name:'qa-pod-b',statusJson:{...row.statusJson,uid:'uid-b'}}];
    await page.evaluate(()=>window.refreshPods());
    await rowHost.getByText('qa-pod-b',{exact:true}).waitFor();
    for(const selected of await checkbox.all())await selected.check();
    allowFixtureDelete=true;
    await page.getByRole('button',{name:'批量删除',exact:true}).click();
    await page.getByRole('textbox',{name:'输入 DELETE 以确认操作'}).fill('DELETE');
    await page.getByRole('button',{name:'确认删除',exact:true}).click();
    await page.getByText('处理完成：成功 1，失败 1',{exact:true}).waitFor();
    await page.getByText('已选择 1 个 Pod',{exact:true}).waitFor();
    assert.equal(await dialog.count(),1,'mixed results must stay available after the page refresh');
    await dialog.locator('.ant-modal-footer button.ant-btn-primary').click();
    await rowHost.getByText('qa-pod',{exact:true}).waitFor({state:'hidden'});
    assert.equal(await checkbox.isChecked(),true,'failed target remains selected after the success row disappears');
    assert.deepEqual(attempts,[
      {path:'/api/workloads/fixture-pod/actions',body:{action:'delete',payload:{expectedUid:'uid-a'}}},
      {path:'/api/workloads/fixture-pod-b/actions',body:{action:'delete',payload:{expectedUid:'uid-b'}}},
    ]);
    assert.equal(writes,2,'mixed results must not automatically retry the failed target');
    await page.getByRole('button',{name:'取消选择',exact:true}).click();
    rows=[row,{...row,id:'fixture-pod-b',name:'qa-pod-b',statusJson:{...row.statusJson,uid:'uid-b'}}];
    await page.evaluate(()=>window.refreshPods());
    await rowHost.getByText('qa-pod',{exact:true}).waitFor();
    for(const selected of await checkbox.all())await selected.check();
    holdFirstWrite=true;
    await page.getByRole('button',{name:'批量删除',exact:true}).click();
    await page.getByRole('textbox',{name:'输入 DELETE 以确认操作'}).fill('DELETE');
    await page.getByRole('button',{name:'确认删除',exact:true}).click();
    for(let attempt=0;attempt<100&&!releaseFirstWrite;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(typeof releaseFirstWrite,'function','first write must be pending before changing identity');
    await page.evaluate(()=>window.changeBatchToken('fixture-token-inflight'));
    await dialog.waitFor({state:'hidden'});
    releaseFirstWrite();
    await page.waitForTimeout(300);
    assert.equal(writes,3,'identity changes during the first write must block the next queued write');
    assert.equal(await page.getByRole('button',{name:'批量删除',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
