import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../platform/database/prisma.service';
import { assertAdministrationPermission } from '../common/governance';
import { validatedEndpoint } from './oidc-flow.service';

const settings = z.object({
  enabled:z.boolean(), issuer:z.string().max(2048), audience:z.string().trim().min(1).max(200),
  jwksUri:z.string().max(2048), gatewayUrl:z.string().max(2048), revision:z.number().int().min(0).max(2147483646),
}).strict().superRefine((value,ctx)=>{
  try {
    const issuer=validatedEndpoint(value.issuer),jwks=validatedEndpoint(value.jwksUri),gateway=validatedEndpoint(value.gatewayUrl);
    if(issuer.search || jwks.search || gateway.search || issuer.origin!==jwks.origin || gateway.protocol!=='https:') throw Error();
  } catch {ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid native endpoints'});}
});
type Actor={id?:string;role?:string}|undefined;

@Injectable()
export class NativeSettingsService {
  constructor(private readonly db:PrismaService) {}

  async get(actor:Actor,clusterId:string) {
    assertAdministrationPermission(actor);
    if(!actor?.id) throw new ForbiddenException('Actor identity required');
    const user=await this.db.user.findUnique({where:{id:actor.id},select:{role:true,isActive:true}});
    if(!user?.isActive) throw new ForbiddenException('Actor unavailable');
    assertAdministrationPermission(user);
    const cluster=await this.db.clusterRegistry.findFirst({where:{id:clusterId,deletedAt:null,status:{not:'deleted'}},select:{id:true}});
    if(!cluster) throw new NotFoundException('Cluster unavailable');
    return await this.db.nativeAccessConfig.findUnique({where:{clusterId}}) ?? {clusterId,enabled:false,revision:0};
  }

  async save(actor:Actor,clusterId:string,body:unknown) {
    assertAdministrationPermission(actor);
    if(!actor?.id) throw new ForbiddenException('Actor identity required');
    if(!clusterId?.trim() || clusterId.length>256) throw new BadRequestException('Invalid cluster');
    const parsed=settings.safeParse(body);
    if(!parsed.success) throw new BadRequestException('Invalid native access settings');
    const {revision,...config}=parsed.data;
    try {
      return await this.db.$transaction(async tx=>{
        const user=await tx.user.findUnique({where:{id:actor.id},select:{role:true,isActive:true}});
        if(!user?.isActive) throw new ForbiddenException('Actor unavailable');
        assertAdministrationPermission(user);
        const cluster=await tx.clusterRegistry.findFirst({where:{id:clusterId,deletedAt:null,status:{not:'deleted'}},select:{id:true}});
        if(!cluster) throw new NotFoundException('Cluster unavailable');
        const current=await tx.nativeAccessConfig.findUnique({where:{clusterId}});
        if((current?.revision ?? 0)!==revision) throw new ConflictException('Native settings changed; reload before saving');
        const data={...config,updatedBy:actor.id!,revision:revision+1,
          syncState:'pending',syncRevision:null,syncMessage:null,syncedAt:null};
        let saved;
        if(!current) saved=await tx.nativeAccessConfig.create({data:{...data,clusterId}});
        else {
          const updated=await tx.nativeAccessConfig.updateMany({where:{clusterId,revision},data});
          if(updated.count!==1) throw new ConflictException('Native settings changed; reload before saving');
          saved=await tx.nativeAccessConfig.findUniqueOrThrow({where:{clusterId}});
        }
        await tx.authorizationChange.create({data:{actorUserId:actor.id!,affectedUserId:null,version:revision+1,reason:`native-config-updated:${clusterId}`}});
        return saved;
      });
    } catch(error) {
      if((error as {code?:string}).code==='P2002') throw new ConflictException('Native settings changed; reload before saving');
      throw error;
    }
  }
}
