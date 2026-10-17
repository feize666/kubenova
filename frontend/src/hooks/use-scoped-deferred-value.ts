'use client';
import { useDeferredValue, useMemo } from 'react';

export function useScopedDeferredValue<T>(value:T,scope:string):T {
  const snapshot=useMemo(()=>({value,scope}),[value,scope]);
  const deferred=useDeferredValue(snapshot);
  return deferred.scope===scope?deferred.value:value;
}
