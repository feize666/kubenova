import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Missing candidate gates must fail these tests even when AntD retains selected values.
test('rendered authorization forms block stale selections after denied reads and recover without erasing drafts', async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {CreateGrant} from './create-grant';
      import {GroupManager} from './group-manager';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
      window.candidatesIdle=()=>client.isFetching()===0;
      window.refreshCandidates=()=>client.refetchQueries({type:'active'});
      window.fixtureToken='token-a';
      function Fixture(){const [token,setToken]=React.useState('token-a');const [mode,setMode]=React.useState('group');const [mount,setMount]=React.useState(0);
        window.switchToken=(value='token-b')=>{window.fixtureToken=value;setToken(value);};
        window.remountForm=()=>setMount(mount+1);
        return <><button onClick={()=>setMode(mode==='group'?'grant':'group')}>Switch form</button>
        <button onClick={()=>setMount(mount+1)}>Remount form</button>
        <button onClick={()=>{window.fixtureToken='token-b';setToken('token-b');}}>Switch token</button>
        {mode==='group'?<GroupManager key={mount}/>:<CreateGrant key={mount} token={token} onClose={()=>{}}/>}</>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'fixture-auth', setup(builder) {
      builder.onResolve({ filter: /auth-context$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useAuth=()=>({accessToken:window.fixtureToken});', loader: 'js' }));
    } }],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CONTROL_API_BASE': '""' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/grant-mutations-test.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = []; const writes = [];
    page.on('pageerror', error => errors.push(error.message));
    const statuses = new Map();
    await page.route('http://grant-test.local/**', route => {
      const request=route.request();
      if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      const path=new URL(request.url()).pathname;
      if(request.method()!=='GET'){writes.push({path,method:request.method(),body:request.postDataJSON()});return route.fulfill({json:{id:'grant-fixture',version:1,active:true}});}
      const status=statuses.get(path)??200;
      let json={message:'fixture unavailable'};
      if(status===200){
        if(path==='/api/users')json={items:[{id:'user-a',username:'reader-a',name:'Reader A',role:'viewer',isActive:true,createdAt:'2026-01-01',updatedAt:'2026-01-01'}],total:1,page:1,pageSize:100,timestamp:'2026-10-13'};
        else if(path==='/api/users/grant-groups')json={items:[{id:'group-a',name:'Team A'}]};
        else if(path==='/api/users/identity-groups/group-a/members')json={group:{id:'group-a',name:'Team A',active:true,managedExternally:false},items:[],total:0};
        else if(path==='/api/clusters')json={items:[{id:'cluster-a',name:'Cluster A'}],total:1,page:1,pageSize:100};
        else if(path==='/api/namespaces')json={items:[{namespace:'prod',name:'prod',clusterId:'cluster-a'}],total:1};
        else throw new Error('Unexpected request '+path);
      }
      return route.fulfill({status,json});
    });
    await page.goto('http://grant-test.local/');
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const select = async (control,label) => { await control.click(); await page.locator('.ant-select-item-option-content').getByText(label,{exact:true}).click(); };
    const refresh = async (path,status) => {await page.waitForFunction(()=>window.candidatesIdle());statuses.set(path,status);await page.evaluate(()=>window.refreshCandidates());await page.waitForFunction(()=>window.candidatesIdle());};
    await select(page.getByRole('combobox',{name:'用户组',exact:true}),'Team A');
    await select(page.getByRole('combobox',{name:'添加用户',exact:true}),'reader-a');
    const add=page.getByRole('button',{name:'添加成员',exact:true});
    await refresh('/api/users',503);
    assert.equal(await add.isEnabled(),true,'Transient failures retain independently authorized candidates');
    await refresh('/api/users',403);
    assert.equal(await add.isDisabled(),true,'Denied user candidates must block adding the retained user selection');
    await refresh('/api/users',503);
    assert.equal(await add.isDisabled(),true);
    assert.match(await page.getByRole('combobox',{name:'添加用户',exact:true}).locator('..').innerText(),/user-a|reader-a/,'Selected draft is retained');
    assert.equal(writes.length,0);
    await page.evaluate(()=>window.remountForm());
    await page.waitForFunction(()=>window.candidatesIdle());
    await select(page.getByRole('combobox',{name:'用户组',exact:true}),'Team A');
    assert.equal(await add.isDisabled(),true,'Remount cannot revive a denied user cache');
    await refresh('/api/users',200);
    await select(page.getByRole('combobox',{name:'添加用户',exact:true}),'reader-a');
    assert.equal(await add.isEnabled(),true);
    await page.evaluate(()=>window.switchToken());
    await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/users');
    await page.waitForFunction(()=>window.candidatesIdle());
    assert.equal(await add.isDisabled(),true,'Group draft from another identity must be reselected');
    await page.evaluate(()=>window.switchToken('token-a'));
    await page.waitForFunction(()=>window.candidatesIdle());
    await add.click();
    await page.waitForFunction(()=>window.candidatesIdle());
    assert.deepEqual(writes.splice(0),[{path:'/api/users/identity-groups/group-a/members/user-a',method:'PUT',body:null}]);
    await page.getByRole('button',{name:'Switch form'}).click();
    await select(page.getByRole('combobox',{name:/用户/}),'reader-a');
    await select(page.getByRole('combobox',{name:/集群/}),'Cluster A');
    await select(page.getByRole('combobox',{name:/命名空间/}),'prod');
    const submit=page.locator('.ant-modal-footer .ant-btn-primary').filter({hasText:'创建授权'});
    await submit.waitFor({state:'visible'});
    assert.equal((await submit.innerText()).trim(),'创建授权');
    for(const path of ['/api/users','/api/clusters','/api/namespaces']){
      await refresh(path,503); assert.equal(await submit.isEnabled(),true);
      await refresh(path,403); assert.equal(await submit.isDisabled(),true,'Denied '+path+' must block authorization writes');
      await refresh(path,503); assert.equal(await submit.isDisabled(),true);
      assert.equal(writes.length,0);
      await refresh(path,200); assert.equal(await submit.isEnabled(),true);
    }
    await submit.click();
    await page.waitForTimeout(100);
    assert.equal(writes.length,1);
    assert.equal(writes[0].path,'/api/users/access-grants');
    assert.deepEqual(writes[0].body,{userId:'user-a',clusterId:'cluster-a',namespaces:['prod'],role:'viewer',capabilities:[]});
    writes.length=0;
    await page.getByText('用户组',{exact:true}).last().click();
    await select(page.getByRole('combobox',{name:/用户组/}),'Team A');
    await refresh('/api/users/grant-groups',403);
    assert.equal(await submit.isDisabled(),true);
    await refresh('/api/users/grant-groups',503);
    assert.equal(await submit.isDisabled(),true);
    await refresh('/api/users/grant-groups',200);
    assert.equal(await submit.isEnabled(),true);
    statuses.set('/api/users/grant-groups',503);
    await page.evaluate(()=>window.switchToken());
    await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/users/grant-groups');
    await page.waitForFunction(()=>window.candidatesIdle());
    assert.equal(await submit.isDisabled(),true,'A different token cannot reuse prior-token candidates');
    await refresh('/api/users/grant-groups',200);
    assert.equal(await submit.isDisabled(),true,'Fresh token candidates do not validate prior identity draft selections');
    assert.equal(writes.length,0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
