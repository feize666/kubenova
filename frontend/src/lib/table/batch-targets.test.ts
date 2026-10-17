import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBatchTargets, captureSelectedBatchTargets } from './batch-targets';
test('confirmation captures independent identities, deduplicates IDs, and excludes incomplete targets',()=>{
  const source=[{id:'a',name:'pod-a',namespace:'prod',clusterId:'c'},{id:'a',name:'pod-a',namespace:'prod',clusterId:'c'},{id:'b',name:'',namespace:'prod',clusterId:'c'}];
  const targets=captureBatchTargets(source);
  source[0].name='changed';
  assert.deepEqual(targets,[{id:'a',name:'pod-a',namespace:'prod',clusterId:'c'}]);
  assert.equal(Object.isFrozen(targets[0]),true);
});
test('the confirmed UID is copied from synchronized metadata and never follows later updates',()=>{
  const source={id:'a',name:'web',namespace:'prod',clusterId:'c',statusJson:{uid:'original'}};
  const targets=captureBatchTargets([source]);
  source.statusJson.uid='replacement';
  assert.equal(targets[0].uid,'original');
});
test('target snapshots include cluster identity for same-name resources across clusters',()=>{
  const targets=captureBatchTargets([{id:'a',name:'web',namespace:'prod',clusterId:'cluster-a'},{id:'b',name:'web',namespace:'prod',clusterId:'cluster-b'}]);
  assert.deepEqual(targets.map(target=>target.clusterId),['cluster-a','cluster-b']);
});

test('a confirmation cannot silently omit selected resources whose records have not loaded',()=>{
  const rows=[{id:'a',name:'web',namespace:'prod',clusterId:'c'}];
  assert.equal(captureSelectedBatchTargets(['a','b'],rows),null);
});

test('a confirmation uses exactly the selected IDs in their confirmed order',()=>{
  const rows=[{id:'a',name:'web',namespace:'prod',clusterId:'c'},{id:'b',name:'worker',namespace:'prod',clusterId:'c'}];
  assert.deepEqual(captureSelectedBatchTargets(['b'],rows)?.map(target=>target.id),['b']);
  assert.equal(captureSelectedBatchTargets(['a'],[{...rows[0],namespace:''}]),null);
  assert.equal(captureSelectedBatchTargets([],rows),null);
});
