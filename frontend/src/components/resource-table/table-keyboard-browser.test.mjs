import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

let browser, bundle;
before(async () => {
  bundle = await build({
    stdin: {
      loader: 'tsx', resolveDir: new URL('../../../', import.meta.url).pathname,
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ResourceTable} from './src/components/resource-table';
        import {ThemeProvider} from './src/components/theme-context';
        import './src/app/globals.css';
        const params=new URLSearchParams(location.search);
        const rows=Array.from({length:5},(_,index)=>({id:String(index+1),name:'pod-'+(index+1),kind:'Pod',namespace:'prod',clusterId:'c1',status:'Running'}));
        function Fixture(){
          const [scope,setScope]=React.useState({user:'fixture',table:'keyboard-fixture'});
          window.fixtureUser=scope.user;
          const [selected,setSelected]=React.useState([]);
          const [opened,setOpened]=React.useState([]);
          const [actions,setActions]=React.useState([]);
          const [changes,setChanges]=React.useState([]);
          const rowSelection={type:params.get('radio')==='1'?'radio':'checkbox',
            ...(params.get('controlled')==='0'?{}:{selectedRowKeys:selected}),
            preserveSelectedRowKeys:true,getCheckboxProps:row=>({disabled:row.id==='2'}),onChange:setSelected};
          return <main style={{padding:16}}><ResourceTable
            tableKey={params.get('standard')==='1'?undefined:scope.table}
            showToolbar={params.get('toolbar')==='1'} viewportScroll={false}
            columns={[{key:'name',title:'名称',dataIndex:'name',width:240,sorter:(a,b)=>a.name.localeCompare(b.name)},
              {key:'status',title:'状态',dataIndex:'status',width:130},
              {key:'actions',title:'操作',width:96,render:(_,row)=><button aria-label={'更多 '+row.name} onClick={()=>setActions(previous=>[...previous,row.id])}>更多</button>}]}
            dataSource={rows} rowKey="id" rowSelection={rowSelection}
            pagination={{pageSize:2,total:5,showSizeChanger:false}}
            onChange={(pagination,filters,sorter,extra)=>setChanges(previous=>[...previous,{page:pagination.current,action:extra.action,order:sorter.order}])}
            onResourceNavigate={request=>setOpened(previous=>[...previous,request.id])}/>
            <output id="selected">{JSON.stringify(selected)}</output>
            <output id="opened">{JSON.stringify(opened)}</output>
            <output id="actions">{JSON.stringify(actions)}</output>
            <output id="changes">{JSON.stringify(changes)}</output>
            {params.get('scopes')==='1'&&<><button onClick={()=>setScope({user:'other',table:'keyboard-fixture'})}>Other account</button><button onClick={()=>setScope({user:'fixture',table:'nodes'})}>Other table</button><button onClick={()=>setScope({user:'fixture',table:'keyboard-fixture'})}>Original scope</button></>}
          </main>;
        }
        createRoot(document.getElementById('root')).render(<ThemeProvider><Fixture/></ThemeProvider>);`,
    },
    plugins: [{name:'environment-boundaries',setup(builder){
      builder.onResolve({filter:/^(?:@\/components\/auth-context|@\/components\/resource-detail|next\/navigation)$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:
        args.path.endsWith('auth-context')?'export const useAuth=()=>({username:window.fixtureUser||"fixture",role:"admin",accessToken:null});'
          :args.path==='next/navigation'?'export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){throw Error("Unexpected route navigation")}});export const useSearchParams=()=>new URLSearchParams(location.search);'
            :'export const ResourceDetailDrawer=()=>null;'}));
    }}],
    define:{'process.env.NODE_ENV':'"test"'},bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/table-keyboard.js',logLevel:'silent',
  });
  browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
});
after(async()=>{await browser?.close();});

async function fixture(t,params='',viewport={width:1440,height:900}) {
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage();
  const errors=[],unexpected=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    if(route.request().resourceType()==='document'&&new URL(route.request().url()).host==='table-fixture.local')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><div id="root"></div></body></html>'});
    unexpected.push(route.request().url());return route.abort();
  });
  await page.goto('http://table-fixture.local/?'+params);
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.locator('.resource-table').waitFor();
  t.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}finally{await context.close();}});
  return page;
}
const read=async(page,id)=>JSON.parse(await page.locator('#'+id).textContent());

for(const standard of [true,false]) {
  test(`${standard?'Standard':'Headlamp'} forwards keyboard pagination and sorting changes to its consumer`,async t=>{
    const page=await fixture(t,`standard=${Number(standard)}`);
    await page.locator('.ant-pagination-next').press('Enter');
    assert.deepEqual(await read(page,'changes'),[{page:2,action:'paginate'}]);
    await page.locator('thead th').filter({hasText:'名称'}).first().press('Enter');
    assert.deepEqual((await read(page,'changes')).at(-1),{page:2,action:'sort',order:'ascend'});
  });
  for(const controlled of [true,false]) {
    test(`${standard?'Standard':'Headlamp'} ${controlled?'controlled':'uncontrolled'} selection shares keyboard state across desktop/mobile and honors disabled rows`,async t=>{
      const page=await fixture(t,`standard=${Number(standard)}&controlled=${Number(controlled)}`);
      const desktop=page.locator('.ant-table-row .ant-checkbox-input');
      await desktop.first().press('Space');
      assert.deepEqual(await read(page,'selected'),['1']);
      assert.equal(await desktop.nth(1).isDisabled(),true);
      await page.setViewportSize({width:390,height:844});
      const mobile=page.locator('.resource-table-mobile-list .ant-checkbox-input');
      assert.equal(await mobile.first().isChecked(),true);
      assert.equal(await mobile.nth(1).isDisabled(),true);
      await mobile.first().press('Space');
      assert.deepEqual(await read(page,'selected'),[]);
      await mobile.nth(2).press('Space');
      assert.deepEqual(await read(page,'selected'),['3']);
      assert.deepEqual(await read(page,'opened'),[],'selection must not activate the card');
      await page.setViewportSize({width:1440,height:900});
      await page.locator('.ant-pagination-next').press('Enter');
      assert.equal(await desktop.first().isChecked(),true,'page two reflects the selected third resource');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    });
  }
}
test('mobile card Enter/Space opens details while nested action Enter stays separate',async t=>{
  const page=await fixture(t,'',{width:390,height:844});
  const card=page.locator('[data-ops-mobile-resource-card]').first();
  await card.press('Enter');await card.press('Space');
  assert.deepEqual(await read(page,'opened'),['1','1']);
  await card.getByRole('button',{name:'更多 pod-1',exact:true}).press('Enter');
  assert.deepEqual(await read(page,'actions'),['1']);
  assert.deepEqual(await read(page,'opened'),['1','1']);
});
test('mobile radio remains single selection with visible keyboard focus in both themes',async t=>{
  const page=await fixture(t,'radio=1',{width:390,height:844});
  const radio=page.locator('.resource-table-mobile-list input[type=radio]');
  assert.equal(await radio.count(),5);
  await radio.first().press('Space');await radio.nth(2).press('Space');
  assert.deepEqual(await read(page,'selected'),['3']);
  assert.equal(await radio.first().isChecked(),false);
  const card=page.locator('[data-ops-mobile-resource-card]').first();
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await card.focus();
    assert.equal(await card.evaluate(element=>element.matches(':focus-visible')),true);
    const focus=await card.evaluate(element=>({outline:getComputedStyle(element).outlineStyle,shadow:getComputedStyle(element).boxShadow}));
    assert.ok(focus.outline!=='none'||focus.shadow!=='none','keyboard focus must be visible');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
});
test('column-width keyboard handles adjust without sorting',async t=>{
  const page=await fixture(t);
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  const width=Number(await handle.getAttribute('aria-valuenow'));
  await handle.press('ArrowRight');
  assert.equal(Number(await handle.getAttribute('aria-valuenow')),width+16);
  await handle.press('ArrowLeft');
  assert.equal(Number(await handle.getAttribute('aria-valuenow')),width);
  await handle.press('End');
  assert.equal(await handle.getAttribute('aria-valuenow'),await handle.getAttribute('aria-valuemax'));
  await handle.press('Home');
  assert.equal(await handle.getAttribute('aria-valuenow'),await handle.getAttribute('aria-valuemin'));
  assert.deepEqual(await read(page,'changes'),[]);
});

test('density reflects another window preference update without remounting the resource list',async t=>{
  const page=await fixture(t);
  const table=page.locator('.resource-table');
  const initial=await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height'));
  await page.evaluate(()=>{
    const key='resource-table-preferences:density:["fixture","keyboard-fixture"]';
    localStorage.setItem(key,JSON.stringify('compact'));
    window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify('compact'),storageArea:localStorage}));
  });
  await page.waitForFunction(initial=>document.querySelector('.resource-table').style.getPropertyValue('--resource-table-row-height')!==initial,initial,{timeout:2000});
  assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
  await page.evaluate(()=>{
    const key='resource-table-preferences:density:["fixture","keyboard-fixture"]';
    localStorage.setItem(key,JSON.stringify('standard'));
    window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify('standard'),storageArea:localStorage}));
  });
  await page.waitForFunction(initial=>document.querySelector('.resource-table').style.getPropertyValue('--resource-table-row-height')===initial,initial,{timeout:2000});
});

test('local density selection survives reload and later storage changes override that local selection',async t=>{
  const page=await fixture(t,'toolbar=1');
  const table=page.locator('.resource-table');
  const initial=await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height'));
  await page.getByText('紧凑',{exact:true}).click();
  assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
  await page.reload();
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await table.waitFor();
  assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
  await page.getByText('标准',{exact:true}).click();
  assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),initial);
  await page.evaluate(()=>{
    const key='resource-table-preferences:density:["fixture","keyboard-fixture"]';
    localStorage.setItem(key,JSON.stringify('compact'));
    window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify('compact'),storageArea:localStorage}));
  });
  await page.waitForFunction(()=>document.querySelector('.resource-table').style.getPropertyValue('--resource-table-row-height')==='38px');
});

test('density is isolated when the same resource table switches account or table',async t=>{
  const page=await fixture(t,'toolbar=1&scopes=1');
  const table=page.locator('.resource-table');
  const initial=await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height'));
  await page.getByText('紧凑',{exact:true}).click();
  for(const action of ['Other account','Other table']) {
    await page.getByRole('button',{name:action,exact:true}).click();
    assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),initial);
    await page.getByRole('button',{name:'Original scope',exact:true}).click();
    assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
  }
});

test('blocked persistence does not prevent density changes in the current session',async t=>{
  const page=await fixture(t,'toolbar=1');
  const table=page.locator('.resource-table');
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};});
  await page.getByText('紧凑',{exact:true}).click();
  assert.equal(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
  await page.getByText('标准',{exact:true}).click();
  assert.notEqual(await table.evaluate(element=>element.style.getPropertyValue('--resource-table-row-height')),'38px');
});

test('pointer column resize persists across reload, cleans up capture, and resets on double click',async t=>{
  const page=await fixture(t);
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  const bounds=await handle.boundingBox();
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+64,bounds.y+bounds.height/2,{steps:4});
  await page.mouse.up();
  assert.equal(await handle.getAttribute('aria-valuenow'),'304');
  assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('resource-table-is-resizing')),false);
  assert.deepEqual(await read(page,'changes'),[],'dragging must not sort the column');
  await page.reload();
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.locator('.resource-table').waitFor();
  assert.equal(await handle.getAttribute('aria-valuenow'),'304','a fresh mount must restore the saved column width');
  await handle.dblclick();
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  assert.deepEqual(await read(page,'changes'),[],'resetting must not sort the column');
});

test('column widths stay isolated across account and resource-table changes',async t=>{
  const page=await fixture(t,'scopes=1');
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  await handle.press('ArrowRight');
  assert.equal(await handle.getAttribute('aria-valuenow'),'256');
  await page.getByRole('button',{name:'Other account',exact:true}).click();
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  await handle.press('ArrowLeft');
  assert.equal(await handle.getAttribute('aria-valuenow'),'224');
  await page.getByRole('button',{name:'Original scope',exact:true}).click();
  assert.equal(await handle.getAttribute('aria-valuenow'),'256');
  await page.getByRole('button',{name:'Other table',exact:true}).click();
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  await page.getByRole('button',{name:'Other account',exact:true}).click();
  assert.equal(await handle.getAttribute('aria-valuenow'),'224');
  assert.deepEqual(await read(page,'changes'),[]);
});

test('blocked storage keeps pointer resizing usable and cleans up its interaction state',async t=>{
  const page=await fixture(t);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};});
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  const bounds=await handle.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+48,bounds.y+bounds.height/2,{steps:3});
  await page.mouse.up();
  assert.equal(await handle.getAttribute('aria-valuenow'),'288');
  assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('resource-table-is-resizing')),false);
  await handle.press('ArrowLeft');
  assert.equal(await handle.getAttribute('aria-valuenow'),'272');
  assert.deepEqual(await read(page,'changes'),[]);
});

test('canceling a column drag stops later pointer moves and leaves sorting usable',async t=>{
  const page=await fixture(t);
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  const bounds=await handle.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+32,bounds.y+bounds.height/2,{steps:3});
  assert.equal(await handle.getAttribute('aria-valuenow'),'272');
  await handle.dispatchEvent('pointercancel',{pointerId:1});
  await page.mouse.move(bounds.x+bounds.width/2+96,bounds.y+bounds.height/2,{steps:3});
  await page.mouse.up();
  assert.equal(await handle.getAttribute('aria-valuenow'),'272','canceled drag cannot keep resizing');
  assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('resource-table-is-resizing')),false);
  await page.locator('thead th').filter({hasText:'名称'}).first().press('Enter');
  assert.equal((await read(page,'changes')).at(-1).action,'sort');
});

test('scope changes during a column drag cannot resize the new account or revive the old drag',async t=>{
  const page=await fixture(t,'scopes=1');
  const handle=page.getByRole('separator',{name:'名称列宽',exact:true});
  const bounds=await handle.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+32,bounds.y+bounds.height/2,{steps:3});
  await page.getByRole('button',{name:'Other account',exact:true}).evaluate(button=>button.click());
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  await page.mouse.move(bounds.x+bounds.width/2+96,bounds.y+bounds.height/2,{steps:3});
  await page.mouse.up();
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');
  assert.equal(await page.locator('body').evaluate(element=>element.classList.contains('resource-table-is-resizing')),false);
  await page.getByRole('button',{name:'Original scope',exact:true}).click();
  assert.equal(await handle.getAttribute('aria-valuenow'),'272','only pre-switch moves belong to the original account');
  assert.deepEqual(await read(page,'changes'),[]);
});
