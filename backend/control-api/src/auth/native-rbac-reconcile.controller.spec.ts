jest.mock('@kubernetes/client-node',()=>({}));
import { NativeRbacReconcileController } from './native-rbac-reconcile.controller';

describe('native RBAC reconciliation controller',()=>{
  it('forwards only the authenticated console actor and route cluster',async()=>{
    const reconcile=jest.fn().mockResolvedValue({clusterId:'c',state:'ready'});
    const controller=new NativeRbacReconcileController({reconcile} as any);
    await expect(controller.reconcile({user:{user:{id:'admin',role:'platform-admin'}}} as any,'c')).resolves.toEqual({clusterId:'c',state:'ready'});
    expect(reconcile).toHaveBeenCalledWith({id:'admin',role:'platform-admin'},'c');
  });
});
