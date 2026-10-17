import test from 'node:test';
import assert from 'node:assert/strict';
import { guardBatchContext, runBatchOperation } from './batch-operation';

test('a changed session stops queued writes even when the username stays the same', async()=>{
  const confirmed={username:'operator',token:'first'};
  let current=confirmed;
  const requested:number[]=[];
  const execute=guardBatchContext(confirmed,()=>current,async(target:number)=>{
    requested.push(target);
    current={username:'operator',token:'second'};
  });
  const results=await runBatchOperation([1,2,3],execute);
  assert.deepEqual(requested,[1]);
  assert.deepEqual(results.map(result=>result.status),['succeeded','failed','failed']);
});

test('switching a filter away and back never revives an earlier confirmation',async()=>{
  const confirmed={scope:'prod'};
  let current=confirmed;
  let writes=0;
  const execute=guardBatchContext(confirmed,()=>current,async()=>{writes++;});
  current={scope:'dev'};
  current={scope:'prod'};
  await assert.rejects(execute(1),/上下文/);
  assert.equal(writes,0);
});

test('leaving a resource page prevents the next write',async()=>{
  const confirmed={scope:'prod'};
  let current:typeof confirmed|null=confirmed;
  let writes=0;
  const execute=guardBatchContext(confirmed,()=>current,async()=>{writes++;current=null;});
  await runBatchOperation([1,2],execute);
  assert.equal(writes,1);
});

test('unchanged confirmation executes the real target list',async()=>{
  const confirmed={scope:'prod'};
  const writes:number[]=[];
  const execute=guardBatchContext(confirmed,()=>confirmed,async(target:number)=>{writes.push(target);});
  const results=await runBatchOperation([1,2],execute);
  assert.deepEqual(writes,[1,2]);
  assert.ok(results.every(result=>result.status==='succeeded'));
});
