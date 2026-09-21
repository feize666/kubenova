import { NativeSettingsService } from './native-settings.service';

describe('native settings',()=>{
  const input={enabled:false,issuer:'https://sso.example/realms/main',audience:'kubectl',jwksUri:'https://sso.example/realms/main/certs',gatewayUrl:'https://gateway.example/native',revision:0};
  function fixture(){
    const db:any={user:{findUnique:jest.fn(async()=>({id:'admin',role:'platform-admin',isActive:true}))},clusterRegistry:{findFirst:jest.fn(async()=>({id:'c'}))},
      nativeAccessConfig:{findUnique:jest.fn(async()=>null),create:jest.fn(async({data}:any)=>data),updateMany:jest.fn(async()=>({count:1}))},
      authorizationChange:{create:jest.fn(async()=>({}))}};
    db.$transaction=async(fn:any)=>fn(db);
    return {db,service:new NativeSettingsService(db)};
  }
  it('does not accept arbitrary identity endpoints or secrets',async()=>{
    const {service,db}=fixture();
    for(const change of [{issuer:'http://sso.example'}, {jwksUri:'https://other.example/certs'}, {gatewayUrl:'https://u:p@gateway.example'}, {clientSecret:'forbidden'}, {revision:-1}]) {
      await expect(service.save({id:'admin',role:'platform-admin'},'c',{...input,...change})).rejects.toThrow();
    }
    expect(db.nativeAccessConfig.create).not.toHaveBeenCalled();
  });
  it('persists config and invalidates existing authorization atomically without marking ready',async()=>{
    const {service,db}=fixture();
    const result=await service.save({id:'admin',role:'platform-admin'},'c',input);
    expect(result).toMatchObject({revision:1,enabled:false,clusterId:'c',updatedBy:'admin'});
    expect(result).not.toHaveProperty('ready');
    expect(result).toMatchObject({syncState:'pending',syncRevision:null,syncMessage:null,syncedAt:null});
    expect(db.authorizationChange.create.mock.calls[0][0].data).toMatchObject({actorUserId:'admin',affectedUserId:null,version:1});
  });
  it('rejects stale revisions and inactive or ordinary administrators',async()=>{
    const {service,db}=fixture();
    await expect(service.save({id:'u',role:'user'},'c',input)).rejects.toThrow();
    db.user.findUnique.mockResolvedValueOnce({role:'platform-admin',isActive:false});
    await expect(service.save({id:'admin',role:'platform-admin'},'c',input)).rejects.toThrow();
    db.nativeAccessConfig.findUnique.mockResolvedValue({revision:2});
    await expect(service.save({id:'admin',role:'platform-admin'},'c',{...input,revision:1})).rejects.toThrow();
    expect(db.nativeAccessConfig.updateMany).not.toHaveBeenCalled();
  });
});
