import type { TablePreferences } from '../api/table-preferences';
type StorageAccess = () => Pick<Storage,'getItem'|'setItem'> | undefined;
const browserStorage:StorageAccess = () => typeof window === 'undefined' ? undefined : window.localStorage;
export function userTablePreferencesKey(username:string,tableKey:string):string {
  return `user:${JSON.stringify([username,tableKey])}`;
}
export function readTablePreferences(key:string,storage:StorageAccess=browserStorage):TablePreferences|null {
  try {
    const raw=storage()?.getItem(`resource-table-preferences:${key}`);
    if(!raw)return null;
    const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const data=value as Record<string,unknown>;
    if(data.columnVisibility!==undefined&&(!data.columnVisibility||typeof data.columnVisibility!=='object'||Array.isArray(data.columnVisibility)||Object.values(data.columnVisibility).some(item=>typeof item!=='boolean')))return null;
    if(data.filterRowVisible!==undefined&&typeof data.filterRowVisible!=='boolean')return null;
    return data as TablePreferences;
  }catch{return null;}
}
export function writeTablePreferences(key:string,value:TablePreferences,storage:StorageAccess=browserStorage):void {
  try {storage()?.setItem(`resource-table-preferences:${key}`,JSON.stringify(value));}catch{/* Session preferences remain usable when storage is blocked/full. */}
}
