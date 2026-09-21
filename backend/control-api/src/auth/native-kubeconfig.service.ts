import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { AuthorizationService } from '../common/authorization.service';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { validatedEndpoint } from './oidc-flow.service';

type Actor={id?:string}|undefined;

@Injectable()
export class NativeKubeconfigService {
  constructor(private readonly db:PrismaService,private readonly authorization:AuthorizationService,
    private readonly identities:OidcIdentityRepository) {}

  async list(actor:Actor) {
    if(!actor?.id) throw new ForbiddenException('Identity required');
    const user=await this.db.user.findUnique({where:{id:actor.id},select:{isActive:true}});
    if(!user?.isActive) throw new ForbiddenException('User unavailable');
    const configs=await this.db.nativeAccessConfig.findMany({where:{enabled:true,syncState:'ready',cluster:{deletedAt:null,status:{not:'deleted'}}},
      select:{clusterId:true,revision:true,syncRevision:true,issuer:true,cluster:{select:{name:true}}},take:100,orderBy:{clusterId:'asc'}});
    const items=[] as Array<{id:string;name:string}>;
    for(const config of configs) {
      if(config.syncRevision!==config.revision) continue;
      const grants=await this.authorization.listEffectiveGrants(actor.id,new Date(),config.clusterId);
      if(!grants.some(grant=>grant.capabilities.some(item=>item.capability==='kubeconfig'))) continue;
      try { await this.identities.subjectForUser(config.issuer,actor.id);items.push({id:config.clusterId,name:config.cluster.name}); } catch {}
    }
    return {items};
  }

  async download(actor:Actor,clusterId:string) {
    if(!actor?.id || !clusterId?.trim()) throw new ForbiddenException('Identity required');
    const [user,config]=await Promise.all([
      this.db.user.findUnique({where:{id:actor.id},select:{isActive:true}}),
      this.db.nativeAccessConfig.findUnique({where:{clusterId},include:{cluster:{select:{deletedAt:true,status:true,name:true}}}}),
    ]);
    if(!user?.isActive) throw new ForbiddenException('User unavailable');
    if(!config?.enabled || config.cluster.deletedAt || config.cluster.status==='deleted') throw new NotFoundException('Native access unavailable');
    if(config.syncState!=='ready' || config.syncRevision!==config.revision) throw new ForbiddenException('Native access is not ready');
    const grants=await this.authorization.listEffectiveGrants(actor.id,new Date(),clusterId);
    if(!grants.some(grant=>grant.capabilities.some(item=>item.capability==='kubeconfig'))) throw new ForbiddenException('Native grant unavailable');
    // Require a current immutable provider binding without placing it in the file.
    await this.identities.subjectForUser(config.issuer,actor.id);
    let endpoint:URL;
    try {
      endpoint=validatedEndpoint(config.gatewayUrl);
      if(endpoint.protocol!=='https:' || endpoint.search || endpoint.hash) throw Error();
    } catch { throw new ForbiddenException('Native gateway configuration unavailable'); }
    endpoint.pathname=`${endpoint.pathname.replace(/\/$/,'')}/clusters/${encodeURIComponent(clusterId)}`;
    endpoint.search='';endpoint.hash='';
    const quote=(value:string)=>JSON.stringify(value);
    const clusterName=`kubenova-${clusterId}`;
    const contextName=`${config.cluster.name}-kubenova`;
    const content=[
      'apiVersion: v1','kind: Config',
      'clusters:',`- name: ${quote(clusterName)}`,'  cluster:',`    server: ${quote(endpoint.toString())}`,
      'users:', '- name: "kubenova-oidc"','  user:','    exec:','      apiVersion: client.authentication.k8s.io/v1','      interactiveMode: IfAvailable','      command: kubelogin','      args:',
      `      - ${quote('get-token')}`,`      - ${quote(`--oidc-issuer-url=${config.issuer}`)}`,`      - ${quote(`--oidc-client-id=${config.audience}`)}`,`      - ${quote('--oidc-extra-scope=profile')}`,
      'contexts:',`- name: ${quote(contextName)}`,'  context:',`    cluster: ${quote(clusterName)}`,'    user: "kubenova-oidc"',
      `current-context: ${quote(contextName)}`,'',
    ].join('\n');
    return {filename:`${config.cluster.name}-kubectl.kubeconfig`,contentType:'application/yaml; charset=utf-8',content};
  }
}
