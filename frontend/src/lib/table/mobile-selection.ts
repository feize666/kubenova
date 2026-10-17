import type { Key } from 'react';

export function initialSelectionKeys(controlled:readonly Key[]|undefined, defaults:readonly Key[]|undefined, type:'checkbox'|'radio'):Key[] {
  const keys=(controlled ?? defaults ?? []).filter((key,index,array)=>array.indexOf(key)===index);
  return type==='radio' ? keys.slice(0,1) : keys;
}

export function nextMobileSelection(keys: readonly Key[], key: Key, checked: boolean, type: 'checkbox'|'radio', disabled=false): Key[] {
  if(disabled) return [...keys];
  if(type==='radio') return checked ? [key] : [...keys];
  return checked ? (keys.includes(key) ? [...keys] : [...keys,key]) : keys.filter(item=>item!==key);
}

export function reconcileSelection<T>(keys: readonly Key[], visible: readonly T[], keyOf: (record:T)=>Key, previous: ReadonlyMap<Key,T>, preserve:boolean) {
  const cache = new Map<Key,T>();
  if(preserve) for(const key of keys) {
    const record=previous.get(key);
    if(record!==undefined) cache.set(key,record);
  }
  for(const record of visible) cache.set(keyOf(record),record);
  const nextKeys=preserve?[...keys]:keys.filter(key=>cache.has(key));
  return {keys:nextKeys, rows:nextKeys.filter(key=>cache.has(key)).map(key=>cache.get(key)!), cache};
}
