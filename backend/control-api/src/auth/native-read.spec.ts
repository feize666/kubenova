import { PassThrough } from 'node:stream';
import { openNativeRead } from './native-read';
import * as transport from './native-transport';

describe('native authorized read lifecycle', () => {
  function fixture() {
    const controller=new AbortController();
    const disconnected=new AbortController();
    const actor={userId:'u',authzVersion:1,expiresAt:new Date(Date.now()+60000)};
    const grant={id:'g',clusterId:'c',namespaces:[{namespaceUid:'uid'}],capabilities:[{capability:'kubeconfig'}],expiresAt:null};
    const stream=new PassThrough();
    const forward=jest.spyOn(transport,'forwardNativeRead').mockResolvedValue(stream as any);
    const dependencies:any={
      authenticate:jest.fn(async()=>actor),
      authorization:{listEffectiveGrants:jest.fn(async()=>[grant])},
      identities:{resolve:jest.fn(async()=>'uid')},
      invalidation:{register:jest.fn(()=>({signal:controller.signal,close:()=>controller.abort()}))},
      assertReady:jest.fn(async()=>{}),
    };
    const run=()=>openNativeRead({token:'fixture',clusterId:'c',target:'/api/v1/namespaces/ai/pods',config:{} as any,signal:disconnected.signal},dependencies);
    return {controller,disconnected,actor,stream,forward,dependencies,run};
  }
  afterEach(()=>jest.restoreAllMocks());
  it('binds transport to the revocable lease and releases it on stream close',async()=>{
    const f=fixture(); const result=await f.run();
    expect(result).toBe(f.stream);
    expect(f.forward.mock.calls[0][2]).toMatch(/^kubenova:native:[a-f0-9]{40}$/);
    expect(f.forward.mock.calls[0][3].aborted).toBe(false);
    f.stream.destroy(); await new Promise(resolve=>setImmediate(resolve));
    expect(f.controller.signal.aborted).toBe(true);
    expect(f.forward.mock.calls[0][3].aborted).toBe(true);
  });
  it('denies account revision changes before opening upstream',async()=>{
    const f=fixture(); f.dependencies.authenticate.mockResolvedValueOnce(f.actor).mockResolvedValueOnce({...f.actor,authzVersion:2});
    await expect(f.run()).rejects.toThrow();
    expect(f.forward).not.toHaveBeenCalled(); expect(f.controller.signal.aborted).toBe(true);
  });
  it('denies revocation during the final live namespace check',async()=>{
    const f=fixture(); f.dependencies.identities.resolve.mockResolvedValueOnce('uid').mockImplementationOnce(async()=>{f.controller.abort();return 'uid';});
    await expect(f.run()).rejects.toThrow(); expect(f.forward).not.toHaveBeenCalled();
  });
  it('denies a disconnected client before opening upstream',async()=>{
    const f=fixture(); f.dependencies.identities.resolve.mockResolvedValueOnce('uid').mockImplementationOnce(async()=>{f.disconnected.abort();return 'uid';});
    await expect(f.run()).rejects.toThrow(); expect(f.forward).not.toHaveBeenCalled();
    expect(f.controller.signal.aborted).toBe(true);
  });
  it('never opens transport when readiness fails and releases failed transport leases',async()=>{
    const f=fixture(); f.dependencies.assertReady.mockRejectedValueOnce(Error('not ready'));
    await expect(f.run()).rejects.toThrow('not ready'); expect(f.forward).not.toHaveBeenCalled();
    f.forward.mockRejectedValueOnce(Error('upstream unavailable'));
    await expect(f.run()).rejects.toThrow(); expect(f.controller.signal.aborted).toBe(true);
  });
});
