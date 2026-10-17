export function isResourceAccessDenied(error:unknown):boolean {
  return !!error&&typeof error==='object'&&'status' in error&&(error.status===401||error.status===403);
}
export function visibleResourceQueryData<T>(query:{data:T|undefined;error:unknown}):T|undefined {
  return isResourceAccessDenied(query.error)?undefined:query.data;
}
