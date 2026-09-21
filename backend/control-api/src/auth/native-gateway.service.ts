import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClustersService } from '../clusters/clusters.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { RuntimeInvalidationService } from '../runtime/runtime-invalidation.service';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { createNativeAuthenticator } from './native-bearer';
import { openNativeRead } from './native-read';
import { classifyNativeRequest } from './native-request';
import { planNativeRbac } from './native-rbac';
import { assertNativeRbacReady } from './native-rbac-sync';
import { validatedEndpoint } from './oidc-flow.service';
import { isNativeDiscoveryTarget, nativeDiscovery } from './native-discovery';

@Injectable()
export class NativeGatewayService {
  private readonly authenticators=new Map<string,{revision:number;value:ReturnType<typeof createNativeAuthenticator>}>();
  constructor(private readonly db:PrismaService,private readonly clusters:ClustersService,
    private readonly authorization:AuthorizationService,private readonly identities:NamespaceIdentityService,
    private readonly externalIdentities:OidcIdentityRepository,private readonly invalidation:RuntimeInvalidationService) {}

  private async settings(clusterId:string) {
    const value=await this.db.nativeAccessConfig.findUnique({where:{clusterId},include:{cluster:{select:{deletedAt:true,status:true}}}});
    if(!value?.enabled || value.cluster.deletedAt || value.cluster.status==='deleted') {
      this.authenticators.delete(clusterId);throw new NotFoundException('Native access unavailable');
    }
    return value;
  }

  private authenticator(clusterId:string,settings:{revision:number;issuer:string;audience:string;jwksUri:string}) {
    let cached=this.authenticators.get(clusterId);
    if(!cached || cached.revision!==settings.revision) {
      const value=createNativeAuthenticator({issuer:settings.issuer,audience:settings.audience,jwksUri:settings.jwksUri},this.externalIdentities);
      cached={revision:settings.revision,value};this.authenticators.set(clusterId,cached);
      value.catch(()=>{if(this.authenticators.get(clusterId)?.value===value)this.authenticators.delete(clusterId);});
    }
    return cached.value;
  }

  async open(input:{clusterId:string;token:string;target:string;signal:AbortSignal}) {
    const resource=classifyNativeRequest('GET',input.target);
    if(resource.subresource==='exec') throw new ForbiddenException('Native exec transport unavailable');
    const settings=await this.settings(input.clusterId);
    const authenticate=await this.authenticator(input.clusterId,settings);
    await authenticate(input.token);
    const yaml=await this.clusters.getKubeconfig(input.clusterId);
    if(!yaml) throw new ServiceUnavailableException('Native cluster credential unavailable');
    const k8s=await import('@kubernetes/client-node');
    const config=new k8s.KubeConfig();config.loadFromString(yaml);
    const cluster=config.getCurrentCluster();
    if(!cluster || cluster.skipTLSVerify) throw new ServiceUnavailableException('Native access requires verified TLS');
    const endpoint=validatedEndpoint(cluster.server);
    if(endpoint.protocol!=='https:' || endpoint.search) throw new ServiceUnavailableException('Native access requires verified TLS');
    return openNativeRead({...input,config},{authenticate,authorization:this.authorization,identities:this.identities,
      invalidation:await this.invalidation.get(),assertReady:async decision=>{
        const current=await this.settings(input.clusterId);
        if(current.revision!==settings.revision) throw new ForbiddenException('Native configuration changed');
        const grants=await this.authorization.listEffectiveGrants(decision.userId,new Date(),input.clusterId);
        const [plan]=planNativeRbac({userId:decision.userId,clusterId:input.clusterId,grants,namespaces:[{name:decision.namespace,uid:decision.namespaceUid}]});
        if(!plan) throw new ForbiddenException('Native grant unavailable');
        await assertNativeRbacReady(config.makeApiClient(k8s.RbacAuthorizationV1Api),config.makeApiClient(k8s.CoreV1Api),plan);
      }});
  }

  async discover(input:{clusterId:string;token:string;target:string;signal:AbortSignal}) {
    if(!isNativeDiscoveryTarget(input.target)) throw new NotFoundException();
    const settings=await this.settings(input.clusterId);
    const authenticate=await this.authenticator(input.clusterId,settings);
    const actor=await authenticate(input.token);
    const grants=(await this.authorization.listEffectiveGrants(actor.userId,new Date(),input.clusterId))
      .filter(grant=>grant.capabilities.some(item=>item.capability==='kubeconfig'));
    if(!grants.length) throw new ForbiddenException();
    const yaml=await this.clusters.getKubeconfig(input.clusterId);
    if(!yaml)throw new ServiceUnavailableException();
    const k8s=await import('@kubernetes/client-node');
    const config=new k8s.KubeConfig();config.loadFromString(yaml);
    const cluster=config.getCurrentCluster();
    if(!cluster || cluster.skipTLSVerify || validatedEndpoint(cluster.server).protocol!=='https:')throw new ServiceUnavailableException();
    await this.invalidation.get();
    const capabilities=new Set<string>();
    const checked=new Set<string>();
    let permitted=false;
    // Discovery exposes metadata only, but still requires live namespace and owned RBAC.
    for(const grant of grants) {
      for(const namespace of grant.namespaces) {
        if(!namespace.namespaceName) continue;
        const uid=await this.identities.resolve(input.clusterId,namespace.namespaceName);
        if(uid!==namespace.namespaceUid) continue;
        if(!checked.has(uid)) {
          const [plan]=planNativeRbac({userId:actor.userId,clusterId:input.clusterId,grants,namespaces:[{name:namespace.namespaceName,uid}]});
          if(!plan)continue;
          await assertNativeRbacReady(config.makeApiClient(k8s.RbacAuthorizationV1Api),config.makeApiClient(k8s.CoreV1Api),plan);
          checked.add(uid);
        }
        permitted=true;
        for(const item of grant.capabilities)capabilities.add(item.capability);
      }
    }
    if(!permitted)throw new ForbiddenException();
    input.signal.throwIfAborted();
    const rows=await this.db.apiResourceCapability.findMany({where:{clusterId:input.clusterId,namespaced:true}});
    if((await this.settings(input.clusterId)).revision!==settings.revision || (await authenticate(input.token)).authzVersion!==actor.authzVersion)throw new ForbiddenException();
    return nativeDiscovery(input.target,rows,[...capabilities]);
  }
}
