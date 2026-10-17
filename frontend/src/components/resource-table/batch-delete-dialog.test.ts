import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import type { BatchDeleteTarget } from '@/lib/table/batch-targets';
import type { BatchOperationResult } from '@/lib/table/batch-operation';

test('confirmation blocks duplicate requests and displays progress and partial results',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true,url:'http://localhost/'});
  const replacements:Record<string,unknown>={
    window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,
    ShadowRoot:dom.window.ShadowRoot,SVGElement:dom.window.SVGElement,
    // jsdom has no layout engine; this test verifies interaction, not measured geometry.
    ResizeObserver:class {observe(){} unobserve(){} disconnect(){}},
    getComputedStyle:(element:Element)=>dom.window.getComputedStyle(element),
    requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT:true,
  };
  const original=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries(replacements)) {
    original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  dom.window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;},media:'',onchange:null});
  const {createRoot}=await import('react-dom/client');
  const {BatchDeleteDialog}=await import('./batch-delete-dialog');
  const root=createRoot(dom.window.document.getElementById('root')!);
  let finishFirst!:()=>void;
  const firstPending=new Promise<void>(resolve=>{finishFirst=resolve;});
  const writes:string[]=[];
  let closed=0;
  let completed:BatchOperationResult<BatchDeleteTarget>[]=[];
  const targets=[
    {id:'a',clusterId:'cluster-a',namespace:'prod',name:'web',uid:'uid-a'},
    {id:'b',clusterId:'cluster-b',namespace:'prod',name:'web',uid:'uid-b'},
    {id:'c',clusterId:'cluster-a',namespace:'prod',name:'worker',uid:'uid-c'},
  ];
  const button=(text:string)=>Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent?.replace(/\s/g,'')===text)!;
  const inputText=async(value:string)=>{
    const input=dom.window.document.querySelector<HTMLInputElement>('input[aria-label="输入 DELETE 以确认操作"]')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
      input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
      input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    });
  };
  try {
    await act(async()=>root.render(createElement(BatchDeleteDialog,{
      targets,
      execute:async(target:BatchDeleteTarget)=>{
        writes.push(target.id);
        if(target.id==='a')await firstPending;
        if(target.id==='b')throw new Error('permission denied');
      },
      onClose:()=>{closed++;},
      onComplete:(results:BatchOperationResult<BatchDeleteTarget>[])=>{completed=results;},
    })));
    assert.equal(button('确认删除').disabled,true);
    assert.match(dom.window.document.body.textContent!,/cluster-a/);
    assert.match(dom.window.document.body.textContent!,/cluster-b/);
    await inputText('delete');assert.equal(button('确认删除').disabled,true);
    await inputText('DELETE');assert.equal(button('确认删除').disabled,false);
    await act(async()=>{button('确认删除').click();button('确认删除').click();});
    assert.deepEqual(writes,['a']);
    assert.match(dom.window.document.body.textContent!,/正在处理 0\/3/);
    await act(async()=>button('取消').click());assert.equal(closed,0);
    await act(async()=>{finishFirst();await firstPending;});
    assert.deepEqual(writes,['a','b','c']);
    assert.deepEqual(completed.map(result=>result.status),['succeeded','failed','succeeded']);
    assert.match(dom.window.document.body.textContent!,/处理完成：成功 2，失败 1/);
    assert.match(dom.window.document.body.textContent!,/失败：permission denied/);
    assert.match(dom.window.document.body.textContent!,/不会自动重试/);
    await act(async()=>button('关闭').click());assert.equal(closed,1);
  }finally{
    await act(async()=>root.unmount());
    dom.window.close();
    for(const [key,descriptor] of original) {
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else Reflect.deleteProperty(globalThis,key);
    }
  }
});
