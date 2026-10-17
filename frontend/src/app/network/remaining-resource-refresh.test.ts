import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { RESOURCE_LIST_REFRESH_OPTIONS } from '@/lib/resource-list-refresh';
import { ApiError } from '@/lib/api/client';

for (const kind of ['HPA', 'VPA', 'IngressClass']) {
  test(`${kind}: a denied refresh hides cached resources, a transient failure retains them, and recovery restores them`, async () => {
    const path = new URL(kind === 'IngressClass' ? './ingressclasses/page.tsx' : '../../components/workloads/autoscaling-console.tsx', import.meta.url);
    const file = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let call: ts.CallExpression | undefined;
    let key: ts.Node | undefined;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'policiesQueryKey') key = node.initializer;
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === (kind === 'IngressClass' ? 'list' : 'policiesQuery') && node.initializer && ts.isCallExpression(node.initializer)) call = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(file); assert.ok(call);
    const dom = new JSDOM('<div id="root"></div>');
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    }
    const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const root = createRoot(dom.window.document.getElementById('root')!);
    let latest!: UseQueryResult<{items:{name:string}[]}, Error>;
    let status = 200;
    const frames: Array<{error:unknown;visible:boolean}> = [];
    const fetch = async () => {
      if (status !== 200) throw new ApiError('controlled failure',status);
      return {items:[{name:'private-row'}],total:1};
    };
    const dependencies = {useQuery,useResourceListQuery,RESOURCE_LIST_REFRESH_OPTIONS,listAutoscalingPolicies:fetch,getIngressClasses:fetch,createElement,capture:(result:typeof latest)=>{latest=result;frames.push({error:result.error,visible:Boolean(result.data?.items.length)});}};
    const source = `return function Probe(){
      const clusterId='cluster-a',accessToken='account-a',namespace='prod',kind='',keyword='',effectiveTypeFilter='${kind}',queryEnabled=true;
      const pagination={pageIndex:0,pageSize:25},sortBy='',sortOrder='';
      ${key ? `const policiesQueryKey=${key.getText(file)};` : ''}
      const result=${call.getText(file)};capture(result);
      return createElement('output',null,result.data?.items?.map(item=>item.name).join(',')??'');
    }`;
    const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const Probe = new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
    const refresh = async (nextStatus:number) => {
      status=nextStatus;
      await act(async()=>{await latest.refetch();await new Promise(resolve=>setTimeout(resolve,20));});
    };
    try {
      await act(async()=>root.render(createElement(QueryClientProvider,{client},createElement(Probe))));
      await refresh(200);
      await refresh(503);
      assert.equal(dom.window.document.querySelector('output')!.textContent,'private-row');
      for(const denied of [401,403]) {
        frames.length=0; await refresh(denied);
        assert.equal(dom.window.document.querySelector('output')!.textContent,'');
        assert.ok(frames.filter(frame=>frame.error instanceof ApiError).every(frame=>!frame.visible));
        await refresh(200);
        assert.equal(dom.window.document.querySelector('output')!.textContent,'private-row');
      }
    } finally {
      await act(async()=>root.unmount());client.clear();
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});dom.window.close();
      for(const [name,value] of saved){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}
    }
  });
}
