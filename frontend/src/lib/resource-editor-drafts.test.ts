import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorDraftStore, type EditorDraftScope } from './resource-editor-drafts';

const scope:EditorDraftScope={username:'alice',clusterId:'a',kind:'ConfigMap',apiVersion:'v1',resource:'configmaps',namespace:'demo',name:'settings'};
const yaml='apiVersion: v1\nkind: ConfigMap\nmetadata: {name: settings, namespace: demo}\ndata: {key: changed}\n';
function storage(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
test('draft is isolated by every identity component and clearing preserves other scopes',()=>{
 const disk=storage();const store=createEditorDraftStore(()=>disk);
 assert.equal(store.save(scope,{yaml,originalYaml:yaml},true,100),true);
 for(const field of Object.keys(scope) as Array<keyof EditorDraftScope>)assert.equal(store.read({...scope,[field]:'other'},101),null);
 assert.equal(store.read(scope,101)?.yaml,yaml);
 store.save({...scope,username:'bob'},{yaml},true,100);store.clear(scope);
 assert.equal(store.read(scope,101),null);assert.equal(store.read({...scope,username:'bob'},101)?.yaml,yaml);
});
test('24 hour boundary expires and removes a draft',()=>{
 const disk=storage();const store=createEditorDraftStore(()=>disk);store.save(scope,{yaml},true,100);
 assert.ok(store.read(scope,100+86400000-1));assert.equal(store.read(scope,100+86400000),null);assert.equal(disk.data.size,0);
});
test('Secret kind in any document, nested List, original, or mismatched entry never persists',()=>{
 const secret='apiVersion: v1\nkind: Secret\nmetadata: {name: credentials}\nstringData: {password: private}\n';
 for(const content of [secret,yaml+'---\n'+secret,'apiVersion: v1\nkind: List\nmetadata: {}\nitems:\n- apiVersion: v1\n  kind: Secret\n  metadata: {name: credentials}\n  stringData: {password: private}\n']){
  const disk=storage();const store=createEditorDraftStore(()=>disk);store.save(scope,{yaml},true,100);
  assert.equal(store.save(scope,{yaml:content},true,101),false);assert.equal(disk.data.size,0);
 }
 const disk=storage();const store=createEditorDraftStore(()=>disk);
 assert.equal(store.save({...scope,kind:'Secret'},{yaml},true),false);
 assert.equal(store.save(scope,{yaml,originalYaml:secret},true),false);assert.equal(disk.data.size,0);
});
test('invalid YAML or lost write permission erases stale ordinary draft instead of flushing it',()=>{
 const disk=storage();const store=createEditorDraftStore(()=>disk);
 store.save(scope,{yaml},true);assert.equal(store.save(scope,{yaml:'kind: ['},true),false);assert.equal(disk.data.size,0);
 store.save(scope,{yaml},true);assert.equal(store.save(scope,{yaml},false),false);assert.equal(disk.data.size,0);
});
test('corrupt entries, unavailable storage and quota failure safely fall back to memory',()=>{
 const disk=storage();const store=createEditorDraftStore(()=>disk);store.save(scope,{yaml},true,100);
 const key=[...disk.data.keys()][0];disk.data.set(key,'bad json');assert.equal(store.read(scope,101),null);
 disk.data.set(key,JSON.stringify({yaml,savedAt:100}));assert.equal(store.read(scope,101),null);
 const unavailable=createEditorDraftStore(()=>{throw Error('denied');});assert.equal(unavailable.read(scope),null);assert.equal(unavailable.save(scope,{yaml},true),false);unavailable.clear(scope);
 const full=createEditorDraftStore(()=>({...disk,setItem:()=>{throw Error('quota');}}));assert.equal(full.save(scope,{yaml},true),false);
});
