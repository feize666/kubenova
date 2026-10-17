import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { scopedPlaceholder } from './scoped-placeholder';
import { listQueryOptions } from './policies';

for(const nextScope of ['user-b/cluster-a/prod','user-a/cluster-b/prod','user-a/cluster-a/dev']) {
  test(`a pending query never presents old records after switching to ${nextScope}`,()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const oldScope='user-a/cluster-a/prod';
    client.setQueryData(['resources',oldScope,1],['old-pod']);
    const options=(scope:string,page:number)=>({
      queryKey:['resources',scope,page],meta:{resourceScope:scope},staleTime:Infinity,
      queryFn:()=>new Promise<string[]>(()=>{}),
      placeholderData:(previous:string[]|undefined,query:Parameters<typeof scopedPlaceholder>[1])=>scopedPlaceholder(previous,query,scope),
    });
    const observer=new QueryObserver<string[]>(client,options(oldScope,1));
    const unsubscribe=observer.subscribe(()=>{});
    try {
      assert.deepEqual(observer.getCurrentResult().data,['old-pod']);
      observer.setOptions(options(nextScope,1));
      assert.equal(observer.getCurrentResult().data,undefined);
      assert.equal(observer.getCurrentResult().isPlaceholderData,false);
    }finally{unsubscribe();client.clear();}
  });
}

test('paging within the same resource scope retains the previous page while fetching',()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const scope='user-a/cluster-a/prod';
  client.setQueryData(['resources',scope,1],['first-page']);
  const options=(page:number)=>({queryKey:['resources',scope,page],meta:{resourceScope:scope},staleTime:Infinity,queryFn:()=>new Promise<string[]>(()=>{}),placeholderData:(previous:string[]|undefined,query:Parameters<typeof scopedPlaceholder>[1])=>scopedPlaceholder(previous,query,scope)});
  const observer=new QueryObserver<string[]>(client,options(1));
  const unsubscribe=observer.subscribe(()=>{});
  try {
    observer.setOptions(options(2));
    assert.deepEqual(observer.getCurrentResult().data,['first-page']);
    assert.equal(observer.getCurrentResult().isPlaceholderData,true);
  }finally{unsubscribe();client.clear();}
});

test('a missing or disabled scope cannot reuse an unclassified cache snapshot',()=>{
  assert.equal(scopedPlaceholder(['old'],undefined,'scope'),undefined);
  assert.equal(scopedPlaceholder(['old'],{meta:{resourceScope:''}},''),undefined);
});

test('production list defaults cannot reuse an old account snapshot without explicit scope metadata',()=>{
  // Canceled pending fetches schedule GC in their async finally, even after clear().
  // This test exercises scope defaults, not GC; do not leave a three-minute timer.
  const client=new QueryClient({defaultOptions:{queries:{...listQueryOptions,retry:false,gcTime:Infinity}}});
  client.setQueryData(['workloads','account-a'],['private']);
  const observer=new QueryObserver<string[]>(client,{queryKey:['workloads','account-a'],staleTime:Infinity,queryFn:()=>new Promise(()=>{})});
  const unsubscribe=observer.subscribe(()=>{});
  try {
    observer.setOptions({queryKey:['workloads','account-b'],queryFn:()=>new Promise(()=>{})});
    assert.equal(observer.getCurrentResult().data,undefined);
  }finally{unsubscribe();client.clear();}
});
