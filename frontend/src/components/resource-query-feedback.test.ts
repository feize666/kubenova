import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ResourceQueryFeedback } from './resource-query-feedback';
import { ApiError } from '@/lib/api/client';
import { visibleResourceQueryData } from '@/lib/query/visible-resource-data';

test('refresh failure keeps the successful resource snapshot and labels it as stale rather than initial failure',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['pods'],{items:[{name:'existing-pod'}]});
  const observer=new QueryObserver<{items:{name:string}[]}>(client,{queryKey:['pods'],staleTime:Infinity,queryFn:async()=>{throw new Error('offline');}});
  const unsubscribe=observer.subscribe(()=>{});
  try {
    await observer.refetch();
    const result=observer.getCurrentResult();
    const markup=renderToStaticMarkup(createElement(ResourceQueryFeedback,{label:'Pod',query:result}));
    assert.match(markup,/ant-alert-warning/);
    assert.match(markup,/刷新失败/);
    assert.match(markup,/已保留最近一次成功读取的数据/);
    assert.deepEqual(result.data?.items,[{name:'existing-pod'}]);
  }finally{unsubscribe();client.clear();}
});

test('first-load failure does not claim to retain a nonexistent snapshot',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const observer=new QueryObserver(client,{queryKey:['pods'],enabled:false,queryFn:async()=>{throw new Error('forbidden');}});
  try {
    await observer.refetch();
    const markup=renderToStaticMarkup(createElement(ResourceQueryFeedback,{label:'Pod',query:observer.getCurrentResult()}));
    assert.match(markup,/ant-alert-error/);
    assert.match(markup,/Pod加载失败/);
    assert.doesNotMatch(markup,/已保留/);
    assert.match(markup,/重试/);
  }finally{client.clear();}
});

test('successful recovery removes the stale warning instead of leaving an old failure visible',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['pods'],{items:[]});
  let offline=true;
  const observer=new QueryObserver(client,{queryKey:['pods'],staleTime:Infinity,queryFn:async()=>{if(offline)throw new Error('offline');return {items:[]};}});
  const unsubscribe=observer.subscribe(()=>{});
  try {
    await observer.refetch();
    offline=false;await observer.refetch();
    assert.equal(renderToStaticMarkup(createElement(ResourceQueryFeedback,{label:'Pod',query:observer.getCurrentResult()})),'');
  }finally{unsubscribe();client.clear();}
});

for(const status of [401,403])test(`authorization failure ${status} hides cached records and does not claim a transient refresh warning`,()=>{
  const query={data:{items:[{name:'private-pod'}]},error:new ApiError('Access denied',status),isError:true,isFetching:false,refetch:async()=>({})};
  const markup=renderToStaticMarkup(createElement(ResourceQueryFeedback,{label:'Pod',query}));
  assert.match(markup,/ant-alert-error/);
  assert.doesNotMatch(markup,/已保留/);
  assert.equal(visibleResourceQueryData(query),undefined);
});

test('a transient network failure still exposes the last successful snapshot',()=>{
  const query={data:{items:[{name:'pod'}]},error:new Error('offline')};
  assert.deepEqual(visibleResourceQueryData(query),{items:[{name:'pod'}]});
});
