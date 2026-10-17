import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, isValidElement, type ReactElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { transformSync } from 'esbuild';
import vm from 'node:vm';
import * as resourceEditor from '@/lib/resource-editor';
import { editorReadAccess } from './editor-read-state';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const yaml='apiVersion: v1\nkind: Secret\nmetadata:\n  name: private\n  namespace: default\n  resourceVersion: "1"\nstringData:\n  password: private-server-value\n';
type Query={data:{yaml:string}|undefined;error:Error|null;isPending:boolean;isFetching:boolean;dataUpdatedAt:number};
type Element=ReactElement<Record<string,unknown>>;

function fixture() {
  let detail:Query={data:{yaml},error:null,isPending:false,isFetching:false,dataUpdatedAt:1};
  const refs:Array<{current:unknown}>=[];
  const states:unknown[]=[];
  let stateIndex=0;
  let refIndex=0;
  let queryIndex=0;
  const source=readFileSync(new URL('./resource-editor-page.tsx',import.meta.url),'utf8');
  const {code}=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'});
  const fixtureModule={exports:{} as {default:()=>Element;EditorDocument:unknown}};
  const fake=(name:string)=>name;
  const require=(id:string):unknown=>{
    if(id==='react/jsx-runtime')return jsxRuntime;
    if(id==='react')return {
      createContext,
      useState:(value:unknown)=>{
        const slot=stateIndex++;
        if(!(slot in states))states[slot]=typeof value==='function'?(value as ()=>unknown)():value;
        return [states[slot],(next:unknown)=>{states[slot]=next;}];
      },
      useRef:(value:unknown)=>refs[refIndex++]??(refs[refIndex-1]={current:value}),
      useMemo:(value:()=>unknown)=>value(),useCallback:(value:unknown)=>value,useEffect:()=>{},
    };
    if(id==='next/navigation')return {useRouter:()=>({push:()=>{}}),useSearchParams:()=>new URLSearchParams('clusterId=c1&kind=Secret&name=private&namespace=default&mode=yaml')};
    if(id==='@/components/auth-context')return {useAuth:()=>({accessToken:'test-token',isInitializing:false,role:'admin',username:'tester'})};
    if(id==='@/components/cluster-workspace-context')return {useOptionalClusterWorkspace:()=>null};
    if(id==='@tanstack/react-query')return {useQuery:()=>++queryIndex===3?detail:{data:{items:[]},error:null,isPending:false},useQueryClient:()=>({})};
    if(id==='@/lib/resource-editor')return resourceEditor;
    if(id.endsWith('.module.css'))return {__esModule:true,default:{}};
    if(id==='antd')return {Typography:{Title:'h3',Text:'span'},Alert:'alert',Space:'space',Button:'button'};
    if(id==='@/lib/query/visible-resource-data')return {isResourceAccessDenied:(error:{status?:number})=>error?.status===401||error?.status===403};
    if(id==='@/hooks/use-resource-list-query')return {useResourceListQuery:()=>{queryIndex++;return {data:{items:[]},error:null,isPending:false,isFetching:false};}};
    if(id.endsWith('editor-read-state'))return {editorReadAccess};
    return new Proxy({},{get:(_,name)=>name==='__esModule'?true:name==='default'?{}:fake(String(name))});
  };
  vm.runInNewContext(code,{module:fixtureModule,exports:fixtureModule.exports,require});
  return {
    render(next?:Partial<Query>) {detail={...detail,...next};refIndex=0;stateIndex=0;queryIndex=0;return fixtureModule.exports.default();},
    editor(tree:Element):Element|undefined {
      const visit=(node:unknown):Element|undefined=>{
        if(Array.isArray(node))return node.map(visit).find(Boolean);
        if(!isValidElement<Record<string,unknown>>(node))return undefined;
        if(node.type===fixtureModule.exports.EditorDocument)return node;
        return visit(node.props.children);
      };
      return visit(tree);
    },
  };
}

test('503 refresh keeps the same EditorDocument identity instead of discarding its in-memory Secret draft',()=>{
  const page=fixture();
  const before=page.editor(page.render());
  assert.ok(before);
  const after=page.editor(page.render({error:Object.assign(new Error('unavailable'),{status:503})}));
  assert.ok(after,'background refresh errors must not unmount EditorDocument');
  assert.equal(after.type,before.type);
  assert.equal(after.key,before.key);
  assert.equal(after.props.initialYaml,yaml);
  assert.equal(after.props.readUnavailable,false);
});

for(const status of [401,403])test(`${status} refresh keeps the draft session mounted but hides it through readUnavailable`,()=>{
  const page=fixture();
  const before=page.editor(page.render());
  assert.ok(before);
  const after=page.editor(page.render({error:Object.assign(new Error('denied'),{status})}));
  assert.ok(after,'authorization failures must retain the same memory-only draft session');
  assert.equal(after.key,before.key);
  assert.equal(after.props.readUnavailable,true);
  assert.equal(typeof after.props.onRetryRead,'function');
});

test('503 after denial remains hidden until a new successful read authorizes recovery',()=>{
  const page=fixture();
  const before=page.editor(page.render());
  page.render({error:Object.assign(new Error('denied'),{status:403})});
  const retry=page.editor(page.render({error:Object.assign(new Error('unavailable'),{status:503})}));
  assert.ok(retry);
  assert.equal(retry.props.readUnavailable,true,'stale cached YAML does not restore revoked read access');
  const recovered=page.editor(page.render({error:null,dataUpdatedAt:2}));
  assert.ok(recovered);
  assert.equal(recovered.key,before?.key);
  assert.equal(recovered.props.readUnavailable,false);
});

test('initial read failures do not mount an editor without a successful resource snapshot',()=>{
  const page=fixture();
  assert.equal(page.editor(page.render({data:undefined,error:new Error('unavailable')})),undefined);
});

test('read access latches authorization denial across transient retry errors and resets after success',()=>{
  const denied=editorReadAccess({scope:'private',denied:false},'private',Object.assign(new Error('denied'),{status:401}));
  assert.deepEqual(denied,{scope:'private',denied:true});
  assert.deepEqual(editorReadAccess(denied,'private',Object.assign(new Error('unavailable'),{status:503})),{scope:'private',denied:true});
  assert.deepEqual(editorReadAccess(denied,'private',null),{scope:'private',denied:false});
});

test('read denial does not follow the editor into a different resource identity',()=>{
  assert.deepEqual(editorReadAccess({scope:'old',denied:true},'new',new Error('unavailable')),{scope:'new',denied:false});
});

test('React Query retry preserves denial while pending and only successful reads release the guard',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['editor-read'],{yaml});
  let status=403;
  let retryGate:Promise<void>=Promise.resolve();
  const observer=new QueryObserver(client,{queryKey:['editor-read'],staleTime:Infinity,queryFn:async()=>{
    await retryGate;
    if(status!==200)throw Object.assign(new Error('Read failed'),{status});
    return {yaml};
  }});
  let access={scope:'private',denied:false};
  const unsubscribe=observer.subscribe(result=>{access=editorReadAccess(access,'private',result.error);});
  try {
    await observer.refetch();
    assert.equal(access.denied,true);
    let continueRetry:()=>void=()=>{};
    retryGate=new Promise<void>(resolve=>{continueRetry=resolve;});
    status=503;
    const retry=observer.refetch();
    assert.equal(observer.getCurrentResult().isFetching,true);
    assert.equal(access.denied,true,'beginning a retry must not authorize cached content');
    continueRetry();
    await retry;
    assert.equal(access.denied,true);
    status=200;
    await observer.refetch();
    assert.equal(access.denied,false);
  }finally{unsubscribe();client.clear();}
});
