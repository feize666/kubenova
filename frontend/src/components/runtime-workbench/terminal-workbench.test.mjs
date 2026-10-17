import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
        import {App} from 'antd';
        import {ThemeProvider,useThemeMode} from '../theme-context';
        import TerminalWorkbench from './terminal-workbench';
        import {connectWsWithCandidates} from '@/lib/ws/terminal';
        import '../../app/globals.css';
        const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
        window.refreshClusterNames=()=>client.refetchQueries({queryKey:['clusters','list']});
        const root=createRoot(document.getElementById('root'));
        window.unmountTerminal=()=>root.unmount();
        window.connectTerminalCandidates=connectWsWithCandidates;
        function Fixture(){
          const [query,setQuery]=React.useState(()=>new URLSearchParams('clusterId=fixture-cluster&namespace=fixture-ns&pod=fixture-pod&container=main&returnTo='+encodeURIComponent('/clusters/fixture-cluster/resource/pods/fixture-ns/fixture-pod?tab=containers')));
          const [closed,setClosed]=React.useState(false);
          const [filter,setFilter]=React.useState('');
          const {toggleTheme}=useThemeMode();
          React.useEffect(()=>{window.toggleTerminalTheme=toggleTheme;window.changeTerminalTarget=container=>setQuery(new URLSearchParams('clusterId=fixture-cluster&namespace=fixture-ns&pod=fixture-pod&container='+container));},[toggleTheme]);
          return closed?<><h2>Original Pod detail</h2><input aria-label="Resource filter" value={filter} onChange={event=>setFilter(event.target.value)}/><output>{filter}</output></>:<TerminalWorkbench query={query} onClose={window.useEmbeddedClose?()=>{window.detailReturns++;setClosed(true);}:undefined}/>;
        }
        root.render(<ThemeProvider><App><QueryClientProvider client={client}><Fixture/></QueryClientProvider></App></ThemeProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    plugins: [{name:'terminal-component-fixture',setup(builder) {
      builder.onResolve({filter:/^(?:@\/components\/(?:auth-context|cluster-workspace-context)|next\/navigation)$/},args=>({path:args.path,namespace:'fixture-context'}));
      builder.onLoad({filter:/.*/,namespace:'fixture-context'},args=>({contents:args.path==='next/navigation'
        ? 'const params=new URLSearchParams();const router={replace(url){window.returnRoutes.push(url);window.unmountTerminal();}};export const useRouter=()=>router;export const useSearchParams=()=>params;export const usePathname=()=>"/terminal";'
        : args.path.endsWith('auth-context')
          ? 'export const useAuth=()=>({role:"admin",accessToken:"fixture-token",isInitializing:false});'
          : 'export const useOptionalClusterWorkspace=()=>null;',loader:'js'}));
      builder.onResolve({filter:/^@xterm\/xterm$/},args=>args.namespace==='real-terminal' ? undefined : ({path:args.path,namespace:'real-terminal'}));
      builder.onResolve({filter:/xterm\.js$/,namespace:'real-terminal'},args=>({path:args.path,namespace:'file'}));
      builder.onLoad({filter:/.*/,namespace:'real-terminal'},()=>({contents:`import {Terminal as ActualTerminal} from '${require.resolve('@xterm/xterm')}';
        export class Terminal extends ActualTerminal {constructor(options){super(options);window.fixtureTerminal=this;}}`,loader:'js'}));
      builder.onLoad({filter:/\.tsx$/},async args=>{
        const source=await readFile(args.path,'utf8');
        if(!source.includes('<style jsx'))return;
        const result=transformSync(source,{filename:args.path,configFile:false,babelrc:false,parserOpts:{plugins:['jsx','typescript']},plugins:[require.resolve('styled-jsx/babel')]});
        return {contents:result.code,loader:'tsx'};
      });
    }}],
    define:{'process.env.NEXT_PUBLIC_CONTROL_API_BASE':'""','process.env.NODE_ENV':'"test"'},
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/terminal-component-fixture.js',logLevel:'silent',
  });
}

async function fixture(t,{viewport={width:1440,height:900},pendingSocket=false,embedded=false,deferContainer,reducedMotion='no-preference'}={}) {
  const bundle=await componentBundle();
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport,reducedMotion});
  page.setDefaultTimeout(5000);
  const errors=[], unexpected=[], sessions=[], sockets=[], inputs=[];
  let releaseSession;
  let clusterStatus=200;
  const deferred=new Promise(resolve=>{releaseSession=resolve;});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname!=='terminal-test.local'){unexpected.push(request.url());return route.abort();}
    if(request.resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>'});
    if(request.method()==='GET'&&url.pathname==='/api/clusters')return route.fulfill({status:clusterStatus,json:clusterStatus===200?{data:{items:[{id:'fixture-cluster',name:'Fixture Cluster',state:'active',hasKubeconfig:true}],total:1,page:1,pageSize:200}}:{message:'cluster list unavailable'}});
    if(request.method()==='GET'&&url.pathname==='/api/cluster-health')return route.fulfill({json:{data:{items:[{clusterId:'fixture-cluster',runtimeStatus:'running',lifecycleState:'active'}]}}});
    if(request.method()==='POST'&&url.pathname==='/api/runtime/sessions'){
      const payload=request.postDataJSON();
      sessions.push(payload);
      const sessionId=`s${sessions.length}-${payload.container}`;
      if(payload.container===deferContainer)await deferred;
      return route.fulfill({json:{data:{sessionId,gatewayWsUrl:`ws://terminal-test.local/ws/terminal/${sessionId}`,expiresAt:'2099-01-01T00:00:00.000Z',sessionState:'ready',reconnectable:true,target:{clusterId:'fixture-cluster',namespace:'fixture-ns',pod:'fixture-pod',container:payload.container,availableContainers:['main','sidecar'],podPhase:'Running'}}}});
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  });
  await page.routeWebSocket('**/*',socket=>{
    if(!socket.url().startsWith('ws://terminal-test.local/ws/terminal/')){unexpected.push(socket.url());return socket.close();}
    sockets.push(socket);
    socket.onMessage(message=>inputs.push({url:socket.url(),frame:JSON.parse(String(message))}));
  });
  await page.goto('http://terminal-test.local/');
  await page.clock.install();
  await page.evaluate(({pendingSocket,embedded})=>{
    window.useEmbeddedClose=embedded;window.detailReturns=0;window.returnRoutes=[];window.clientSockets=[];window.runtimeTimers=new Map();
    for(const [setName,clearName,repeating] of [['setTimeout','clearTimeout',false],['setInterval','clearInterval',true]]){
      const originalSet=window[setName].bind(window),originalClear=window[clearName].bind(window);
      window[setName]=(callback,delay,...args)=>{
        let id;
        id=originalSet((...values)=>{if(!repeating)window.runtimeTimers.delete(id);callback(...values);},delay,...args);
        const stack=new Error().stack;
        if([5000,10000,20000].includes(delay)&&/connectSingleWsCandidate|startHeartbeat|connectTerminal/.test(stack))window.runtimeTimers.set(id,{delay,callback});
        return id;
      };
      window[clearName]=id=>{window.runtimeTimers.delete(id);originalClear(id);};
    }
    if(pendingSocket){
      // The unavailable network boundary remains CONNECTING until the real helper times out or closes it.
      window.WebSocket=class {
        static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
        readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;
        constructor(url){this.url=url;window.clientSockets.push(this);}
        close(){this.readyState=3;this.onclose?.({code:1000,reason:''});}
        send(){throw new Error('input sent to pending socket');}
      };
    }else{
      const NativeSocket=window.WebSocket;
      window.WebSocket=class extends NativeSocket {constructor(url){super(url);window.clientSockets.push(this);}};
    }
  },{pendingSocket,embedded});
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForFunction(()=>window.fixtureTerminal&&document.querySelector('.terminal-workbench-shell'));
  if(!pendingSocket&&!deferContainer)await connected(page);
  t.after(()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);});
  return {page,sessions,sockets,inputs,releaseSession,setClusterStatus:value=>{clusterStatus=value}};
}

for(const reducedMotion of ['reduce','no-preference'])test(`terminal ${reducedMotion} respects motion preference while output and return remain usable`,async t=>{
  // Reduced motion must silence controls without disabling output or closing the original detail.
  const {page,sockets,sessions}=await fixture(t,{embedded:true,reducedMotion});
  const motion=await page.evaluate(()=>({
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    animations:['.terminal-workbench-stage--connected','.terminal-xterm-host'].flatMap(selector=>['::before','::after'].map(pseudo=>getComputedStyle(document.querySelector(selector),pseudo).animationName)),
    transition:getComputedStyle(document.querySelector('.terminal-workbench-container-select')).transitionDuration,
  }));
  assert.equal(motion.reduced,reducedMotion==='reduce');
  assert.deepEqual(motion.animations,['none','none','none','none'],'the connected terminal has no decorative sweep in either preference');
  if(reducedMotion==='reduce'){
    assert.ok(durationMs(motion.transition).every(value=>value<=1),JSON.stringify(motion));
  }else{
    assert.ok(durationMs(motion.transition).some(value=>value>1),JSON.stringify(motion));
  }
  sockets[0].send(JSON.stringify({type:'stdout',content:'motion-preference-terminal-output\r\n'}));
  assert.match(await terminalText(page),/motion-preference-terminal-output/);
  await page.getByRole('button',{name:/返回资源/}).click();
  await page.getByRole('button',{name:/断开并返回/}).click();
  await page.getByRole('heading',{name:'Original Pod detail'}).waitFor();
  await page.waitForFunction(()=>window.clientSockets.every(socket=>socket.readyState===WebSocket.CLOSED));
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),0);
  assert.equal(await page.locator('.terminal-workbench-shell').count(),0);
  await page.getByRole('textbox',{name:'Resource filter'}).fill('fixture-pod');
  assert.equal(await page.locator('output').innerText(),'fixture-pod','the restored detail still responds to interaction');
  assert.equal(sessions.length,1);
});

async function connected(page) {
  await page.waitForFunction(()=>document.querySelector('.terminal-workbench-shell')?.classList.contains('ops-frame-shell--connected'));
}

async function flush(page) {
  await page.evaluate(()=>new Promise(resolve=>window.fixtureTerminal.write('\x1b[0m',()=>requestAnimationFrame(resolve))));
}

async function terminalText(page) {
  await flush(page);
  return page.evaluate(()=>{const buffer=window.fixtureTerminal.buffer.active;return Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)).join('\n');});
}

async function selectContainer(page,container) {
  await page.getByRole('combobox',{name:'容器'}).click();
  await page.getByTitle(container,{exact:true}).last().click();
}

test('revoked cluster names stay hidden while the independently authorized terminal continues',async t=>{
  const {page,sessions,sockets,setClusterStatus}=await fixture(t);
  await page.waitForFunction(()=>document.body.innerText.includes('Fixture Cluster'));
  setClusterStatus(403);
  await page.evaluate(()=>window.refreshClusterNames());
  await page.waitForFunction(()=>!document.body.innerText.includes('Fixture Cluster'));
  setClusterStatus(503);
  await page.evaluate(()=>window.refreshClusterNames());
  assert.ok(!(await page.locator('body').innerText()).includes('Fixture Cluster'));
  sockets[0].send(JSON.stringify({type:'stdout',content:'independent-session-output\r\n'}));
  assert.match(await terminalText(page),/independent-session-output/);
  assert.equal(sessions.length,1);
  setClusterStatus(200);
  await page.evaluate(()=>window.refreshClusterNames());
  await page.waitForFunction(()=>document.body.innerText.includes('Fixture Cluster'));
  assert.equal(sessions.length,1);
});

test('1011 closure waits for explicit reconnect and never replays old or disconnected input',async t=>{
  // An automatic retry or queued onData payload would send a command into a new shell.
  const {page,sessions,sockets,inputs}=await fixture(t);
  await page.locator('.xterm-helper-textarea').pressSequentially('before-close');
  await page.waitForFunction(()=>window.clientSockets[0].readyState===WebSocket.OPEN);
  sockets[0].send(JSON.stringify({type:'stdout',content:'first-shell-output\r\n'}));
  assert.match(await terminalText(page),/first-shell-output/);
  await assertEventually(()=>assert.equal(inputs.filter(item=>item.frame.type==='input').map(item=>item.frame.input).join(''),'before-close'));
  sockets[0].close({code:1011,reason:'fixture failure'});
  await page.getByText(/请手动重新连接；不会重放已输入命令/).waitFor();
  await page.locator('.xterm-helper-textarea').pressSequentially('offline-command');
  await page.clock.fastForward(60000);
  assert.equal(sessions.length,1);
  assert.equal(sockets.length,1);
  await page.getByRole('button',{name:/重连/}).click();
  await connected(page);
  assert.equal(sessions.length,2);
  assert.deepEqual(sessions[1],{type:'terminal',clusterId:'fixture-cluster',namespace:'fixture-ns',pod:'fixture-pod',container:'main'});
  await page.locator('.xterm-helper-textarea').pressSequentially('new-input');
  await assertEventually(()=>assert.equal(inputs.filter(item=>item.url.endsWith('s2-main')&&item.frame.type==='input').map(item=>item.frame.input).join(''),'new-input'));
});

test('switching containers rejects stale socket messages and stale delayed session metadata',async t=>{
  // Removing generation checks lets a delayed old session overwrite the target cache or output.
  const {page,sessions,sockets,releaseSession}=await fixture(t,{deferContainer:'sidecar'});
  await connected(page);
  await page.evaluate(()=>{window.oldTerminalMessage=window.clientSockets[0].onmessage;});
  await selectContainer(page,'sidecar');
  await assertEventually(()=>assert.equal(sessions.length,2));
  await page.evaluate(()=>window.changeTerminalTarget('main'));
  await assertEventually(()=>assert.equal(sessions.length,3));
  await connected(page);
  releaseSession();
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.oldTerminalMessage({data:JSON.stringify({type:'stdout',content:'STALE-OUTPUT'})}));
  sockets.at(-1).send(JSON.stringify({type:'stdout',content:'current-main-output'}));
  const text=await terminalText(page);
  assert.doesNotMatch(text,/STALE-OUTPUT/);
  assert.match(text,/current-main-output/);
  assert.match(await page.locator('.runtime-status-strip').innerText(),/s3-main/);
  sockets.at(-1).send(JSON.stringify({type:'system',state:'disconnected',content:'server-paused'}));
  await page.waitForFunction(()=>document.querySelector('.terminal-workbench-shell')?.classList.contains('ops-frame-shell--disconnected'));
  await page.getByRole('button',{name:/重连/}).click();
  await connected(page);
  assert.equal(sessions.length,3,'the delayed sidecar session must not displace the valid current main session cache');
  assert.ok(sockets.at(-1).url().endsWith('/s3-main'));
});

for(const embedded of [false,true])test(`${embedded?'embedded close':'route return'} closes socket and heartbeat before restoring the original detail`,async t=>{
  const {page,sessions}=await fixture(t,{embedded});
  await page.getByRole('button',{name:/返回资源/}).click();
  await page.getByRole('button',{name:'继续操作',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.clientSockets[0].readyState),1);
  await page.getByRole('button',{name:/返回资源/}).click();
  await page.getByRole('button',{name:/断开并返回/}).click();
  await page.waitForFunction(()=>window.clientSockets.every(socket=>socket.readyState===WebSocket.CLOSED));
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),0,'no runtime connection/heartbeat timer may remain after return');
  if(embedded){await page.getByRole('heading',{name:'Original Pod detail'}).waitFor();assert.equal(await page.evaluate(()=>window.detailReturns),1);}
  else assert.deepEqual(await page.evaluate(()=>window.returnRoutes),['/clusters/fixture-cluster/resource/pods/fixture-ns/fixture-pod?tab=containers']);
  assert.equal(sessions.length,1);
});

test('closing during websocket connection cancels the candidate timeout without opening a fallback',async t=>{
  // A dangling helper timeout would resume fallback selection after the workbench has unmounted.
  const {page,sessions}=await fixture(t,{pendingSocket:true,embedded:true});
  await page.waitForFunction(()=>window.clientSockets.length===1);
  await page.getByRole('button',{name:/返回资源/}).click();
  await page.getByRole('button',{name:/断开并返回/}).click();
  await page.getByRole('heading',{name:'Original Pod detail'}).waitFor();
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),0,'candidate timeout must be canceled immediately');
  assert.equal(await page.evaluate(()=>window.clientSockets[0].readyState),3);
  await page.clock.fastForward(60000);
  assert.equal(await page.evaluate(()=>window.clientSockets.length),1);
  assert.equal(sessions.length,1);
});

test('switching targets while a socket is connecting closes the old candidate and connects only the current target',async t=>{
  const {page,sessions}=await fixture(t,{pendingSocket:true});
  await page.waitForFunction(()=>window.clientSockets.length===1);
  await page.evaluate(()=>window.changeTerminalTarget('sidecar'));
  await page.waitForFunction(()=>window.clientSockets.length===2);
  assert.deepEqual(sessions.map(session=>session.container),['main','sidecar']);
  assert.deepEqual(await page.evaluate(()=>window.clientSockets.map(socket=>socket.readyState)),[3,0]);
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),1,'only the current socket may own a connection timer');
  await page.evaluate(()=>window.unmountTerminal());
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),0);
  await page.clock.fastForward(60000);
  assert.equal(await page.evaluate(()=>window.clientSockets.length),2);
});

test('candidate fallback still resolves a later successful address when no cancellation signal is supplied',async t=>{
  const {page}=await fixture(t,{pendingSocket:true});
  await page.waitForFunction(()=>window.clientSockets.length===1);
  await page.evaluate(()=>window.unmountTerminal());
  await page.evaluate(()=>{
    window.candidateResult=window.connectTerminalCandidates(['ws://first-fixture.invalid','ws://second-fixture.invalid'],()=>{}).then(socket=>socket.url);
    window.clientSockets[1].onerror();
  });
  await page.waitForFunction(()=>window.clientSockets.length===3);
  const result=await page.evaluate(async()=>{window.clientSockets[2].readyState=1;window.clientSockets[2].onopen();return window.candidateResult;});
  assert.equal(result,'ws://second-fixture.invalid');
  assert.deepEqual(await page.evaluate(()=>window.clientSockets.slice(1).map(socket=>socket.readyState)),[3,1]);
  assert.equal(await page.evaluate(()=>window.runtimeTimers.size),0);
});

for(const viewport of [{width:1440,height:900},{width:390,height:844}])test(`light and dark terminal controls fit a ${viewport.width}px viewport without reconnecting`,async t=>{
  const {page,sessions}=await fixture(t,{viewport});
  const backgrounds=[];
  for(const theme of ['light','dark']){
    if(theme==='dark')await page.evaluate(()=>window.toggleTerminalTheme());
    await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
    await flush(page);
    if(theme==='dark')await page.waitForFunction(()=>getComputedStyle(document.querySelector('.terminal-workbench-shell')).backgroundColor==='rgb(10, 16, 24)');
    const geometry=await page.evaluate(()=>{
      const shell=document.querySelector('.terminal-workbench-shell');
      const controls=[...shell.querySelectorAll('button,.ant-select')].map(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};});
      const terminalTheme=window.fixtureTerminal.options.theme;
      const normalize=color=>{const element=document.createElement('div');element.style.color=color;document.body.append(element);const rgb=getComputedStyle(element).color.match(/\d+/g).slice(0,3).map(Number);element.remove();return rgb;};
      const luminance=color=>normalize(color).map(value=>{const normalized=value/255;return normalized<=0.04045?normalized/12.92:((normalized+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
      const fore=luminance(terminalTheme.foreground),back=luminance(terminalTheme.background);
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,background:getComputedStyle(shell).backgroundColor,host:getComputedStyle(document.querySelector('.terminal-xterm-host')).backgroundColor,contrast:(Math.max(fore,back)+0.05)/(Math.min(fore,back)+0.05),cols:window.fixtureTerminal.cols,controls};
    });
    assert.ok(geometry.scrollWidth<=geometry.width,JSON.stringify(geometry));
    for(const control of geometry.controls)assert.ok(control.left>=0&&control.right<=viewport.width&&control.height>0,JSON.stringify(control));
    assert.ok(geometry.cols>10);
    assert.ok(geometry.contrast>=4.5,`terminal foreground is unreadable: ${JSON.stringify(geometry)}`);
    backgrounds.push(geometry.background);
  }
  assert.notEqual(backgrounds[0],backgrounds[1]);
  assert.equal(sessions.length,1);
});

async function assertEventually(assertion) {
  let error;
  for(let attempt=0;attempt<100;attempt++){
    try{return assertion();}catch(failure){error=failure;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw error;
}
