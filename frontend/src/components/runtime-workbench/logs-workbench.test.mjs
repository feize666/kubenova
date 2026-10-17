import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
let bundlePromise;

function durationMs(value) {
  return value.split(',').map(part=>{
    const duration=part.trim();
    return Number.parseFloat(duration)*(duration.endsWith('ms')?1:1000);
  });
}

function componentBundle() {
  return bundlePromise ??= build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {ThemeProvider,useThemeMode} from '../theme-context';
        import LogsWorkbench from './logs-workbench';
        import '../../app/globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        window.refreshClusterNames=()=>client.refetchQueries({queryKey:['clusters','list']});
        window.unmountLogs=()=>root.unmount();
        function ThemeControl(){const {toggleTheme}=useThemeMode();React.useEffect(()=>{window.toggleLogsTheme=toggleTheme;},[toggleTheme]);return null;}
        const root=createRoot(document.getElementById('root'));
        function Fixture(){
          const [closed,setClosed]=React.useState(false);
          const [filter,setFilter]=React.useState('');
          return closed?<><h2>Original Pod detail</h2><input aria-label="Resource filter" value={filter} onChange={event=>setFilter(event.target.value)}/><output>{filter}</output></>:<LogsWorkbench query={new URLSearchParams('clusterId=fixture-cluster&namespace=fixture-ns&pod=fixture-pod&container=main')} onClose={()=>setClosed(true)}/>;
        }
        root.render(<ThemeProvider><ThemeControl/><QueryClientProvider client={client}><Fixture/></QueryClientProvider></ThemeProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{name:'logs-component-fixture',setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/(?:auth-context|cluster-workspace-context)|next\/navigation)$/},args=>({path:args.path,namespace:'fixture-context'}));
      builder.onLoad({filter:/.*/,namespace:'fixture-context'},args=>({contents:args.path==='next/navigation'
        ? 'const router={replace(){throw new Error("unexpected navigation")}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/logs";'
        : args.path.endsWith('auth-context')
          ? 'export const useAuth=()=>({role:"admin",accessToken:"fixture-token",isInitializing:false});'
          : 'export const useOptionalClusterWorkspace=()=>null;',loader:'js'}));
      builder.onResolve({filter:/^@xterm\/xterm$/},args=>args.namespace==='real-terminal' ? undefined : ({path:args.path,namespace:'real-terminal'}));
      builder.onResolve({filter:/xterm\.js$/,namespace:'real-terminal'},args=>({path:args.path,namespace:'file'}));
      builder.onLoad({filter:/.*/,namespace:'real-terminal'},()=>({contents:`import {Terminal as ActualTerminal} from '${require.resolve('@xterm/xterm')}';
        export class Terminal extends ActualTerminal {constructor(options){super(options);window.logsTerminal=this;}}`,loader:'js'}));
      builder.onLoad({filter:/\.tsx$/},async args=>{
        const source=await readFile(args.path,'utf8');
        if(!source.includes('<style jsx'))return;
        const result=transformSync(source,{filename:args.path,configFile:false,babelrc:false,parserOpts:{plugins:['jsx','typescript']},plugins:[require.resolve('styled-jsx/babel')]});
        return {contents:result.code,loader:'tsx'};
      });
    }}],
    define:{'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"test"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/logs-component-fixture.js',
    logLevel:'silent',
  });
}

async function fixture(t,viewport={width:1440,height:900},{reducedMotion='no-preference',availableContainers=['main']}={}) {
  const bundle=await componentBundle();
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport,reducedMotion});
  page.setDefaultTimeout(5000);
  const errors=[];
  const sessions=[];
  const unexpected=[];
  const sockets=[];
  const browserSockets=[];
  let historyReads=0;
  let clusterStatus=200;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('websocket',socket=>{
    const tracked={url:socket.url(),closed:false};
    socket.on('close',()=>{tracked.closed=true;});
    browserSockets.push(tracked);
  });
  const items=Array.from({length:200},(_,index)=>({id:`history-${index}`,clusterId:'fixture-cluster',namespace:'fixture-ns',pod:'fixture-pod',level:'INFO',message:`history-${String(index).padStart(3,'0')} ${index===10||index===70?'MATCH':''}`,timestamp:'2026-10-10T08:00:00.000Z'}));
  await page.route('**/*',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.hostname!=='logs-test.local'){unexpected.push(request.url());return route.abort();}
    if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>'});
    if(request.method()==='GET'&&url.pathname==='/api/clusters')return route.fulfill({status:clusterStatus,json:clusterStatus===200?{data:{items:[{id:'fixture-cluster',name:'Fixture Cluster',state:'active',hasKubeconfig:true}],total:1,page:1,pageSize:200}}:{message:'Cluster name unavailable'}});
    if(request.method()==='GET'&&url.pathname==='/api/cluster-health')return route.fulfill({json:{data:{items:[{clusterId:'fixture-cluster',runtimeStatus:'running',lifecycleState:'active'}]}}});
    if(request.method()==='GET'&&url.pathname==='/api/logs'){historyReads++;return route.fulfill({json:{data:{items,total:200,page:1,pageSize:200,timestamp:'2026-10-10T08:00:00.000Z'}}});}
    if(request.method()==='POST'&&url.pathname==='/api/logs/stream'){
      sessions.push(request.postDataJSON());
      return route.fulfill({json:{data:{sessionId:`fixture-session-${sessions.length}`,gatewayWsUrl:'ws://logs-test.local/ws/logs',sessionState:'ready',reconnectable:true,target:{clusterId:'fixture-cluster',namespace:'fixture-ns',pod:'fixture-pod',container:sessions.at(-1)?.container||'main',availableContainers}}}});
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.routeWebSocket('**/*',socket=>{
    if(socket.url()!=='ws://logs-test.local/ws/logs'){unexpected.push(socket.url());return socket.close();}
    sockets.push(socket);
  });
  await page.goto('http://logs-test.local/');
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  try {
    await page.waitForFunction(()=>document.querySelector('.logs-workbench-shell')?.classList.contains('ops-frame-shell--streaming'),null,{timeout:5000});
  } catch(error) {
    console.error({errors,unexpected,sessions,historyReads,body:await page.locator('body').innerText()});
    throw error;
  }
  await flush(page);
  assert.equal(await page.evaluate(()=>window.logsTerminal.buffer.active.baseY>100),true,'real Xterm must contain scrollback');
  t.after(()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);});
  return {page,sessions,sockets,browserSockets,historyReads:()=>historyReads,setClusterStatus(value){clusterStatus=value;},send(lines){sockets.at(-1).send(Array.isArray(lines)?lines.join('\n'):lines);}};
}

for(const reducedMotion of ['reduce','no-preference'])test(`logs ${reducedMotion} respects motion preference while output and return remain usable`,async t=>{
  // A missing override must not reintroduce decorative motion or keep controls transitioning in reduced mode.
  const {page,send,sessions}=await fixture(t,undefined,{reducedMotion});
  const motion=await page.evaluate(()=>({
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    animations:['.logs-terminal-frame','.logs-terminal-host'].flatMap(selector=>['::before','::after'].map(pseudo=>getComputedStyle(document.querySelector(selector),pseudo).animationName)),
    transition:getComputedStyle(document.querySelector('.logs-workbench-shell .ops-control-trigger')).transitionDuration,
  }));
  assert.equal(motion.reduced,reducedMotion==='reduce');
  assert.deepEqual(motion.animations,['none','none','none','none'],'the live log frame has no decorative sweep in either preference');
  if(reducedMotion==='reduce'){
    assert.ok(durationMs(motion.transition).every(value=>value<=1),JSON.stringify(motion));
  }else{
    assert.ok(durationMs(motion.transition).some(value=>value>1),JSON.stringify(motion));
  }
  send('motion-preference-log-output');
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('201/201'));
  await flush(page);
  assert.match((await terminalState(page)).text,/motion-preference-log-output/);
  await page.getByRole('button',{name:/返回资源/}).click();
  await page.getByRole('heading',{name:'Original Pod detail'}).waitFor();
  assert.equal(await page.locator('.logs-workbench-shell').count(),0);
  await page.getByRole('textbox',{name:'Resource filter'}).fill('fixture-pod');
  assert.equal(await page.locator('output').innerText(),'fixture-pod','the restored detail still responds to interaction');
  assert.equal(sessions.length,1);
});

test('switching log containers requests a fresh stream for the selected container without leaving the workbench',async t=>{
  const {page,sessions,sockets}=await fixture(t,undefined,{availableContainers:['main','sidecar']});
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].container,'main');
  await page.getByRole('combobox',{name:'容器'}).click();
  await page.getByText('sidecar',{exact:true}).last().click();
  const deadline=Date.now()+5000;
  while((sessions.length<2||sockets.length<2)&&Date.now()<deadline)await page.waitForTimeout(25);
  assert.equal(sessions.length,2,'container selection starts a new API session');
  assert.equal(sessions[1].container,'sidecar');
  assert.equal(sockets.length,2,'container selection establishes a new WebSocket');
  assert.match(await page.locator('.headlamp-log-control').first().innerText(),/sidecar/);
  assert.equal(new URL(page.url()).pathname,'/');
});

test('revoked cluster names stay hidden after transient failures without reconnecting the log stream',async t=>{
  const {page,sessions,setClusterStatus,send}=await fixture(t);
  assert.ok((await page.locator('body').innerText()).includes('Fixture Cluster'));
  setClusterStatus(403);
  await page.evaluate(()=>window.refreshClusterNames());
  await page.waitForFunction(()=>!document.body.innerText.includes('Fixture Cluster'));
  setClusterStatus(503);
  await page.evaluate(()=>window.refreshClusterNames());
  assert.ok(!(await page.locator('body').innerText()).includes('Fixture Cluster'));
  send('independent-session-output');
  await flush(page);
  assert.match((await terminalState(page)).text,/independent-session-output/);
  assert.equal(sessions.length,1,'name lookup cannot restart the independently authorized stream');
  setClusterStatus(200);
  await page.evaluate(()=>window.refreshClusterNames());
  await page.waitForFunction(()=>document.body.innerText.includes('Fixture Cluster'));
});

async function flush(page) {
  await page.evaluate(()=>new Promise(resolve=>window.logsTerminal.write('\x1b[0m',()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
}

async function terminalState(page) {
  return page.evaluate(()=>{
    const terminal=window.logsTerminal;
    const buffer=terminal.buffer.active;
    return {viewportY:buffer.viewportY,baseY:buffer.baseY,selection:terminal.getSelectionPosition(),text:Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)).join('\n')};
  });
}

async function visibleLogText(page) {
  return page.evaluate(()=>{
    const terminal=window.logsTerminal;
    const buffer=terminal.buffer.active;
    return Array.from({length:terminal.rows},(_,index)=>buffer.getLine(buffer.viewportY+index)?.translateToString(true)).join('\n');
  });
}

test('bounded live history retains the same visible text across eviction and formatting',async t=>{
  // Restoring an unchanged viewport index after Xterm evicts lines changes what the reader sees.
  const {page,send,sessions}=await fixture(t);
  send(Array.from({length:6200},(_,index)=>`bounded-${String(index).padStart(5,'0')}`));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('6000/6000'));
  await flush(page);
  await page.locator('.xterm').hover();
  await page.mouse.wheel(0,-480);
  await page.waitForFunction(()=>window.logsTerminal.buffer.active.viewportY<window.logsTerminal.buffer.active.baseY);
  const before=await visibleLogText(page);
  assert.match(before,/bounded-/);
  send(Array.from({length:80},(_,index)=>`incoming-${index}`));
  await page.getByRole('button',{name:'查看 80 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  assert.equal(await visibleLogText(page),before,'buffer eviction must preserve the visible history, not its old index');
  await page.getByRole('switch',{name:'启用日志美化'}).click();
  await flush(page);
  assert.deepEqual((await visibleLogText(page)).match(/bounded-\d+/g),before.match(/bounded-\d+/g),'format replay must preserve the same log messages');
  assert.equal(sessions.length,1);
  await page.getByRole('button',{name:'查看 80 条新日志并恢复滚动跟随'}).click();
  await flush(page);
  assert.match(await visibleLogText(page),/incoming-79/);
});

test('retained downloadable history is also available to Xterm history reading and search',async t=>{
  // A smaller terminal scrollback silently discards logs still retained by the workbench download.
  const {page,send}=await fixture(t);
  send(Array.from({length:6200},(_,index)=>`retained-${String(index).padStart(5,'0')}`));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('6000/6000'));
  await flush(page);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载日志'}).click()]);
  const stream=await download.createReadStream();
  const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const text=Buffer.concat(chunks).toString();
  assert.match(text,/retained-00200/);
  assert.doesNotMatch(text,/retained-00199/);
  assert.match((await terminalState(page)).text,/retained-00200/,'history kept for download must remain readable in the terminal');
  await page.getByRole('button',{name:'查找日志'}).click();
  await page.getByPlaceholder('查找',{exact:true}).fill('retained-00200');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/retained-00200/);
});

test('wrapped and formatted retained records stay searchable after narrowing and eviction',async t=>{
  const {page,send,sessions}=await fixture(t);
  send(Array.from({length:6100},(_,index)=>JSON.stringify({record:`capacity-${String(index).padStart(5,'0')}`,message:'x'.repeat(180)})));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('6000/6000'));
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await flush(page);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载日志'}).click()]);
  const chunks=[];
  for await(const chunk of await download.createReadStream())chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString(),/capacity-00100/);
  await page.getByRole('button',{name:'查找日志'}).click();
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00100');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00100/,'downloadable oldest record must remain readable');
  await page.setViewportSize({width:390,height:844});
  await flush(page);
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00101');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00101/,'narrow-screen reflow must not discard retained records');
  send(Array.from({length:120},(_,index)=>JSON.stringify({record:`new-capacity-${index}`,message:'x'.repeat(180)})));
  await page.getByRole('button',{name:'查看 120 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00100');
  await page.getByText('暂无结果',{exact:true}).waitFor();
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00220');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00220/);
  await page.setViewportSize({width:1440,height:900});
  await flush(page);
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00221');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00221/);
  send(Array.from({length:100},(_,index)=>`short-capacity-${index}`));
  await page.getByRole('button',{name:'查看 220 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00220');
  await page.getByText('暂无结果',{exact:true}).waitFor();
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00320');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00320/);
  for(let batch=0;batch<5;batch++)send(Array.from({length:25},(_,index)=>`rapid-capacity-${batch*25+index}`));
  await page.getByRole('button',{name:'查看 345 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  await page.waitForFunction(()=>{
    const buffer=window.logsTerminal.buffer.active;
    return Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)).some(line=>line?.includes('rapid-capacity-124'));
  });
  assert.doesNotMatch((await terminalState(page)).text,/capacity-00320/,'completed latest replay must discard old physical output');
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00320');
  await page.getByRole('button',{name:'下一个匹配',exact:true}).click();
  await page.getByText('暂无结果',{exact:true}).waitFor();
  await page.getByPlaceholder('查找',{exact:true}).fill('capacity-00445');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  assert.match(await visibleLogText(page),/capacity-00445/,'rapid frames must share the same retained record boundary');
  assert.equal(sessions.length,1);
});

test('format replay keeps a wrapped historical log in view',async t=>{
  const {page,send}=await fixture(t,{width:1000,height:800});
  const columns=await page.evaluate(()=>window.logsTerminal.cols);
  send(Array.from({length:120},(_,index)=>`wrapped-${String(index).padStart(3,'0')} ${'x'.repeat(columns-24)}`));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('320/320'));
  await flush(page);
  await page.locator('.xterm').hover();
  await page.mouse.wheel(0,-1600);
  await page.waitForFunction(()=>window.logsTerminal.buffer.active.viewportY<window.logsTerminal.buffer.active.baseY);
  await page.evaluate(()=>window.logsTerminal.scrollLines(-80));
  const before=(await visibleLogText(page)).match(/wrapped-\d+/)?.[0];
  assert.ok(before);
  await page.getByRole('switch',{name:'启用日志美化'}).click();
  await flush(page);
  assert.equal((await visibleLogText(page)).match(/wrapped-\d+/)?.[0],before,'wrapped output must retain the same first historical message after formatting');
});

test('clearing while bounded replay is queued cannot resurrect old records',async t=>{
  const {page,send,sessions}=await fixture(t);
  send(Array.from({length:6200},(_,index)=>`queued-old-${index} ${'x'.repeat(500)}`));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('6000/6000'));
  send(Array.from({length:20},(_,index)=>`queued-extra-${index}`));
  await page.getByRole('button',{name:'清除日志'}).click();
  send('after-queued-clear');
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('1/1'));
  await page.waitForFunction(()=>{
    const buffer=window.logsTerminal.buffer.active;
    const text=Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)).join('\n');
    return text.includes('after-queued-clear')&&!text.includes('queued-old-')&&!text.includes('queued-extra-');
  });
  assert.equal(sessions.length,1);
});

test('format replay preserves the occurrence of repeated log messages',async t=>{
  const {page,send}=await fixture(t);
  send(Array.from({length:300},(_,index)=>index%10===9?`sentinel-${index}`:'repeated-message'));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('500/500'));
  await flush(page);
  await page.evaluate(()=>window.logsTerminal.scrollLines(-93));
  const before=(await visibleLogText(page)).match(/sentinel-\d+/g);
  assert.ok(before?.length);
  await page.getByRole('switch',{name:'启用日志美化'}).click();
  await flush(page);
  assert.deepEqual((await visibleLogText(page)).match(/sentinel-\d+/g),before,'same text must not jump to the first occurrence');
});

test('JSON formatting preserves the historical record when the viewport starts inside it',async t=>{
  const {page,send,sessions}=await fixture(t);
  send(Array.from({length:400},(_,index)=>JSON.stringify({record:`json-${index}`,message:'historical payload'})));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('600/600'));
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await flush(page);
  await page.evaluate(()=>{
    const terminal=window.logsTerminal;
    const buffer=terminal.buffer.active;
    const index=Array.from({length:buffer.length},(_,index)=>index).find(index=>buffer.getLine(index)?.translateToString(true).includes('"record": "json-120"'));
    if(index===undefined)throw new Error('JSON fixture did not render');
    terminal.scrollToLine(index);
  });
  await page.waitForFunction(()=>window.logsTerminal.buffer.active.viewportY<window.logsTerminal.buffer.active.baseY);
  assert.match((await visibleLogText(page)).split('\n')[0],/json-120/);
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await flush(page);
  assert.match((await visibleLogText(page)).split('\n')[0],/json-120/,'formatting must track the containing record, not reuse its old physical row');
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await flush(page);
  assert.match(await visibleLogText(page),/json-120/);
  assert.equal(sessions.length,1);
});

test('hidden severity records do not change the replay anchor of repeated JSON lines',async t=>{
  const {page,send}=await fixture(t);
  send(Array.from({length:400},(_,index)=>JSON.stringify({record:`severity-${index}`,message:index%2===0?'INFO payload':'ERROR payload'})));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('600/600'));
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await page.getByRole('combobox',{name:'日志级别'}).click();
  await page.locator('.ant-select-item-option').filter({hasText:'INFO'}).click();
  await page.keyboard.press('Escape');
  await flush(page);
  await page.evaluate(()=>{
    const terminal=window.logsTerminal;
    const buffer=terminal.buffer.active;
    const index=Array.from({length:buffer.length},(_,index)=>index).find(index=>buffer.getLine(index)?.translateToString(true).includes('"record": "severity-120"'));
    if(index===undefined)throw new Error('Filtered fixture did not render');
    terminal.scrollToLine(index+2); // The closing brace is shared by hidden ERROR records.
  });
  await page.waitForFunction(()=>window.logsTerminal.buffer.active.viewportY<window.logsTerminal.buffer.active.baseY);
  assert.match((await visibleLogText(page)).split('\n')[0],/^}/);
  await page.getByRole('switch',{name:'启用日志格式化'}).click();
  await flush(page);
  assert.match((await visibleLogText(page)).split('\n')[0],/severity-120/,'hidden records must not contribute to the anchor occurrence count');
});

test('history reading preserves position and counts new output without stopping reception',async t=>{
  // Removing viewport restoration, unread updates, or separating receive/follow breaks this flow.
  const {page,sessions,send}=await fixture(t);
  await page.locator('.xterm').hover();
  await page.mouse.wheel(0,-720);
  await page.waitForFunction(()=>window.logsTerminal.buffer.active.viewportY<window.logsTerminal.buffer.active.baseY);
  const history=await terminalState(page);
  assert.equal(await page.getByRole('switch',{name:'跟随日志滚动'}).getAttribute('aria-checked'),'false');
  assert.equal(await page.getByRole('switch',{name:'实时接收日志'}).getAttribute('aria-checked'),'true');
  send(['live-one','live-two','live-three']);
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('203/203'));
  await page.getByRole('button',{name:'查看 3 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  let current=await terminalState(page);
  assert.equal(current.viewportY,history.viewportY);
  assert.match(current.text,/live-three/);
  assert.equal(sessions.length,1);
  await page.getByRole('button',{name:'查看 3 条新日志并恢复滚动跟随'}).click();
  current=await terminalState(page);
  assert.equal(current.viewportY,current.baseY);
  assert.equal(await page.getByRole('switch',{name:'跟随日志滚动'}).getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('.logs-new-output').count(),0);
  await page.getByRole('switch',{name:'跟随日志滚动'}).click();
  send('paused-at-bottom');
  await page.getByRole('button',{name:'查看 1 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  assert.match((await terminalState(page)).text,/paused-at-bottom/);
  assert.equal(sessions.length,1);
});

test('search keeps the active stream and live history while navigating real matches',async t=>{
  // Recreating a stream for local search or advancing on raw output loses operator context.
  const {page,sessions,send,historyReads}=await fixture(t);
  send('live-retained');
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('201/201'));
  await flush(page);
  await page.getByRole('button',{name:'查找日志'}).click();
  await page.getByPlaceholder('查找',{exact:true}).fill('MATCH');
  await page.getByText('已定位到匹配项',{exact:true}).waitFor();
  await flush(page);
  assert.equal(sessions.length,1,'local search must not create another session');
  assert.equal(historyReads(),1,'local search must not reload server history');
  const first=await terminalState(page);
  assert.match(first.text,/live-retained/);
  assert.ok(first.selection);
  await page.getByRole('button',{name:'下一个匹配'}).click();
  const second=await terminalState(page);
  assert.notDeepEqual(second.selection,first.selection);
  await page.getByRole('button',{name:'上一个匹配'}).click();
  assert.deepEqual((await terminalState(page)).selection,first.selection);
  send('live-after-search');
  await page.getByRole('button',{name:'查看 1 条新日志并恢复滚动跟随'}).waitFor();
  await flush(page);
  assert.deepEqual((await terminalState(page)).selection,first.selection,'incoming output must not advance the active search');
  await page.getByPlaceholder('查找',{exact:true}).fill('absent-fixture');
  await page.getByText('暂无结果',{exact:true}).waitFor();
  await page.getByRole('button',{name:'使用正则表达式'}).click();
  await page.getByPlaceholder('查找',{exact:true}).fill('[');
  await page.getByText('无效的正则表达式',{exact:true}).waitFor();
  assert.equal(sessions.length,1);
});

test('clear removes visible and downloadable logs while the same stream remains usable',async t=>{
  const {page,sessions,send}=await fixture(t);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载日志'}).click()]);
  assert.equal(download.suggestedFilename(),'fixture-ns-fixture-pod-main-logs.txt');
  const stream=await download.createReadStream();
  const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString(),/history-010 MATCH/);
  await page.getByRole('button',{name:'清除日志'}).click();
  await flush(page);
  assert.doesNotMatch((await terminalState(page)).text,/history-/);
  assert.equal(sessions.length,1);
  send('only-after-clear');
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('1/1'));
  await flush(page);
  assert.match((await terminalState(page)).text,/only-after-clear/);
  assert.doesNotMatch((await terminalState(page)).text,/history-/);
});

test('local formatting redraws each buffered line once without reconnecting',async t=>{
  const {page,sessions,send,historyReads}=await fixture(t);
  send('retained-during-format');
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('201/201'));
  await flush(page);
  await page.getByRole('switch',{name:'启用日志美化'}).click();
  await flush(page);
  assert.equal(sessions.length,1);
  assert.equal(historyReads(),1);
  const {text}=await terminalState(page);
  assert.equal(text.match(/retained-during-format/g)?.length,1);
  assert.equal(text.match(/history-199/g)?.length,1);
});

test('real socket renders Go gateway content frames and legacy data/payload envelopes',async t=>{
  const {page,sockets}=await fixture(t);
  const socket=sockets.at(-1);
  for(const frame of [
    {type:'log',content:'gateway-log\npong',timestamp:'2026-10-10T08:00:00.000Z'},
    {type:'stdout',data:{type:'stdout',content:'legacy-data'}},
    {event:'logs.output',payload:{type:'stderr',message:'legacy-payload'}},
  ])socket.send(JSON.stringify(frame));
  await page.waitForFunction(()=>document.querySelector('.runtime-status-strip')?.textContent?.includes('204/204'));
  await flush(page);
  const {text}=await terminalState(page);
  assert.match(text,/gateway-log/);
  assert.match(text,/pong/);
  assert.match(text,/legacy-data/);
  assert.match(text,/legacy-payload/);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844}])test(`light and dark workbench with an open search stay inside a ${viewport.width}px viewport`,async t=>{
  const {page,sessions}=await fixture(t,viewport);
  await page.getByRole('button',{name:'查找日志'}).click();
  await page.getByPlaceholder('查找',{exact:true}).waitFor();
  await page.waitForFunction(()=>{
    const popup=document.querySelector('.headlamp-search-popover')?.closest('.ant-popover');
    return popup&&!/appear|enter/.test(popup.className);
  });
  const backgrounds=[];
  for(const theme of ['light','dark']){
    if(theme==='dark')await page.evaluate(()=>window.toggleLogsTheme());
    await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
    await flush(page);
    if(theme==='dark')await page.waitForFunction(()=>getComputedStyle(document.querySelector('.logs-workbench-shell')).backgroundColor!=='rgb(248, 250, 252)');
    if(theme==='dark')await page.waitForFunction(()=>getComputedStyle(document.querySelector('.headlamp-search-popover .ant-input')).backgroundColor==='rgb(15, 23, 34)');
    const geometry=await page.evaluate(()=>{
      const shell=document.querySelector('.logs-workbench-shell');
      const search=document.querySelector('.headlamp-search-popover');
      const host=document.querySelector('.logs-terminal-host');
      const rect=search.getBoundingClientRect();
      return {scrollWidth:document.documentElement.scrollWidth,width:innerWidth,searchLeft:rect.left,searchRight:rect.right,shellBg:getComputedStyle(shell).backgroundColor,searchBg:getComputedStyle(search.querySelector('.ant-input')).backgroundColor,hostBg:getComputedStyle(host).backgroundColor,xtermBg:window.logsTerminal.options.theme.background,cols:window.logsTerminal.cols};
    });
    assert.ok(geometry.scrollWidth<=geometry.width,`${theme} document overflow: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.searchLeft>=0&&geometry.searchRight<=viewport.width,`${theme} search overflow: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.cols>10);
    const rgb=await page.evaluate(color=>{const node=document.createElement('div');node.style.color=color;document.body.append(node);const normalized=getComputedStyle(node).color;node.remove();return normalized;},geometry.xtermBg);
    assert.equal(geometry.hostBg,rgb,'Xterm and its host must use the same theme background');
    backgrounds.push(geometry.shellBg);
    if(theme==='dark')assert.notEqual(geometry.searchBg,'rgb(255, 255, 255)','search portal input must follow the real dark theme');
    if(process.env.LOGS_COMPONENT_QA_DIR)await page.screenshot({path:join(process.env.LOGS_COMPONENT_QA_DIR,`logs-${viewport.width}-${theme}.png`),fullPage:true,animations:'disabled'});
  }
  assert.notEqual(backgrounds[0],backgrounds[1]);
  assert.equal(sessions.length,1,'theme changes must not recreate the stream');
});
