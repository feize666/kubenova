'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readTableDensity, writeTableDensity, type TableDensity } from '@/lib/table/density';

const listeners = new Set<() => void>();
const sessionValues = new Map<string, TableDensity>();

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    const prefix = 'resource-table-preferences:density:';
    if (event.key === null) sessionValues.clear();
    else if (event.key.startsWith(prefix)) sessionValues.delete(event.key.slice(prefix.length));
    else return;
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTableDensity(username: string, tableKey: string) {
  const scope = JSON.stringify([username, tableKey]);
  const getSnapshot = useCallback(() => {
    // A local choice remains usable even if the browser blocks persistence.
    return sessionValues.get(scope) ?? readTableDensity(username, tableKey);
  }, [scope, username, tableKey]);
  const density = useSyncExternalStore(subscribe, getSnapshot, () => 'standard' as TableDensity);
  const setDensity = useCallback((value: TableDensity) => {
    writeTableDensity(username, tableKey, value);
    sessionValues.set(scope, value);
    for (const listener of listeners) listener();
  }, [scope, username, tableKey]);
  return [density, setDensity] as const;
}
