import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatchOperation, summarizeBatchResults } from './batch-operation';

test('batch uses a fixed target snapshot, reports each failure, and continues remaining targets',async()=>{
  const targets=[{id:'a'},{id:'b'},{id:'c'}];
  const invoked:string[]=[];
  const result=await runBatchOperation(targets,async target=>{
    invoked.push(target.id);
    targets.pop();
    if(target.id==='b')throw new Error('permission denied');
  });
  assert.deepEqual(invoked,['a','b','c']);
  assert.deepEqual(result.map(item=>[item.target.id,item.status]),[['a','succeeded'],['b','failed'],['c','succeeded']]);
  assert.equal(result[1].error,'permission denied');
});
test('batch progress publishes settled counts and never overlaps destructive requests',async()=>{
  let running=0;let maximum=0;
  const counts:number[]=[];
  await runBatchOperation([1,2,3],async()=>{running++;maximum=Math.max(maximum,running);await Promise.resolve();running--;},progress=>counts.push(progress.completed));
  assert.equal(maximum,1);
  assert.deepEqual(counts,[1,2,3]);
});
test('a UI progress observer failure cannot discard settled results or stop remaining targets',async()=>{
  const invoked:string[]=[];
  const result=await runBatchOperation(['a','b'],async target=>{invoked.push(target);},()=>{throw new Error('unmounted view');});
  assert.deepEqual(invoked,['a','b']);
  assert.deepEqual(result.map(item=>item.status),['succeeded','succeeded']);
});
test('result summary counts partial failure without presenting the entire batch as successful',()=>{
  assert.deepEqual(summarizeBatchResults([{target:'a',status:'succeeded'},{target:'b',status:'failed',error:'denied'}]),{succeeded:1,failed:1,total:2});
});
