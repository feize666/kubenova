import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useScopedDeferredValue } from './use-scoped-deferred-value';

test('no render receives prior-scope deferred resources after the current scope changes',async()=>{
  const dom=new JSDOM('<div id="root"></div>');
  const replacements={window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const original=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries(replacements)){
    original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const root=createRoot(dom.window.document.getElementById('root')!);
  const frames:Array<{scope:string;value:readonly string[]}>=[];
  function Probe({value,scope,filter=''}:{value:readonly string[];scope:string;filter?:string}) {
    const resources=useScopedDeferredValue(value,scope);
    const currentFilter=useScopedDeferredValue(filter,scope);
    const shown=useScopedDeferredValue(resources.filter(item=>item.startsWith(currentFilter)),scope);
    frames.push({scope,value:shown});
    return createElement('output',null,shown.join(','));
  }
  try {
    await act(async()=>root.render(createElement(Probe,{scope:'account-a/prod',value:['private-pod']})));
    frames.length=0;
    await act(async()=>root.render(createElement(Probe,{scope:'account-b/dev',value:[]})));
    assert.ok(frames.length>0);
    assert.ok(frames.every(frame=>frame.scope==='account-b/dev'&&frame.value.length===0));
    const cached=['old-label-row','new-label-row'];
    await act(async()=>root.render(createElement(Probe,{scope:'tag-old',value:cached,filter:'old'})));
    frames.length=0;
    await act(async()=>root.render(createElement(Probe,{scope:'tag-new',value:cached,filter:'new'})));
    assert.ok(frames.length>0);
    assert.ok(frames.every(frame=>frame.scope==='tag-new'&&frame.value.join(',')==='new-label-row'));
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
