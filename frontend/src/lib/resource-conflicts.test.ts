import test from 'node:test';
import assert from 'node:assert/strict';
import { rebaseResourceDraft, type ResourceManifest } from './resource-editor';
const original:ResourceManifest={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings',namespace:'prod',resourceVersion:'1'},data:{choice:'old',stable:'keep',remove:'old'}};
const draft:ResourceManifest={...structuredClone(original),data:{choice:'draft',stable:'keep'}};
const latest:ResourceManifest={...structuredClone(original),metadata:{...original.metadata,resourceVersion:'2'},data:{choice:'server',stable:'keep',remove:'updated',added:'server-only'}};
test('each conflicting field needs an explicit choice; draft deletion and server additions survive independently',()=>{
  const unresolved=rebaseResourceDraft(original,draft,latest);
  assert.equal(unresolved.conflicts.length,2);
  const resolved=rebaseResourceDraft(original,draft,latest,{ '["data","choice"]':'server','["data","remove"]':'draft' });
  assert.deepEqual(resolved.conflicts,[]);
  assert.deepEqual(resolved.draft.data,{choice:'server',stable:'keep',added:'server-only'});
  assert.equal(resolved.draft.metadata.resourceVersion,'2');
});
test('dotted Kubernetes label keys cannot be confused with nested fields during conflict resolution',()=>{
  const before={...original,metadata:{...original.metadata,labels:{'example.io/name':'old'}}};
  const mine={...structuredClone(before),metadata:{...before.metadata,labels:{'example.io/name':'mine'}}};
  const live={...structuredClone(before),metadata:{...before.metadata,labels:{'example.io/name':'live'},resourceVersion:'3'}};
  const result=rebaseResourceDraft(before,mine,live,{'["metadata","labels","example.io/name"]':'draft'});
  assert.deepEqual(result.conflicts,[]);assert.equal((result.draft.metadata.labels as Record<string,string>)['example.io/name'],'mine');
});
