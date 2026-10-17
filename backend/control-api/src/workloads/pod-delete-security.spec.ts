import { podDeleteOptions } from './pod-delete-security';
describe('Pod deletion identity protection',()=>{
  it('rejects a missing synchronized Kubernetes UID',()=>{
    expect(()=>podDeleteOptions('prod','web',undefined)).toThrow();
  });
  it('uses a UID precondition and normal Kubernetes termination grace period',()=>{
    expect(podDeleteOptions('prod','web','uid-original')).toEqual({name:'web',namespace:'prod',body:{preconditions:{uid:'uid-original'},propagationPolicy:'Background'}});
  });
  it('rejects a replacement Pod when the confirmed UID differs from synchronized identity',()=>{
    expect(()=>podDeleteOptions('prod','web','uid-new','uid-original')).toThrow();
  });
});
