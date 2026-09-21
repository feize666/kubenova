import { NativeRbacReconcileService } from './native-rbac-reconcile.service';

jest.mock('@kubernetes/client-node',()=>({KubeConfig:class {loadFromString(){}getCurrentCluster(){return {server:'https://api.example'}}makeApiClient(){return {listNamespace:async()=>({items:[]}),listNamespacedRoleBinding:async()=>({items:[]})};}}}));
jest.mock('./native-rbac-sync',()=>({reconcileNativeRbacPair:jest.fn()}));

describe('native RBAC reconciliation',()=>{
  const current={clusterId:'c',enabled:true,revision:2,cluster:{deletedAt:null,status:'online'}};
  const grant={id:'g',userId:'u',clusterId:'c',role:'viewer',state:'active',validFrom:new Date(0),expiresAt:null,revokedAt:null,
    namespaces:[{namespaceName:'ai',namespaceUid:'uid'}],capabilities:[{capability:'kubeconfig'}]};
  const setup=()=>{
    const db:any={nativeAccessConfig:{findUnique:jest.fn().mockResolvedValue(current),updateMany:jest.fn().mockResolvedValue({count:1})},
      user:{findUnique:jest.fn().mockResolvedValue({id:'admin',role:'admin',isActive:true}),findMany:jest.fn().mockResolvedValue([{id:'u',authzVersion:4}])}};
    const clusters:any={getKubeconfig:jest.fn().mockResolvedValue('apiVersion: v1')};
    const authorization:any={listEffectiveGrants:jest.fn().mockResolvedValue([grant])};
    const identities:any={resolve:jest.fn().mockResolvedValue('uid')};
    return {service:new NativeRbacReconcileService(db,clusters,authorization,identities),db,clusters,authorization,identities};
  };

  it('applies only live enabled kubeconfig grants and records a ready revision',async()=>{
    const {service,db,authorization,identities}=setup();
    await expect(service.reconcile({id:'admin',role:'admin'},'c')).resolves.toEqual({clusterId:'c',state:'ready',applied:1,revision:2});
    expect(authorization.listEffectiveGrants).toHaveBeenCalledWith('u',expect.any(Date),'c');
    expect(identities.resolve).toHaveBeenCalledWith('c','ai');
    expect(db.nativeAccessConfig.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({where:{clusterId:'c',revision:2},data:expect.objectContaining({syncState:'ready',syncRevision:2})}));
  });

  it('refuses disabled configuration before reading credentials or grants',async()=>{
    const {service,db,clusters,authorization}=setup();
    db.nativeAccessConfig.findUnique.mockResolvedValue({...current,enabled:false});
    await expect(service.reconcile({id:'admin',role:'admin'},'c')).rejects.toMatchObject({status:404});
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
    expect(authorization.listEffectiveGrants).not.toHaveBeenCalled();
  });

  it('marks sync failure and does not report readiness when a namespace UID changed',async()=>{
    const {service,db,identities}=setup();
    identities.resolve.mockResolvedValue('recreated');
    await expect(service.reconcile({id:'admin',role:'admin'},'c')).rejects.toThrow('namespace identity changed');
    expect(db.nativeAccessConfig.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({data:expect.objectContaining({syncState:'error',syncRevision:null})}));
  });
});
