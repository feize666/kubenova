import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMobileSelection, reconcileSelection, initialSelectionKeys } from './mobile-selection';

test('checkbox selection preserves off-page keys and removes only the requested key',()=>{
  assert.deepEqual(nextMobileSelection(['off-page','a'],'b',true,'checkbox'),['off-page','a','b']);
  assert.deepEqual(nextMobileSelection(['off-page','a'],'a',false,'checkbox'),['off-page']);
  assert.deepEqual(nextMobileSelection(['a'],'a',true,'checkbox'),['a']);
});
test('radio selection replaces the previous key',()=>{
  assert.deepEqual(nextMobileSelection(['old'],'new',true,'radio'),['new']);
});
test('disabled resources do not change the selection',()=>{
  assert.deepEqual(nextMobileSelection(['a'],'b',true,'checkbox',true),['a']);
  assert.deepEqual(nextMobileSelection(['a'],'b',true,'radio',true),['a']);
});
test('controlled empty selection overrides defaults and radio defaults select only one resource',()=>{
  assert.deepEqual(initialSelectionKeys([],['a'],'checkbox'),[]);
  assert.deepEqual(initialSelectionKeys(undefined,['a','a','b'],'radio'),['a']);
  assert.deepEqual(initialSelectionKeys(undefined,['a','a','b'],'checkbox'),['a','b']);
});
test('preserved selections retain off-page records and refresh visible records',()=>{
  const previous = new Map([['a',{id:'a',name:'old'}]]);
  const result = reconcileSelection(['a','b'], [{id:'b',name:'new'}], row=>row.id, previous, true);
  assert.deepEqual(result.keys,['a','b']);
  assert.deepEqual(result.rows,[{id:'a',name:'old'},{id:'b',name:'new'}]);
  const refreshed = reconcileSelection(['a'],[{id:'a',name:'updated'}],row=>row.id,result.cache,true);
  assert.equal(refreshed.rows[0].name,'updated');
});
test('non-preserved selections drop missing records and never return mismatched keys',()=>{
  const previous = new Map([['a',{id:'a'}]]);
  const result = reconcileSelection(['a','b','missing'],[{id:'b'}],row=>row.id,previous,false);
  assert.deepEqual(result.keys,['b']);
  assert.deepEqual(result.rows,[{id:'b'}]);
});
