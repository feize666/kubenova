import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../platform/database/prisma.service';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';

@Injectable()
export class AlertReceiverService {
  constructor(private readonly prisma: PrismaService) {}

  async rotate(actor: ClusterAccessSubject | undefined, clusterId: string) {
    const access = new ClusterAccessService(this.prisma);
    access.assertPlatformAdmin(actor);
    const cluster = await access.assertCanRead(actor, clusterId);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.$transaction(async tx => {
      await tx.alertReceiverCredential.upsert({
      where: { clusterId: cluster.clusterId },
      create: { clusterId: cluster.clusterId, tokenHash, enabled: true },
      update: { tokenHash, enabled: true },
      });
      await tx.auditLog.create({ data: { actorUserId: actor?.id, clusterId: cluster.clusterId, action: 'rotate', resourceType: 'alert-receiver', resourceId: cluster.clusterId } });
    });
    return { clusterId: cluster.clusterId, token };
  }

  async disable(actor: ClusterAccessSubject | undefined, clusterId: string) {
    const access = new ClusterAccessService(this.prisma);
    access.assertPlatformAdmin(actor);
    const cluster = await access.assertCanRead(actor, clusterId);
    await this.prisma.$transaction(async tx => {
      await tx.alertReceiverCredential.updateMany({ where: { clusterId: cluster.clusterId }, data: { enabled: false } });
      await tx.auditLog.create({ data: { actorUserId: actor?.id, clusterId: cluster.clusterId, action: 'disable', resourceType: 'alert-receiver', resourceId: cluster.clusterId } });
    });
    return { clusterId: cluster.clusterId, enabled: false };
  }

  async authenticate(clusterId: string, authorization: string | undefined): Promise<string> {
    const token = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1] : undefined;
    if (!token || typeof clusterId !== 'string' || !clusterId || clusterId.length > 128) throw new UnauthorizedException('告警接收凭据无效');
    const credential = await this.prisma.alertReceiverCredential.findUnique({ where: { clusterId } });
    const digest = createHash('sha256').update(token).digest();
    const expected = Buffer.from(credential?.tokenHash ?? '', 'hex');
    if (!credential?.enabled || expected.length !== digest.length || !timingSafeEqual(expected, digest)) throw new UnauthorizedException('告警接收凭据无效');
    const cluster = await this.prisma.clusterRegistry.findFirst({ where: { id: clusterId, deletedAt: null, status: { not: 'deleted' } }, select: { id: true } });
    if (!cluster) throw new UnauthorizedException('告警接收凭据无效');
    return cluster.id;
  }
}
