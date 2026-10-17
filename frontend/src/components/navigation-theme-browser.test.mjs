import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';

let bundlePromise;
after(() => stop());
function shellBundle() {
  return bundlePromise ??= build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {ThemeProvider} from './theme-context';
        import {PortalShell} from './shell-layout';
        import {ClusterWorkspaceShell} from './cluster-workspace-shell';
        import {ConsoleUtilitySidebar} from './console-utility-sidebar';
        import ApplicationsPage from '../app/applications/page';
        import {OpsFilterTriggerButton} from './ops/ops-button';
        import '../app/globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        const Shell=location.pathname.startsWith('/clusters/fixture-cluster/')?ClusterWorkspaceShell:PortalShell;
        createRoot(document.getElementById('root')).render(<ThemeProvider><QueryClientProvider client={client}><ConsoleUtilitySidebar><Shell>{location.pathname==='/applications'?<ApplicationsPage/>:<section aria-label="资源列表"><div className="resource-cluster-namespace-filters"><OpsFilterTriggerButton label="集群" icon={null} value="beidou-aliyun-ack-long-cluster-name" /></div>Fixture resources</section>}</Shell></ConsoleUtilitySidebar></QueryClientProvider></ThemeProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{name:'shell-external-boundaries',setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/auth-context|next\/(?:navigation|link|dynamic))$/},args=>({path:args.path,namespace:'shell-boundary'}));
      builder.onLoad({filter:/.*/,namespace:'shell-boundary'},args=>({contents:args.path==='next/navigation'
        ? 'const router={push(path){window.lastNavigation=path},replace(path){window.lastNavigation=path},refresh(){},prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);'
        : args.path==='next/link'
          ? 'import React from "react";export default function Link({href,prefetch,...props}){return React.createElement("a",{href,...props});}'
          : args.path==='next/dynamic'
            ? 'import React from "react";export default function dynamic(){return ({open,onOpenChange,onCollapseSidebar})=>open?React.createElement("div",{role:"dialog","aria-label":"AI 助手"},React.createElement("button",{onClick:()=>onOpenChange(false)},"收起面板"),React.createElement("button",{onClick:onCollapseSidebar},"收起工具栏")):null;}'
            : 'export const useAuth=()=>({role:localStorage.getItem("fixture-role")||"admin",username:"Theme Fixture",accessToken:"fixture-token",isInitializing:false,isAuthenticated:true,logout:async()=>{}});',loader:'js',resolveDir:new URL('.',import.meta.url).pathname}));
    }}],
    define:{'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"production"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/shell-theme-fixture.js',logLevel:'silent',
  });
}

async function fixture(t,scope='portal',viewport={width:1440,height:900},role='admin',collapsed='0',reducedMotion='no-preference') {
  const bundle=await shellBundle();
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  const page=await browser.newPage({viewport,reducedMotion});
  page.setDefaultTimeout(5000);
  const errors=[];
  const unexpected=[];
  t.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}finally{await browser.close();}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.hostname!=='shell-test.local'){unexpected.push(request.url());return route.abort();}
    if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>'});
    if(request.method()==='GET'&&url.pathname==='/api/capabilities')return route.fulfill({json:{data:[]}});
    if(request.method()==='GET'&&url.pathname==='/api/ai-assistant/access')return route.fulfill({json:{data:{allowed:false,fullAccess:false,scopes:[]}}});
    if(request.method()==='GET'&&url.pathname==='/api/system/update/status')return route.fulfill({json:{data:{updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'}}});
    if(request.method()==='GET'&&url.pathname==='/api/clusters/fixture-cluster')return route.fulfill({json:{data:{id:'fixture-cluster',name:'Theme Fixture Cluster',runtimeStatus:'running'}}});
    if(url.pathname==='/assistant-avatar.png')return readFile(new URL('../../public/assistant-avatar.png',import.meta.url)).then(body=>route.fulfill({contentType:'image/png',body}));
    unexpected.push(`${request.method()} ${url.pathname}`);return route.abort();
  });
  await page.addInitScript(({role,collapsed})=>{
    localStorage.setItem('fixture-role',role);
    localStorage.setItem('aiops_auth_access','fixture-token');
    localStorage.setItem('aiops_auth_user','Theme Fixture');
    localStorage.setItem('aiops_auth_role','admin');
    localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
    localStorage.setItem('access_token','fixture-token');
    localStorage.setItem('username','Theme Fixture');
    localStorage.setItem('role','admin');
    localStorage.setItem('expires_at','2030-01-01T00:00:00Z');
    localStorage.setItem('kubenova-theme-mode','dark');
    localStorage.setItem('kubenova.console.utility-sidebar.collapsed',collapsed);
  },{role,collapsed});
  const path=scope==='portal'?'/clusters':scope==='namespaces'?'/namespaces':scope==='applications'?'/applications':scope==='runtime'?'/clusters/fixture-cluster/terminal':'/clusters/fixture-cluster/workloads/pods';
  await page.goto(`http://shell-test.local${path}`);
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.locator('.console-utility-sidebar').waitFor({state:'attached'});
  await settle(page);
  return page;
}

async function settle(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
}

async function contrast(page,selector,pseudo=null) {
  return page.locator(selector).first().evaluate((element,pseudo)=>{
    const rgba=value=>value.match(/[\d.]+/g).map(Number);
    const mix=(front,back)=>{const alpha=front[3]??1;return front.slice(0,3).map((channel,index)=>channel*alpha+back[index]*(1-alpha));};
    const ancestors=[];
    for(let node=element;node;node=node.parentElement)ancestors.unshift(node);
    let background=[255,255,255];
    for(const node of ancestors)background=mix(rgba(getComputedStyle(node).backgroundColor),background);
    const foreground=mix(rgba(getComputedStyle(element,pseudo).color),background);
    const luminance=color=>color.map(channel=>channel/255).map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
    const a=luminance(foreground),b=luminance(background);
    return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),foreground,background};
  },pseudo);
}

async function assertReadable(page,selector,minimum=4.5,pseudo=null) {
  const colors=await contrast(page,selector,pseudo);
  assert.ok(colors.ratio>=minimum,`${selector}${pseudo??''}: contrast ${colors.ratio.toFixed(2)} < ${minimum}; ${JSON.stringify(colors)}`);
}

async function capture(page,name) {
  if(!process.env.NAVIGATION_THEME_QA_DIR)return;
  await mkdir(process.env.NAVIGATION_THEME_QA_DIR,{recursive:true});
  await page.screenshot({path:join(process.env.NAVIGATION_THEME_QA_DIR,`${name}.png`)});
}

test('mobile portal breadcrumb stays on one line inside the header',async t=>{
  const page=await fixture(t,'namespaces',{width:390,height:844});
  const bounds=await page.locator('.app-header .ant-breadcrumb').evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const header=element.closest('.app-header').getBoundingClientRect();
    return {height:rect.height,bottom:rect.bottom,headerBottom:header.bottom};
  });
  assert.ok(bounds.height<=28,`breadcrumb must stay single-line: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.bottom<=bounds.headerBottom,`breadcrumb must stay inside header: ${JSON.stringify(bounds)}`);
});

test('mobile scope value is a clipped single-line block inside its selector',async t=>{
  const page=await fixture(t,'namespaces',{width:390,height:844});
  const bounds=await page.locator('.resource-scope-filter-summary').evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const button=element.closest('button').getBoundingClientRect();
    return {display:getComputedStyle(element).display,height:rect.height,right:rect.right,buttonRight:button.right};
  });
  assert.equal(bounds.display,'block');
  assert.ok(bounds.height<=20&&bounds.right<=bounds.buttonRight,JSON.stringify(bounds));
});

test('selected portal navigation icon remains distinguishable on its dark selected surface',async t=>{
  // A primary-blue icon on the saturated selected-blue tile loses its visual outline.
  const page=await fixture(t);
  await assertReadable(page,'.app-sidebar-menu .ant-menu-item-selected .anticon',3);
  await assertReadable(page,'.app-sidebar-menu .ant-menu-item-selected .app-sidebar-menu__label');
});

test('portal search placeholder and typed text stay readable after dark/light theme switching',async t=>{
  const page=await fixture(t);
  for(const mode of ['dark','light','dark']) {
    if(await page.locator('html').getAttribute('data-theme')!==mode){
      await page.locator('.console-utility-sidebar').getByRole('button',{name:`切换到${mode==='dark'?'深色':'浅色'}主题`}).click();
      await settle(page);
    }
    await assertReadable(page,'#shell-global-search',4.5,'::placeholder');
    await page.locator('#shell-global-search').fill('deployment fixture');
    await assertReadable(page,'#shell-global-search');
    await page.locator('#shell-global-search').hover();
    await settle(page);
    const searchSurfaces=await page.locator('#shell-global-search').evaluate(input=>({input:getComputedStyle(input).backgroundColor,wrapper:getComputedStyle(input.parentElement).backgroundColor}));
    assert.ok(searchSurfaces.input==='rgba(0, 0, 0, 0)'||searchSurfaces.input===searchSurfaces.wrapper,`search input must not paint a different surface over the affix wrapper: ${JSON.stringify(searchSurfaces)}`);
    await assertReadable(page,'.app-sidebar-menu .ant-menu-item:not(.ant-menu-item-selected) .app-sidebar-menu__label');
    await capture(page,`portal-${mode}`);
  }
});

test('cluster dark navigation and utility toolbar share dark surfaces and remain readable',async t=>{
  const page=await fixture(t,'cluster');
  for(const selector of ['.cluster-workspace-shell__sidebar','.cluster-workspace-shell__header','.console-utility-sidebar']) {
    const rgb=await page.locator(selector).evaluate(element=>getComputedStyle(element).backgroundColor.match(/[\d.]+/g).slice(0,3).map(Number));
    assert.ok(Math.max(...rgb)<100,`${selector} must not retain a light-theme surface`);
  }
  await assertReadable(page,'.cluster-workspace-menu .ant-menu-item-selected .app-sidebar-menu__link');
  await assertReadable(page,'.cluster-workspace-menu .ant-menu-submenu-title');
  await assertReadable(page,'.console-utility-sidebar__button',3);
  await capture(page,'cluster-dark');
});

test('portal and cluster navigation fit 390px after opening the right toolbar and switching both themes',async t=>{
  for(const scope of ['portal','cluster']) {
    const page=await fixture(t,scope,{width:390,height:844},'admin','1');
    const restore=page.getByRole('button',{name:'显示侧边栏',exact:true});
    await restore.click();
    await settle(page);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'收起侧边栏');
    for(const mode of ['dark','light']) {
      if(await page.locator('html').getAttribute('data-theme')!==mode){await page.locator('.console-utility-sidebar').getByRole('button',{name:'切换到浅色主题'}).click();await settle(page);}
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'shell must not overflow mobile viewport');
      const bounds=await page.locator('.console-utility-sidebar').boundingBox();
      assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
      await assertReadable(page,'.console-utility-sidebar__button',3);
      await capture(page,`${scope}-${mode}-mobile`);
      await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
      await settle(page);
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'显示侧边栏');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await restore.click();
      await settle(page);
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'收起侧边栏');
    }
  }
});

test('390px utility toolbar Escape and backdrop close restore focus to the visible opener',async t=>{
  for(const scope of ['portal','cluster']) {
    const page=await fixture(t,scope,{width:390,height:844},'admin','1');
    const restore=page.getByRole('button',{name:'显示侧边栏',exact:true});
    const rail=page.locator('.console-utility-sidebar');
    await restore.click();
    await settle(page);
    const theme=rail.getByRole('button',{name:'切换到浅色主题',exact:true});
    await theme.click();
    await settle(page);
    await rail.getByRole('button',{name:'切换到深色主题',exact:true}).press('Escape');
    await settle(page);
    assert.equal(await rail.isVisible(),false,'Escape from a toolbar control must dismiss the mobile rail');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'显示侧边栏');
    assert.equal(await page.evaluate(()=>localStorage.getItem('kubenova.console.utility-sidebar.collapsed')),'1');
    await restore.click();
    await settle(page);
    await page.getByRole('button',{name:'关闭工具栏遮罩',exact:true}).click({position:{x:20,y:100}});
    await settle(page);
    assert.equal(await rail.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'显示侧边栏');
    assert.equal(await page.locator('.console-utility-backdrop').count(),0);
    assert.equal(await rail.getByRole('button',{name:/切换到[深浅]色主题/}).count(),0,'collapsed rail controls must not stay keyboard accessible');
  }
});

test('reduced-motion portal and cluster navigation remain operable without sidebar transitions',async t=>{
  // Removing the reduced-motion rules must expose sliding durations, not hide usable navigation.
  for(const scope of ['portal','cluster']) {
    const page=await fixture(t,scope,{width:1440,height:900},'admin','0','reduce');
    const left=page.locator('.app-sidebar.ant-layout-sider');
    for(const selector of ['.app-sidebar.ant-layout-sider','.console-utility-sidebar']) {
      const durations=await page.locator(selector).evaluate(element=>getComputedStyle(element).transitionDuration.split(',').map(value=>parseFloat(value)*(value.trim().endsWith('ms')?1:1000)));
      assert.ok(durations.every(value=>value<=1),`${scope} ${selector} still transitions: ${durations}`);
    }
    const before=await left.boundingBox();
    await page.getByRole('button',{name:'收起侧边导航',exact:true}).click();
    await page.getByRole('button',{name:'展开侧边导航',exact:true}).waitFor();
    assert.ok((await left.boundingBox()).width<before.width,'left navigation must actually collapse');
    await page.getByRole('button',{name:'展开侧边导航',exact:true}).click();
    await page.getByRole('button',{name:'收起侧边导航',exact:true}).waitFor();
    assert.equal(Math.round((await left.boundingBox()).width),Math.round(before.width));
    await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
    await settle(page);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'显示侧边栏');
    await page.getByRole('button',{name:'显示侧边栏',exact:true}).press('Enter');
    await settle(page);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'收起侧边栏');
    assert.ok(await page.locator('.console-utility-sidebar').isVisible());
  }
});

test('mobile portal retains an operable refresh control without overflowing the header',async t=>{
  for(const scope of ['portal','cluster']) {
    const page=await fixture(t,scope,{width:390,height:844},'admin','1');
    const refresh=page.getByRole('button',{name:'刷新页面',exact:true});
    assert.ok(await refresh.isVisible(),`refresh cannot disappear from ${scope}`);
    await refresh.click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
});

test('AI avatar opens in place and rail collapse restores keyboard focus and saves its preference',async t=>{
  const page=await fixture(t);
  const initialUrl=page.url();
  await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();
  await page.getByRole('dialog',{name:'AI 助手',exact:true}).waitFor();
  assert.equal(page.url(),initialUrl);
  assert.equal(await page.evaluate(()=>window.lastNavigation),undefined);
  await page.getByRole('button',{name:'收起面板',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'AI 助手',exact:true}).count(),0);
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
  await settle(page);
  assert.equal(await page.locator('.console-utility-sidebar').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'显示侧边栏');
  assert.equal(await page.evaluate(()=>localStorage.getItem('kubenova.console.utility-sidebar.collapsed')),'1');
  await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();
  await settle(page);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'收起侧边栏');
  assert.equal(await page.evaluate(()=>localStorage.getItem('kubenova.console.utility-sidebar.collapsed')),'0');
  const bounds=await page.locator('#kubenova-main-content').boundingBox();
  const rail=await page.locator('.console-utility-sidebar').boundingBox();
  if(bounds)assert.ok(bounds.x+bounds.width<=rail.x+1,'content must not be covered by the utility rail');
});

test('application center menu and direct route are limited to platform administrators',async t=>{
  for(const role of ['admin','platform-admin','operator','viewer','cluster-admin']) {
    const page=await fixture(t,'applications',{width:1440,height:900},role);
    const privileged=['admin','platform-admin'].includes(role);
    assert.equal(await page.locator('.app-sidebar-menu a[href="/applications"]').count(),privileged?1:0);
    assert.equal(await page.getByRole('button',{name:'打开 AI 助手',exact:true}).count(),privileged?1:0);
    assert.equal(await page.getByText('仅超级管理员可访问',{exact:true}).count(),privileged?0:1);
    assert.equal(await page.getByText('暂无平台级应用',{exact:true}).count(),privileged?1:0);
  }
});

test('fullscreen runtime routes also expose the shared utility rail',async t=>{
  const page=await fixture(t,'runtime');
  assert.equal(await page.getByRole('button',{name:'打开 AI 助手',exact:true}).count(),1);
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
  await settle(page);
  assert.equal(await page.getByRole('button',{name:'显示侧边栏',exact:true}).count(),1);
});

test('built localhost shell opens the real AI panel in place and protects the application route', {skip:!process.env.LOCAL_SHELL_URL}, async t=>{
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  t.after(()=>browser.close());
  for(const role of ['admin','viewer']) {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{
      const url=new URL(route.request().url());
      let data={items:[],total:0};
      if(url.pathname.endsWith('/auth/me'))data={user:{username:'UI fixture',role},expiresAt:'2030-01-01T00:00:00Z'};
      else if(url.pathname==='/api/capabilities'||url.pathname.includes('/sessions'))data=[];
      else if(url.pathname==='/api/system/update/status')data={updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'};
      return route.fulfill({json:{data}});
    });
    await page.routeWebSocket('**/*',socket=>socket.close());
    await page.addInitScript(role=>{
      localStorage.setItem('aiops_auth_access','ui-fixture-token');
      localStorage.setItem('aiops_auth_user','UI fixture');
      localStorage.setItem('aiops_auth_role',role);
      localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
      if(localStorage.getItem('kubenova.console.utility-sidebar.collapsed')===null)localStorage.setItem('kubenova.console.utility-sidebar.collapsed','0');
      localStorage.setItem('kubenova-theme-mode','light');
    },role);
    await page.goto(`${process.env.LOCAL_SHELL_URL}/applications`);
    await page.locator('.console-utility-sidebar').waitFor();
    if(role==='admin') {
      await page.getByText('暂无平台级应用',{exact:true}).waitFor();
      await page.locator('.app-sidebar-menu a[href="/applications"]').waitFor();
      await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();
      await page.getByRole('dialog',{name:'AI 助手',exact:true}).waitFor();
      assert.ok(page.url().endsWith('/applications'));
      const panel=page.getByRole('dialog',{name:'AI 助手',exact:true});
      let bounds=await panel.boundingBox();
      assert.equal(bounds.width,620);
      assert.equal(bounds.height,860);
      assert.equal(await page.locator('.kn-ai-float__input').evaluate(el=>getComputedStyle(el).fontSize),'15px');
      await capture(page,'localhost-ai-panel-light');
      await page.getByRole('complementary',{name:'控制台工具栏'}).getByRole('button',{name:'切换到深色主题',exact:true}).click();
      await settle(page);
      await capture(page,'localhost-ai-panel-dark');
      await page.getByRole('complementary',{name:'控制台工具栏'}).getByRole('button',{name:'切换到浅色主题',exact:true}).click();
      for(const corner of ['nw','ne','sw','se']) {
        const before=await panel.boundingBox();
        const handle=await page.locator(`.kn-ai-float__resize--${corner}`).boundingBox();
        await page.mouse.move(handle.x+8,handle.y+8);
        await page.mouse.down();
        await page.mouse.move(handle.x+8+(corner.endsWith('w')?20:-20),handle.y+8+(corner.startsWith('n')?20:-20),{steps:5});
        await page.mouse.up();
        const after=await panel.boundingBox();
        assert.ok(Math.abs(after.width-(before.width-20))<2,`${corner} must resize width`);
        assert.ok(Math.abs(after.height-(before.height-20))<2,`${corner} must resize height`);
        const fixedX=corner.endsWith('w')?'right':'left';
        const fixedY=corner.startsWith('n')?'bottom':'top';
        const edge=(rect,axis)=>axis==='right'?rect.x+rect.width:axis==='bottom'?rect.y+rect.height:axis==='left'?rect.x:rect.y;
        assert.ok(Math.abs(edge(after,fixedX)-edge(before,fixedX))<2,`${corner} must keep its opposite horizontal edge anchored`);
        assert.ok(Math.abs(edge(after,fixedY)-edge(before,fixedY))<2,`${corner} must keep its opposite vertical edge anchored`);
      }
      const beforeKeyboard=await panel.boundingBox();
      await page.locator('.kn-ai-float__resize--se').press('ArrowRight');
      const afterKeyboard=await panel.boundingBox();
      assert.equal(afterKeyboard.width,beforeKeyboard.width+20,'keyboard resizing must change width');
      assert.equal(afterKeyboard.x,beforeKeyboard.x,'keyboard resizing must anchor the opposite edge');
      const header=await page.locator('.kn-ai-float__header').boundingBox();
      await page.mouse.move(header.x+header.width/2,header.y+header.height/2);
      await page.mouse.down();
      await page.mouse.move(header.x+header.width/2-30,header.y+header.height/2+30,{steps:5});
      const duringDrag=await panel.boundingBox();
      assert.ok(Math.abs(duringDrag.x-(afterKeyboard.x-30))<2,'panel must follow the horizontal pointer direction');
      await page.mouse.up();
      for(const viewport of [{width:1024,height:620},{width:390,height:844},{width:1440,height:900}]) {
        await page.setViewportSize(viewport);
        await settle(page);
        bounds=await panel.boundingBox();
        assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,'AI panel must remain fully inside the resized viewport');
      }
      assert.equal(await page.locator('.console-utility-sidebar__avatar img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
      await page.locator('.kn-ai-float__input').fill('保留尚未发送的输入');
      const resizedBounds=await panel.boundingBox();
      await page.getByRole('button',{name:'收起面板',exact:true}).click();
      assert.equal(await page.getByRole('dialog',{name:'AI 助手',exact:true}).count(),0);
      await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();
      assert.equal(await page.locator('.kn-ai-float__input').inputValue(),'保留尚未发送的输入');
      assert.deepEqual(await panel.boundingBox(),resizedBounds);
      assert.ok(page.url().endsWith('/applications'));
      await page.getByRole('button',{name:'收起面板',exact:true}).click();
      await capture(page,'localhost-sidebar-light');
    } else {
      await page.getByText('仅超级管理员可访问',{exact:true}).waitFor();
      assert.equal(await page.locator('.app-sidebar-menu a[href="/applications"]').count(),0);
      assert.equal(await page.getByRole('button',{name:'打开 AI 助手',exact:true}).count(),0);
    }
    await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
    await page.getByRole('button',{name:'显示侧边栏',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('button',{name:'显示侧边栏',exact:true}).waitFor();
    assert.equal(await page.locator('.console-utility-sidebar').isVisible(),false);
    assert.deepEqual(errors,[]);
    await page.close();
  }
});
