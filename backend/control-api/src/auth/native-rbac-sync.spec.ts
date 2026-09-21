import { reconcileNativeRbacPair, assertNativeRbacReady, revokeOwnedNativeRbacPair } from './native-rbac-sync';
import { planNativeRbac } from './native-rbac';

const plan = planNativeRbac({ userId:'u', clusterId:'c', namespaces:[{name:'ai',uid:'uid'}], grants:[{
  id:'g', userId:'u', groupId:null, clusterId:'c', role:'viewer', state:'active', validFrom:new Date(0), expiresAt:null, revokedAt:null,
  namespaces:[{namespaceName:'ai',namespaceUid:'uid'}], capabilities:[{capability:'kubeconfig'}],
}] })[0];

function fixture() {
  let role: any = {...structuredClone(plan.role),metadata:{...plan.role.metadata,uid:'role-uid',resourceVersion:'1'}};
  let binding: any = {...structuredClone(plan.binding),metadata:{...plan.binding.metadata,uid:'binding-uid',resourceVersion:'1'}};
  const operations: string[] = [];
  const absent = () => { throw {code:404}; };
  const api: any = {
    readNamespacedRole: async () => role ?? absent(),
    readNamespacedRoleBinding: async () => binding ?? absent(),
    deleteNamespacedRoleBinding: async ({body}: any) => { expect(body.preconditions).toEqual({uid:'binding-uid',resourceVersion:'1'}); operations.push('unbind'); binding=null; },
    deleteNamespacedRole: async ({body}: any) => { expect(body.preconditions.uid).toBe('role-uid'); operations.push('delete-role');role=null; },
    replaceNamespacedRole: async ({body}: any) => { expect(body.metadata.resourceVersion).toBe('1');operations.push('role');role=body; },
    createNamespacedRole: async ({body}: any) => { operations.push('role');role=body; },
    createNamespacedRoleBinding: async ({body}: any) => { operations.push('bind');binding=body; },
  };
  const core: any = {readNamespace:async () => ({metadata:{uid:'uid'}})};
  return {api,core,operations,get role(){return role;},get binding(){return binding;},clear:()=>{role=null;binding=null;}};
}

describe('native RBAC synchronization', () => {
  it('readiness accepts only live matching owned roles and bindings without applying anything', async () => {
    const ready=fixture(); await assertNativeRbacReady(ready.api,ready.core,plan);
    expect(ready.operations).toEqual([]);
    for (const mismatch of ['missing','rules','subject','namespace','owner']) {
      const f=fixture();
      if(mismatch==='missing') f.clear();
      if(mismatch==='rules') f.role.rules=[];
      if(mismatch==='subject') f.binding.subjects=[{kind:'User',name:'other',apiGroup:'rbac.authorization.k8s.io'}];
      if(mismatch==='namespace') f.core.readNamespace=async()=>({metadata:{uid:'different'}});
      if(mismatch==='owner') f.binding.metadata.labels={};
      await expect(assertNativeRbacReady(f.api,f.core,plan)).rejects.toThrow();
      expect(f.operations).toEqual([]);
    }
  });
  it('does nothing when the owned desired state already exists', async () => {
    const f=fixture(); await reconcileNativeRbacPair(f.api,f.core,plan,false,async()=>{});
    expect(f.operations).toEqual([]);
  });
  it('removes access before changing role rules', async () => {
    const f=fixture(); f.role.rules=[{apiGroups:[''],resources:['secrets'],verbs:['get']}];
    await reconcileNativeRbacPair(f.api,f.core,plan,false,async()=>{});
    expect(f.operations).toEqual(['unbind','role','bind']);
    expect(f.role.rules.flatMap((r:any)=>r.resources)).not.toContain('secrets');
  });
  it('revokes binding before deleting the role', async () => {
    const f=fixture(); await reconcileNativeRbacPair(f.api,f.core,plan,true,async()=>{});
    expect(f.operations).toEqual(['unbind','delete-role']); expect(f.binding).toBeNull();
  });
  it('revokes a stale owned pair using live Kubernetes metadata', async () => {
    const f=fixture();
    await revokeOwnedNativeRbacPair(f.api,f.core,{name:plan.role.metadata.name,namespace:'ai',annotations:plan.role.metadata.annotations},async()=>{});
    expect(f.operations).toEqual(['unbind','delete-role']);
  });
  it('refuses foreign ownership or a recreated namespace without mutations', async () => {
    for (const mismatch of ['owner','namespace']) {
      const f=fixture();
      if(mismatch==='owner') f.role.metadata.labels={'app.kubernetes.io/managed-by':'someone-else'};
      else f.core.readNamespace=async()=>({metadata:{uid:'new-uid'}});
      await expect(reconcileNativeRbacPair(f.api,f.core,plan,false,async()=>{})).rejects.toThrow();
      expect(f.operations).toEqual([]);
    }
  });
  it('leaves access removed if the role update fails', async () => {
    const f=fixture(); f.role.rules=[]; f.api.replaceNamespacedRole=async()=>{throw Error('conflict');};
    await expect(reconcileNativeRbacPair(f.api,f.core,plan,false,async()=>{})).rejects.toThrow('conflict');
    expect(f.binding).toBeNull(); expect(f.operations).toEqual(['unbind']);
  });
  it('does not bind if authorization changes during the apply', async () => {
    const f=fixture(); f.clear(); let checks=0;
    await expect(reconcileNativeRbacPair(f.api,f.core,plan,false,async()=>{if(++checks===2)throw Error('revoked');})).rejects.toThrow('revoked');
    expect(f.binding).toBeNull();
  });
});
