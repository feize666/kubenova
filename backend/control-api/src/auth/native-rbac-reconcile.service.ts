import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClustersService } from '../clusters/clusters.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { assertAdministrationPermission } from '../common/governance';
import { validatedEndpoint } from './oidc-flow.service';
import { planNativeRbac } from './native-rbac';
import { reconcileNativeRbacPair, revokeOwnedNativeRbacPair } from './native-rbac-sync';

type Actor={id?:string;role?:string}|undefined;

@Injectable()
export class NativeRbacReconcileService {
  constructor(private readonly db:PrismaService,private readonly clusters:ClustersService,
    private readonly authorization:AuthorizationService,private readonly identities:NamespaceIdentityService) {}

  async reconcile(actor:Actor,clusterId:string) {
    assertAdministrationPermission(actor);
    if(!actor?.id || !clusterId?.trim()) throw new ForbiddenException('Administrator identity required');
    const administrator=await this.db.user.findUnique({where:{id:actor.id},select:{isActive:true,role:true}});
    if(!administrator?.isActive) throw new ForbiddenException('Administrator unavailable');
    assertAdministrationPermission(administrator);
    const config=await this.config(clusterId);
    await this.writeStatus(clusterId,config.revision,{syncState:'syncing',syncRevision:null,syncMessage:null,syncedAt:null});
    try {
      const yaml=await this.clusters.getKubeconfig(clusterId);
      if(!yaml) throw new ServiceUnavailableException('Native cluster credential unavailable');
      // This client package is loaded lazily so the console can start without native access enabled.
      const k8s=require('@kubernetes/client-node') as typeof import('@kubernetes/client-node');
      const kubeconfig=new k8s.KubeConfig();kubeconfig.loadFromString(yaml);
      const cluster=kubeconfig.getCurrentCluster();
      if(!cluster || cluster.skipTLSVerify || validatedEndpoint(cluster.server).protocol!=='https:') throw new ServiceUnavailableException('Native access requires verified TLS');
      const rbac=kubeconfig.makeApiClient(k8s.RbacAuthorizationV1Api);
      const core=kubeconfig.makeApiClient(k8s.CoreV1Api);
      const users=await this.db.user.findMany({where:{isActive:true,OR:[
        {accessGrants:{some:{clusterId}}},
        {groupMemberships:{some:{state:'active',group:{accessGrants:{some:{clusterId}}}}}},
      ]},select:{id:true,authzVersion:true},take:5001,orderBy:{id:'asc'}});
      if(users.length>5000) throw new ServiceUnavailableException('Native reconciliation user limit exceeded');
      const desired=new Map<string,ReturnType<typeof planNativeRbac>[number]>();
      const now=new Date();
      for(const user of users) {
        const grants=(await this.authorization.listEffectiveGrants(user.id,now,clusterId))
          .filter(grant=>grant.capabilities.some(item=>item.capability==='kubeconfig'));
        const namespaces=[] as Array<{name:string;uid:string}>;
        for(const scope of new Map(grants.flatMap(grant=>grant.namespaces).map(scope=>[scope.namespaceName,scope])).values()) {
          if(!scope.namespaceName) continue;
          const uid=await this.identities.resolve(clusterId,scope.namespaceName);
          if(uid!==scope.namespaceUid) throw new ForbiddenException('Native namespace identity changed');
          namespaces.push({name:scope.namespaceName,uid});
        }
        for(const plan of planNativeRbac({userId:user.id,clusterId,grants,namespaces,now})) {
          desired.set(plan.role.metadata.name,plan);
          await reconcileNativeRbacPair(rbac,core,plan,false,()=>this.assertCurrent(clusterId,config.revision,user.id,user.authzVersion));
        }
      }
      // Delete only labelled KubeNova bindings not in the current desired set.
      const namespaceList=await core.listNamespace();
      for(const namespace of namespaceList.items??[]) {
        const name=namespace.metadata?.name;
        if(!name) continue;
        const bindings=await rbac.listNamespacedRoleBinding({namespace:name,labelSelector:'app.kubernetes.io/managed-by=kubenova'});
        for(const binding of bindings.items??[]) {
          const metadata=binding.metadata;
          if(!metadata?.name || metadata.annotations?.['kubenova.io/cluster-id']!==clusterId || desired.has(metadata.name)) continue;
          await revokeOwnedNativeRbacPair(rbac,core,{name:metadata.name,namespace:name,annotations:metadata.annotations},
            ()=>this.assertConfig(clusterId,config.revision));
        }
      }
      await this.writeStatus(clusterId,config.revision,{syncState:'ready',syncRevision:config.revision,syncMessage:null,syncedAt:new Date()});
      return {clusterId,state:'ready',applied:desired.size,revision:config.revision};
    } catch(error) {
      await this.writeStatus(clusterId,config.revision,{syncState:'error',syncRevision:null,syncMessage:'Native RBAC reconciliation failed',syncedAt:new Date()});
      throw error;
    }
  }

  private async config(clusterId:string) {
    const config=await this.db.nativeAccessConfig.findUnique({where:{clusterId},include:{cluster:{select:{deletedAt:true,status:true}}}});
    if(!config?.enabled || config.cluster.deletedAt || config.cluster.status==='deleted') throw new NotFoundException('Native access unavailable');
    return config;
  }
  private async assertConfig(clusterId:string,revision:number) {
    const current=await this.config(clusterId);
    if(current.revision!==revision) throw new ForbiddenException('Native configuration changed');
  }
  private async assertCurrent(clusterId:string,revision:number,userId:string,authzVersion:number) {
    await this.assertConfig(clusterId,revision);
    const user=await this.db.user.findUnique({where:{id:userId},select:{isActive:true,authzVersion:true}});
    if(!user?.isActive || user.authzVersion!==authzVersion) throw new ForbiddenException('Native authorization changed');
  }
  private async writeStatus(clusterId:string,revision:number,data:Record<string,unknown>) {
    const updated=await this.db.nativeAccessConfig.updateMany({where:{clusterId,revision},data});
    if(updated.count!==1) throw new ForbiddenException('Native configuration changed');
  }
}
