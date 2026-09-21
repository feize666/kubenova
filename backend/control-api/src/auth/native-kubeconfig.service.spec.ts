import { NativeKubeconfigService } from './native-kubeconfig.service';

describe('personal native kubeconfig',()=>{
  const config={clusterId:'c',enabled:true,revision:3,syncState:'ready',syncRevision:3,
    issuer:'https://sso.example/realms/kubenova',audience:'kubenova-kubectl',gatewayUrl:'https://gateway.example/api/native',
    cluster:{deletedAt:null,status:'online',name:'production'}};
  const grants=[{id:'g',clusterId:'c',capabilities:[{capability:'kubeconfig'}]}];
  const setup=()=>{
    const db:any={nativeAccessConfig:{findUnique:jest.fn().mockResolvedValue(config),findMany:jest.fn().mockResolvedValue([config])},user:{findUnique:jest.fn().mockResolvedValue({id:'u',isActive:true})}};
    const authorization:any={listEffectiveGrants:jest.fn().mockResolvedValue(grants)};
    const identities:any={subjectForUser:jest.fn().mockResolvedValue('immutable-subject')};
    return {service:new NativeKubeconfigService(db,authorization,identities),db,authorization,identities};
  };
  it('creates a no-secret kubelogin config only after the exact synced revision is ready',async()=>{
    const {service,authorization,identities}=setup();
    const result=await service.download({id:'u'},'c');
    expect(result.filename).toBe('production-kubectl.kubeconfig');
    expect(result.content).toContain('https://gateway.example/api/native/clusters/c');
    expect(result.content).toContain('--oidc-issuer-url=https://sso.example/realms/kubenova');
    expect(result.content).toContain('--oidc-client-id=kubenova-kubectl');
    expect(result.content).not.toMatch(/token:|client-secret|certificate-authority-data|immutable-subject/i);
    expect(authorization.listEffectiveGrants).toHaveBeenCalledWith('u',expect.any(Date),'c');
    expect(identities.subjectForUser).toHaveBeenCalledWith(config.issuer,'u');
  });
  it('lists only the caller native-ready clusters with a current bound identity and grant',async()=>{
    const {service,authorization,identities}=setup();
    await expect(service.list({id:'u'})).resolves.toEqual({items:[{id:'c',name:'production'}]});
    authorization.listEffectiveGrants.mockResolvedValueOnce([]);
    await expect(service.list({id:'u'})).resolves.toEqual({items:[]});
    identities.subjectForUser.mockRejectedValueOnce(Error('unbound'));
    await expect(service.list({id:'u'})).resolves.toEqual({items:[]});
  });
  it('denies stale sync, unbound identities, inactive accounts and grants without kubeconfig',async()=>{
    const {service,db,authorization,identities}=setup();
    for(const patch of [{syncState:'pending'},{syncRevision:2}]) {
      db.nativeAccessConfig.findUnique.mockResolvedValueOnce({...config,...patch});
      await expect(service.download({id:'u'},'c')).rejects.toThrow();
    }
    identities.subjectForUser.mockRejectedValueOnce(Error('unbound'));
    await expect(service.download({id:'u'},'c')).rejects.toThrow();
    db.user.findUnique.mockResolvedValueOnce({id:'u',isActive:false});
    await expect(service.download({id:'u'},'c')).rejects.toThrow();
    authorization.listEffectiveGrants.mockResolvedValueOnce([]);
    await expect(service.download({id:'u'},'c')).rejects.toThrow();
  });
  it('does not generate a personal config for a malformed or non-HTTPS gateway record',async()=>{
    const {service,db}=setup();
    for(const gatewayUrl of ['http://gateway.example/api/native','https://user:pass@gateway.example/api/native','https://gateway.example/api/native?token=x']) {
      db.nativeAccessConfig.findUnique.mockResolvedValueOnce({...config,gatewayUrl});
      await expect(service.download({id:'u'},'c')).rejects.toThrow();
    }
  });
});
