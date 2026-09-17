import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';

@Injectable()
export class ReceiverStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actor: ClusterAccessSubject | undefined, clusterId: string) {
    const access = new ClusterAccessService(this.prisma);
    access.assertPlatformAdmin(actor);
    const scope = await access.assertCanRead(actor, clusterId);
    const row = await this.prisma.alertReceiverCredential.findUnique({ where: { clusterId: scope.clusterId }, select: { enabled: true, updatedAt: true } });
    return { clusterId: scope.clusterId, configured: Boolean(row), enabled: row?.enabled ?? false, updatedAt: row?.updatedAt ?? null };
  }
}
