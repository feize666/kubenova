import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

async function waitFor(check) {
  const deadline=Date.now()+2000;
  while(!check()) {
    assert.ok(Date.now()<deadline,'toolbar state did not settle');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}

test('Escape in the open mobile utility toolbar collapses it and restores opener focus',async()=>{
  const bundle=await build({
    stdin:{
      contents:`import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ConsoleUtilitySidebar} from './console-utility-sidebar';
        createRoot(document.getElementById('root')).render(<ConsoleUtilitySidebar><main>Resources</main></ConsoleUtilitySidebar>);`,
      resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx',
    },
    plugins:[{name:'utility-display-boundaries',setup(builder){
      builder.onResolve({filter:/^(?:antd|@ant-design\/icons|next\/(?:dynamic|navigation)|@tanstack\/react-query|@\/components\/(?:auth-context|theme-context|ai-assistant\/floating-assistant))$/},args=>({path:args.path,namespace:'utility-boundary'}));
      builder.onLoad({filter:/.*/,namespace:'utility-boundary'},args=>({
        contents:args.path==='antd'
          ? 'export const Tooltip=({children})=>children;export const Avatar=()=>null;'
          : args.path==='@ant-design/icons'
            ? 'export const BookOutlined=()=>null;export const LeftOutlined=()=>null;export const RightOutlined=()=>null;export const MoonOutlined=()=>null;export const SunOutlined=()=>null;export const RobotOutlined=()=>null;'
            : args.path==='@tanstack/react-query'
              ? 'export const useQuery=()=>({data:{allowed:false}});'
            : args.path==='next/navigation'
              ? 'export const useRouter=()=>({push(path){window.lastNavigation=path}});'
            : args.path==='next/dynamic'
              ? 'export default ()=>()=>null;'
              : args.path.endsWith('floating-assistant')
                ? 'export const FloatingAiAssistant=()=>null;'
              : args.path.endsWith('auth-context')
                ? 'export const useAuth=()=>({isAuthenticated:true,isInitializing:false,role:"viewer"});'
                : 'export const useThemeMode=()=>({mode:"dark",toggleTheme(){}});',
        loader:'js',
      }));
    }}],
    bundle:true,write:false,format:'iife',jsx:'automatic',outfile:'tmp/utility-focus-fixture.js',logLevel:'silent',
    define:{'process.env.NODE_ENV':'"production"'},
  });
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://utility-test.local',pretendToBeVisual:true,runScripts:'dangerously'});
  try {
    Object.defineProperty(dom.window,'innerWidth',{value:390});
    dom.window.matchMedia=()=>({matches:true});
    dom.window.process=process;
    dom.window.eval(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);
    const document=dom.window.document;
    await waitFor(()=>document.querySelector('.console-utility-restore'));
    document.querySelector('.console-utility-restore').click();
    await waitFor(()=>document.activeElement?.getAttribute('aria-label')==='收起侧边栏');
    const rail=document.querySelector('.console-utility-sidebar');
    rail.querySelector('[aria-label="打开使用手册"]').click();
    assert.equal(dom.window.lastNavigation,'/handbook','the manual entry belongs to the right utility rail');
    await waitFor(()=>rail.getAttribute('aria-hidden')==='true');
    document.querySelector('.console-utility-restore').click();
    await waitFor(()=>document.activeElement?.getAttribute('aria-label')==='收起侧边栏');
    const theme=rail.querySelector('[aria-label="切换到浅色主题"]');
    theme.focus();
    theme.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    await new Promise(resolve=>dom.window.requestAnimationFrame(resolve));
    assert.equal(rail.getAttribute('aria-hidden'),'true','Escape from a toolbar control must collapse the mobile rail');
    await waitFor(()=>document.activeElement?.getAttribute('aria-label')==='显示侧边栏');
    assert.equal(document.querySelector('.console-utility-backdrop'),null);
    assert.equal(dom.window.localStorage.getItem('kubenova.console.utility-sidebar.collapsed'),'1');
  } finally {
    dom.window.close();
  }
});
