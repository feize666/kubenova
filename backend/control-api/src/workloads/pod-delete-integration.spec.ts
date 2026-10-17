jest.mock('@kubernetes/client-node',()=>({BatchV1Api:class {}}));
import { WorkloadsService } from './workloads.service';

describe('Pod deletion service adapter',()=>{
  function harness(uid?:string) {
    const requests:unknown[]=[];
    const core={deleteNamespacedPod:async(request:unknown)=>{requests.push(request);}};
    const service=Object.create(WorkloadsService.prototype) as WorkloadsService;
    Object.assign(service,{repository:{getClusterKubeconfig:async()=> 'test-config'},k8sClientService:{getAppsApi:()=>({}),getCoreApi:()=>core,createClient:()=>({makeApiClient:()=>({})})}});
    const record={kind:'Pod',name:'web',namespace:'prod',clusterId:'test',statusJson:{uid}};
    return {requests,remove:(expectedUid?:string)=>(service as any).deleteWorkloadInCluster(record,expectedUid)};
  }
  it('does not send a deletion for missing synchronized identity',async()=>{
    const h=harness();await expect(h.remove()).rejects.toThrow('身份尚未同步');expect(h.requests).toEqual([]);
  });
  it('does not send a deletion after confirmed identity has been replaced',async()=>{
    const h=harness('replacement');await expect(h.remove('original')).rejects.toThrow('身份变化');expect(h.requests).toEqual([]);
  });
  it('preserves conflict status so clients can distinguish stale targets from bad requests',async()=>{
    const h=harness('replacement');
    try {await h.remove('original');throw new Error('expected rejection');}
    catch(error) {expect((error as {getStatus:()=>number}).getStatus()).toBe(409);}
  });
  it('sends the exact confirmed UID to Kubernetes without forcing termination',async()=>{
    const h=harness('original');await h.remove('original');
    expect(h.requests).toEqual([{name:'web',namespace:'prod',body:{preconditions:{uid:'original'},propagationPolicy:'Background'}}]);
  });
});
