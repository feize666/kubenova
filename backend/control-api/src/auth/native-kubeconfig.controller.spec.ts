import { NativeKubeconfigController } from './native-kubeconfig.controller';

describe('personal native kubeconfig controller',()=>{
  it('returns a no-store attachment only from the authenticated actor',async()=>{
    const download=jest.fn().mockResolvedValue({filename:'cluster-kubectl.kubeconfig',contentType:'application/yaml; charset=utf-8',content:'apiVersion: v1'});
    const header=jest.fn();const send=jest.fn();const type=jest.fn(()=>({send}));
    const controller=new NativeKubeconfigController({download} as any);
    await controller.download({user:{user:{id:'u'}}} as any,{setHeader:header,type,send} as any,'c');
    expect(download).toHaveBeenCalledWith({id:'u'},'c');
    expect(header).toHaveBeenCalledWith('Cache-Control','no-store');
    expect(header).toHaveBeenCalledWith('Content-Disposition',expect.stringContaining('cluster-kubectl.kubeconfig'));
    expect(type).toHaveBeenCalledWith('application/yaml; charset=utf-8');expect(send).toHaveBeenCalledWith('apiVersion: v1');
  });
});
