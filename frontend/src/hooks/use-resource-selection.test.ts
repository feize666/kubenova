import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useResourceSelection } from './use-resource-selection';

type Row={id:string;name:string};
type Props=Parameters<typeof useResourceSelection<Row>>[0];
const row:Row={id:'a',name:'first'};

async function harness(initial:Props) {
  const dom=new JSDOM('<div id="root"></div>');
  const globals=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};
  const previous={window:globals.window,document:globals.document,act:globals.IS_REACT_ACT_ENVIRONMENT};
  globals.window=dom.window as unknown as Window & typeof globalThis;
  globals.document=dom.window.document;
  globals.IS_REACT_ACT_ENVIRONMENT=true;
  let selection:ReturnType<typeof useResourceSelection<Row>>;
  function Probe(props:Props) {
    selection=useResourceSelection(props);
    return createElement('output',null,JSON.stringify(selection.rowSelection?.selectedRowKeys));
  }
  const root=createRoot(dom.window.document.getElementById('root')!);
  const render=async(props:Props)=>{await act(async()=>{root.render(createElement(StrictMode,null,createElement(Probe,props)));});};
  await render(initial);
  return {
    render,
    keys:()=>JSON.parse(dom.window.document.querySelector('output')!.textContent!),
    selection:()=>selection!,
    change:async(keys:string[])=>{await act(async()=>{selection!.rowSelection!.onChange!(keys,[],{type:'single'});});},
    close:async()=>{
      await act(async()=>root.unmount());
      dom.window.close();
      globals.window=previous.window;globals.document=previous.document;globals.IS_REACT_ACT_ENVIRONMENT=previous.act;
    },
  };
}

test('uncontrolled selection is discarded after leaving and returning to a scope',async()=>{
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{}};
  const view=await harness(props);
  try {
    await view.change(['a']);assert.deepEqual(view.keys(),['a']);
    await view.render({...props,scopeKey:'dev'});assert.deepEqual(view.keys(),[]);
    await view.render(props);assert.deepEqual(view.keys(),[]);
  }finally{await view.close();}
});

test('cross-page preservation keeps fresh rows but never transfers row records across scopes',async()=>{
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{preserveSelectedRowKeys:true}};
  const view=await harness(props);
  try {
    await view.change(['a']);
    await view.render({...props,dataSource:[]});assert.deepEqual(view.keys(),['a']);
    assert.equal(view.selection().selectedRows[0].name,'first');
    await view.render({...props,dataSource:[{...row,name:'updated'}]});
    assert.equal(view.selection().selectedRows[0].name,'updated');
    await view.render({...props,scopeKey:'other',dataSource:[]});
    assert.deepEqual(view.selection().selectedRows,[]);
  }finally{await view.close();}
});

test('default selection applies only on entry and cannot reappear after a scope change',async()=>{
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{defaultSelectedRowKeys:['a']}};
  const view=await harness(props);
  try {
    assert.deepEqual(view.keys(),['a']);
    await view.render({...props,scopeKey:'dev'});assert.deepEqual(view.keys(),[]);
    await view.render(props);assert.deepEqual(view.keys(),[]);
  }finally{await view.close();}
});

test('without preservation a paged-away row is not restored when its page returns',async()=>{
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{}};
  const view=await harness(props);
  try {
    await view.change(['a']);
    await view.render({...props,dataSource:[]});assert.deepEqual(view.keys(),[]);
    await view.render(props);assert.deepEqual(view.keys(),[]);
  }finally{await view.close();}
});

test('controlled empty selection overrides a selected default and only reports requested changes',async()=>{
  const changes:string[][]=[];
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{selectedRowKeys:[],defaultSelectedRowKeys:['a'],onChange:keys=>changes.push(keys as string[])}};
  const view=await harness(props);
  try {
    assert.deepEqual(view.keys(),[]);
    await view.change(['a']);assert.deepEqual(view.keys(),[]);assert.deepEqual(changes,[['a']]);
    await view.render({...props,rowSelection:{...props.rowSelection,selectedRowKeys:['a']}});
    assert.deepEqual(view.keys(),['a']);
  }finally{await view.close();}
});

test('mobile selection reports callbacks in order and disabled rows do not dispatch',async()=>{
  const calls:string[]=[];
  let disabled=false;
  const props:Props={dataSource:[row],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{onSelect:()=>calls.push('select'),onChange:()=>calls.push('change'),getCheckboxProps:()=>({disabled,onChange:()=>calls.push('checkbox')})}};
  const view=await harness(props);
  try {
    const event={nativeEvent:new window.MouseEvent('click')} as Parameters<ReturnType<typeof useResourceSelection<Row>>['selectRow']>[2];
    await act(async()=>view.selection().selectRow(row,true,event));
    assert.deepEqual(calls,['select','change','checkbox']);assert.deepEqual(view.keys(),['a']);
    disabled=true;
    await act(async()=>view.selection().selectRow(row,false,event));
    assert.deepEqual(view.keys(),['a']);assert.equal(calls.length,3);
  }finally{await view.close();}
});

test('preserved controlled keys survive loading an unseen page and mobile selection',async()=>{
  const changes:string[][]=[];
  const other={id:'b',name:'second'};
  const props:Props={dataSource:[other],keyOf:item=>item.id,scopeKey:'prod',rowSelection:{preserveSelectedRowKeys:true,selectedRowKeys:['a'],onChange:keys=>changes.push(keys as string[])}};
  const view=await harness(props);
  try {
    assert.deepEqual(view.keys(),['a']);
    assert.deepEqual(view.selection().selectedRows,[]);
    const event={nativeEvent:new window.MouseEvent('click')} as Parameters<ReturnType<typeof useResourceSelection<Row>>['selectRow']>[2];
    await act(async()=>view.selection().selectRow(other,true,event));
    assert.deepEqual(changes,[['a','b']]);
  }finally{await view.close();}
});
