export interface BatchDeleteTarget { id:string; name:string; namespace:string; clusterId:string; uid?:string;statusJson?:unknown; }
export function captureSelectedBatchTargets(keys:readonly unknown[],rows:readonly BatchDeleteTarget[]):BatchDeleteTarget[]|null {
  if(!keys.length||keys.some(key=>typeof key!=='string'||!key.trim()))return null;
  const ids=[...new Set(keys as readonly string[])];
  const targets=new Map(captureBatchTargets(rows).map(target=>[target.id,target]));
  if(ids.some(id=>!targets.has(id)))return null;
  return ids.map(id=>targets.get(id)!);
}
export function captureBatchTargets(rows:readonly BatchDeleteTarget[]):BatchDeleteTarget[] {
  const seen=new Set<string>();
  return rows.filter(row=>{
    if(![row.id,row.name,row.namespace,row.clusterId].every(value=>typeof value==='string'&&value.trim())||seen.has(row.id))return false;
    seen.add(row.id);return true;
  }).map(({id,name,namespace,clusterId,uid,statusJson})=>{
    const status=statusJson&&typeof statusJson==='object'?statusJson as Record<string,unknown>:{};
    const capturedUid=uid??status.uid;
    return Object.freeze({id,name,namespace,clusterId,...(typeof capturedUid==='string'&&capturedUid?{uid:capturedUid}:{})});
  });
}
