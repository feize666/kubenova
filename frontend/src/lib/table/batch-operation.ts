export interface BatchOperationResult<T> {
  target:T;
  status:'succeeded'|'failed';
  error?:string;
}
export function summarizeBatchResults<T>(results:readonly BatchOperationResult<T>[]) {
  const succeeded=results.filter(result=>result.status==='succeeded').length;
  return {succeeded,failed:results.length-succeeded,total:results.length};
}

export function guardBatchContext<T, C>(expected:C,current:()=>C|null,execute:(target:T)=>Promise<unknown>) {
  return async (target:T)=>{
    const active=current();
    if(active===null || !Object.is(expected,active)) throw new Error('批量操作上下文已变化，请重新确认目标');
    return execute(target);
  };
}

/** Sequential writes against the confirmed target list; failures never mask successes. */
export async function runBatchOperation<T>(targets:readonly T[], execute:(target:T)=>Promise<unknown>, onProgress?:(progress:{completed:number;total:number;result:BatchOperationResult<T>})=>void):Promise<BatchOperationResult<T>[]> {
  const snapshot=[...targets];
  const results:BatchOperationResult<T>[]=[];
  for(const target of snapshot) {
    let result:BatchOperationResult<T>;
    try { await execute(target); result={target,status:'succeeded'}; }
    catch(error) { result={target,status:'failed',error:error instanceof Error?error.message:'操作失败，请查看服务端错误记录'}; }
    results.push(result);
    try { onProgress?.({completed:results.length,total:snapshot.length,result}); }
    catch { /* UI observer failures must not alter the confirmed operation or its results. */ }
  }
  return results;
}
