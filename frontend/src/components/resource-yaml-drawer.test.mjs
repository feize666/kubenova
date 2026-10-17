import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

function drawerBundle() {
  return build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {ResourceYamlDrawer} from './resource-yaml-drawer';
        import '../app/globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        window.readStatus=()=>client.getQueryCache().getAll().find(query=>query.queryKey[0]==='resource-yaml-preview')?.state.error?.status;
        function Fixture(){const standalone=location.search.includes('standalone');const [open,setOpen]=React.useState(!standalone);return <><button onClick={()=>setOpen(true)}>Open YAML</button><ResourceYamlDrawer open={open} embedded={!standalone} token="test-token" identity={{clusterId:'cluster-a',kind:'ConfigMap',namespace:'prod',name:'web'}} onClose={()=>setOpen(false)}/></>;}
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{ name: 'external-contexts', setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/auth-context|next\/navigation)$/}, args=>({path:args.path,namespace:'test-context'}));
      builder.onLoad({filter:/.*/,namespace:'test-context'}, args=>({contents:args.path==='next/navigation'
        ? 'export const useRouter=()=>({push(){throw new Error("unexpected navigation")}});export const useSearchParams=()=>new URLSearchParams();'
        : 'export const useAuth=()=>({role:"admin",accessToken:"test-token",username:"test",isInitializing:false});',loader:'js'}));
    }}],
    define: {'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"production"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/yaml-drawer-test.js',
  });
}

test('YAML preview keeps cached content inaccessible after denied reads until a successful read', async () => {
  const bundle = await drawerBundle();
  const browser=await chromium.launch({headless:true,channel:process.env.YAML_EDITOR_BROWSER_CHANNEL||'chrome'});
  try {
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    let status=200;
    let writes=0;
    const yaml='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web\n  namespace: prod\ndata:\n  note: cached-content\n';
    await page.route('http://yaml-test.local/**',async route=>{
      if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      if(route.request().method()!=='GET') {writes++;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'writes forbidden in test'})});}
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{yaml}:{message:status===403?'Forbidden':'Unavailable'})});
    });
    await page.goto('http://yaml-test.local/');
    const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text;
    if(css)await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const preview=page.getByRole('textbox',{name:'YAML 只读预览'});
    await preview.waitFor();
    await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('cached-content'));
    const refresh=page.getByRole('button',{name:'刷新 YAML',exact:true});
    const actions=[page.getByRole('button',{name:/编辑 YAML/}),page.getByRole('button',{name:/复制/}),page.getByRole('button',{name:/下载 YAML/})];
    status=403;
    await refresh.click();
    await page.getByText('无权读取 YAML',{exact:true}).waitFor();
    assert.equal(await page.locator('.cm-content').textContent(),'');
    for(const action of actions)assert.equal(await action.isDisabled(),true);
    status=503;
    await refresh.click();
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await page.locator('.cm-content').textContent(),'','503 following 403 must not expose previously authorized cached YAML');
    for(const action of actions)assert.equal(await action.isDisabled(),true);
    status=200;
    await refresh.click();
    await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('cached-content'));
    for(const action of actions)assert.equal(await action.isDisabled(),false);

    await actions[0].click();
    const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});
    await editor.waitFor();
    assert.equal(await refresh.count(),1,'embedded editing needs a read refresh entry without leaving or discarding the draft');
    const draft=yaml.replace('cached-content','unsaved-draft');
    await editor.fill(draft);
    status=503;
    await refresh.click();
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.match(await editor.textContent(),/unsaved-draft/,'transient read failure must preserve the unsaved editor draft');
    status=403;
    await refresh.click();
    await page.getByText('当前资源读取权限已失效',{exact:true}).waitFor();
    assert.equal(await editor.count(),0,'denied reads must hide the editor content');
    assert.equal(await page.getByRole('button',{name:/校验并预览/}).count(),0);
    const retry=page.getByRole('button',{name:/重新读取/});
    status=503;
    await retry.click();
    await page.waitForFunction(()=>window.readStatus()===503);
    assert.equal(await editor.count(),0,'503 after denied read must not restore the editing draft');
    status=200;
    await retry.click();
    await editor.waitFor();
    assert.match(await editor.textContent(),/unsaved-draft/,'successful reread must retain the same EditorDocument draft');
    assert.equal(writes,0);
    assert.equal(page.url(),'http://yaml-test.local/');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('standalone YAML Escape protects the draft and returns focus after confirmed close', async () => {
  const bundle=await drawerBundle();
  const browser=await chromium.launch({headless:true,channel:process.env.YAML_EDITOR_BROWSER_CHANNEL||'chrome'});
  try {
    const page=await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    const yaml='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web\n  namespace: prod\ndata:\n  note: initial\n';
    await page.route('**/*',route=>{
      if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
      if(route.request().method()!=='GET'){writes.push(route.request().url());return route.abort();}
      return route.fulfill({json:{yaml}});
    });
    await page.goto('http://yaml-test.local/?standalone');
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const opener=page.getByRole('button',{name:'Open YAML',exact:true});
    await opener.click();
    await page.getByRole('button',{name:/编辑 YAML/}).click();
    const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});
    await editor.fill(yaml.replace('initial','draft-kept'));
    await editor.press('Escape');
    const confirm=page.locator('.ant-modal-confirm').filter({hasText:'离开资源编辑器？'});
    await confirm.waitFor();
    await confirm.getByRole('button',{name:'继续编辑',exact:true}).click();
    assert.match(await editor.textContent(),/draft-kept/);
    assert.equal(page.url(),'http://yaml-test.local/?standalone');
    await editor.press('Escape');
    await confirm.waitFor();
    await page.keyboard.press('Escape');
    await confirm.waitFor({state:'hidden'});
    assert.match(await editor.textContent(),/draft-kept/,'Escape dismisses only the top confirmation, not the edited drawer');
    await page.locator('.ops-drawer-shell__header .ant-drawer-close').click();
    await confirm.waitFor();
    await confirm.getByRole('button',{name:'离开编辑器',exact:true}).click();
    await page.locator('.ops-drawer-shell').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.textContent==='Open YAML');
    assert.deepEqual(writes,[]);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
