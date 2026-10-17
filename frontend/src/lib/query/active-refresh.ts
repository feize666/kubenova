import type { QueryClient } from '@tanstack/react-query';

export function createActiveRefresh(client:QueryClient,onPending:(pending:boolean)=>void,onFailure:()=>void):()=>Promise<boolean>{
  let inFlight:Promise<boolean>|null=null;
  return ()=>{
    if(inFlight)return inFlight;
    const targets=client.getQueryCache().findAll({type:'active'}).filter(query=>!query.isDisabled()&&!query.isStatic());
    onPending(true);
    inFlight=client.refetchQueries({type:'active'},{throwOnError:false,cancelRefetch:false})
      .then(()=>{
        const failed=targets.some(query=>query.state.status==='error');
        if(failed)onFailure();
        return !failed;
      },()=>{onFailure();return false;})
      .finally(()=>{inFlight=null;onPending(false);});
    return inFlight;
  };
}
