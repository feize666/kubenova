import test from 'node:test';
import assert from 'node:assert/strict';
import { readTablePreferences, writeTablePreferences, userTablePreferencesKey } from './preferences-storage';

test('column preferences are isolated by user and table, without importing legacy shared settings',()=>{
  const values=new Map<string,string>();
  const storage=()=>({getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}});
  values.set('resource-table-preferences:pods',JSON.stringify({columnVisibility:{name:false}}));
  const alice=userTablePreferencesKey('alice','pods');
  const bob=userTablePreferencesKey('bob','pods');
  assert.equal(readTablePreferences(alice,storage),null);
  writeTablePreferences(alice,{columnVisibility:{namespace:false}},storage);
  assert.equal(readTablePreferences(bob,storage),null);
  assert.equal(readTablePreferences(userTablePreferencesKey('alice','nodes'),storage),null);
  assert.deepEqual(readTablePreferences(alice,storage),{columnVisibility:{namespace:false}});
  assert.notEqual(userTablePreferencesKey('a/b','c'),userTablePreferencesKey('a','b/c'));
});

test('blocked storage reads and writes do not break table rendering', () => {
  const unavailable = () => { throw new Error('SecurityError'); };
  assert.equal(readTablePreferences('pods', unavailable), null);
  assert.doesNotThrow(() => writeTablePreferences('pods', {columnVisibility:{name:true}}, unavailable));
});
test('valid preferences roundtrip; malformed values are not used as visibility maps', () => {
  const values = new Map<string,string>();
  const storage = () => ({getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}});
  writeTablePreferences('pods', {columnVisibility:{name:true,namespace:false},filterRowVisible:true}, storage);
  assert.deepEqual(readTablePreferences('pods', storage), {columnVisibility:{name:true,namespace:false},filterRowVisible:true});
  assert.equal(readTablePreferences('nodes', storage), null);
  for (const raw of ['{','null','[]','42','{"columnVisibility":{"name":"false"}}']) {
    values.set('resource-table-preferences:pods',raw);
    assert.equal(readTablePreferences('pods',storage),null);
  }
});
