'use client';

import { useState, type Key } from 'react';
import type { TableProps } from 'antd';
import { initialSelectionKeys, nextMobileSelection, reconcileSelection } from '@/lib/table/mobile-selection';

type Selection<T extends object> = NonNullable<TableProps<T>['rowSelection']>;

function sameRecords<KeyType, RecordType>(left: Map<KeyType, RecordType>, right: Map<KeyType, RecordType>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, record] of left) {
    if (right.get(key) !== record) return false;
  }
  return true;
}

/** One owner for desktop and mobile selection; caches never cross table scopes. */
export function useResourceSelection<T extends object>(input:{dataSource?:readonly T[]; keyOf:(row:T)=>Key; rowSelection?:Selection<T>; scopeKey:string}) {
  const {dataSource=[],keyOf,rowSelection,scopeKey}=input;
  const [local,setLocal]=useState(()=>({scopeKey,keys:initialSelectionKeys(undefined,rowSelection?.defaultSelectedRowKeys,rowSelection?.type??'checkbox')}));
  if(local.scopeKey!==scopeKey) setLocal({scopeKey,keys:[]});
  const [cache,setCache]=useState<{scopeKey:string; records:Map<Key,T>}>(()=>({scopeKey,records:new Map()}));
  const previous=cache.scopeKey===scopeKey ? cache.records : new Map<Key,T>();
  const keys=initialSelectionKeys(rowSelection?.selectedRowKeys,local.scopeKey===scopeKey?local.keys:[],rowSelection?.type??'checkbox');
  const snapshot=reconcileSelection(keys,dataSource,keyOf,previous,Boolean(rowSelection?.preserveSelectedRowKeys));
  if(cache.scopeKey!==scopeKey||!sameRecords(cache.records,snapshot.cache)) setCache({scopeKey,records:snapshot.cache});
  if(rowSelection?.selectedRowKeys===undefined&&local.scopeKey===scopeKey&&
    (local.keys.length!==snapshot.keys.length||local.keys.some((key,index)=>key!==snapshot.keys[index]))) {
    setLocal({scopeKey,keys:snapshot.keys});
  }
  function change(nextKeys:Key[], _rows:T[], info:Parameters<NonNullable<Selection<T>['onChange']>>[2]) {
    const next=reconcileSelection(nextKeys,dataSource,keyOf,snapshot.cache,Boolean(rowSelection?.preserveSelectedRowKeys));
    setCache({scopeKey,records:next.cache});
    if(rowSelection?.selectedRowKeys===undefined) setLocal({scopeKey,keys:next.keys});
    rowSelection?.onChange?.(next.keys,next.rows,info);
  }

  return {
    selectedRows:snapshot.rows,
    rowSelection:rowSelection ? {...rowSelection,selectedRowKeys:snapshot.keys,onChange:change} : undefined,
    selectRow(record:T,checked:boolean,event:Parameters<NonNullable<ReturnType<NonNullable<Selection<T>['getCheckboxProps']>>['onChange']>>[0]) {
      const props=rowSelection?.getCheckboxProps?.(record);
      if(!rowSelection||props?.disabled) return;
      const nextKeys=nextMobileSelection(snapshot.keys,keyOf(record),checked,rowSelection.type??'checkbox');
      const next=reconcileSelection(nextKeys,dataSource,keyOf,snapshot.cache,Boolean(rowSelection.preserveSelectedRowKeys));
      rowSelection.onSelect?.(record,checked,next.rows,event.nativeEvent);
      change(next.keys,next.rows,{type:'single'});
      props?.onChange?.(event);
    },
  };
}
