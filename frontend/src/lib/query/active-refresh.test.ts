import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createActiveRefresh } from './active-refresh';

test('refresh shares an in-flight request and only refetches active queries',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  let calls=0;
  let finish:(value:string)=>void=()=>{};
  client.setQueryData(['visible'],'cached');
  client.setQueryData(['inactive'],'untouched');
  const observer=new QueryObserver(client,{queryKey:['visible'],staleTime:Infinity,queryFn:()=>{calls++;return new Promise<string>(resolve=>{finish=resolve;});}});
  const unsubscribe=observer.subscribe(()=>{});
  const pending:boolean[]=[];
  const refresh=createActiveRefresh(client,value=>pending.push(value),()=>assert.fail('unexpected failure'));
  const first=refresh();
  const second=refresh();
  assert.equal(first,second);
  assert.equal(calls,1);
  assert.equal(client.getQueryData(['visible']),'cached');
  finish('updated');
  assert.equal(await first,true);
  assert.equal(client.getQueryData(['visible']),'updated');
  assert.equal(client.getQueryData(['inactive']),'untouched');
  assert.deepEqual(pending,[true,false]);
  unsubscribe();client.clear();
});

test('failed refresh preserves cached data, reports failure and permits retry',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  let failing=true;
  client.setQueryData(['visible'],{name:'existing'});
  const observer=new QueryObserver(client,{queryKey:['visible'],staleTime:Infinity,queryFn:async()=>{if(failing)throw new Error('offline');return {name:'new'};}});
  const unsubscribe=observer.subscribe(()=>{});
  let errors=0;
  const pending:boolean[]=[];
  const refresh=createActiveRefresh(client,value=>pending.push(value),()=>{errors++;});
  assert.equal(await refresh(),false);
  assert.deepEqual(client.getQueryData(['visible']),{name:'existing'});
  assert.equal(errors,1);
  failing=false;
  assert.equal(await refresh(),true);
  assert.deepEqual(client.getQueryData(['visible']),{name:'new'});
  assert.deepEqual(pending,[true,false,true,false]);
  unsubscribe();client.clear();
});

test('one failed panel cannot finish the global refresh while another panel is still pending',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['failed'],'cached-error-panel');
  client.setQueryData(['slow'],'cached-slow-panel');
  const failed=new QueryObserver(client,{queryKey:['failed'],staleTime:Infinity,queryFn:async()=>{throw new Error('offline');}});
  let finishSlow!:(value:string)=>void;
  let slowCalls=0;
  const slow=new QueryObserver(client,{queryKey:['slow'],staleTime:Infinity,queryFn:()=>{slowCalls++;return new Promise<string>(resolve=>{finishSlow=resolve;});}});
  const subscriptions=[failed.subscribe(()=>{}),slow.subscribe(()=>{})];
  const pending:boolean[]=[];
  let warnings=0;
  const refresh=createActiveRefresh(client,value=>pending.push(value),()=>{warnings++;});
  let settled=false;
  const first=refresh();void first.then(()=>{settled=true;});
  try {
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(settled,false);
    assert.deepEqual(pending,[true]);
    assert.equal(refresh(),first);
    assert.equal(slowCalls,1);
    finishSlow('new-slow-panel');
    assert.equal(await first,false);
    assert.deepEqual(pending,[true,false]);
    assert.equal(warnings,1);
    assert.equal(client.getQueryData(['slow']),'new-slow-panel');
    assert.equal(client.getQueryData(['failed']),'cached-error-panel');
  }finally{finishSlow?.('cleanup');await first;subscriptions.forEach(unsubscribe=>unsubscribe());client.clear();}
});
