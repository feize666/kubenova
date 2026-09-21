import { NativeGatewayService } from './native-gateway.service';
import { createNativeAuthenticator } from './native-bearer';
jest.mock('./native-bearer',()=>({createNativeAuthenticator:jest.fn()}));
jest.mock('@kubernetes/client-node',()=>({}));

describe('native gateway admission',()=>{
  it('shares verifier across discovery requests but rechecks identities and refreshes changed settings',async()=>{
    const authenticate=jest.fn(async()=>({userId:'u',authzVersion:1,expiresAt:new Date(Date.now()+60000)}));
    const factory=jest.mocked(createNativeAuthenticator);factory.mockReset().mockResolvedValue(authenticate as any);
    const config={revision:1,enabled:true,issuer:'https://sso.example',audience:'native',jwksUri:'https://sso.example/keys',cluster:{deletedAt:null,status:'online'}};
    const db:any={nativeAccessConfig:{findUnique:async()=>config}};
    const service=new NativeGatewayService(db,{} as any,{listEffectiveGrants:async()=>[]} as any,{} as any,{} as any,{} as any);
    const input={clusterId:'c',token:'fixture',target:'/apis',signal:new AbortController().signal};
    for(let i=0;i<2;i++)await expect(service.discover(input)).rejects.toMatchObject({status:403});
    expect(factory).toHaveBeenCalledTimes(1);expect(authenticate).toHaveBeenCalledTimes(2);
    config.revision=2;
    await expect(service.discover(input)).rejects.toMatchObject({status:403});
    expect(factory).toHaveBeenCalledTimes(2);
    authenticate.mockRejectedValueOnce(Error('identity removed'));
    await expect(service.discover(input)).rejects.toThrow('identity removed');
    expect(factory).toHaveBeenCalledTimes(2);
  });
  it('denies unconfigured, disabled and deleted clusters before credentials are read',async()=>{
    const db:any={nativeAccessConfig:{findUnique:jest.fn()}};
    const clusters:any={getKubeconfig:jest.fn()};
    const service=new (NativeGatewayService as any)(db,clusters,{}, {}, {}, {});
    for(const row of [null,{enabled:false,cluster:{deletedAt:null,status:'online'}},{enabled:true,cluster:{deletedAt:new Date(),status:'online'}},{enabled:true,cluster:{deletedAt:null,status:'deleted'}}]) {
      db.nativeAccessConfig.findUnique.mockResolvedValue(row);
      await expect(service.open({clusterId:'c',token:'fixture',target:'/api/v1/namespaces/ai/pods',signal:new AbortController().signal})).rejects.toMatchObject({status:404});
    }
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
  });
});
