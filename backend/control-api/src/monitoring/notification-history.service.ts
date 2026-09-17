import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';

@Injectable()
export class NotificationHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: ClusterAccessSubject | undefined, clusterId: string, query: { take?: string; cursor?: string; status?: string; event?: string } = {}) {
    const access = new ClusterAccessService(this.prisma);
    access.assertPlatformAdmin(actor);
    const scope = await access.assertCanRead(actor, clusterId);
    const take = query.take === undefined ? 20 : Number(query.take);
    if (!Number.isInteger(take) || take < 1 || take > 100 || (query.take !== undefined && !/^\d+$/.test(query.take))) throw new BadRequestException('take 必须为 1-100 的整数');
    if (query.status !== undefined && !['pending', 'sending', 'sent', 'failed', 'expired', 'cancelled'].includes(query.status)) throw new BadRequestException('无效的投递状态');
    if (query.event !== undefined && !['firing', 'resolved'].includes(query.event)) throw new BadRequestException('无效的通知事件');
    const where = { alert: { clusterId: scope.clusterId }, ...(query.status ? { status: query.status } : {}), ...(query.event ? { event: query.event } : {}) };
    let position: { id: string; createdAt: Date } | null = null;
    if (query.cursor !== undefined) {
      if (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 128) throw new BadRequestException('无效的分页游标');
      position = await this.prisma.notificationDelivery.findFirst({ where: { ...where, id: query.cursor }, select: { id: true, createdAt: true } });
      if (!position) throw new BadRequestException('无效的分页游标');
    }
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { ...where, ...(position ? { OR: [{ createdAt: { lt: position.createdAt } }, { createdAt: position.createdAt, id: { lt: position.id } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1,
      select: { id: true, alertId: true, templateId: true, event: true, status: true, attempts: true, createdAt: true, updatedAt: true, nextAttemptAt: true, expiresAt: true, lastError: true, alert: { select: { title: true } } },
    });
    const items = rows.slice(0, take).map(({ alert, lastError, ...row }) => ({ ...row, alertTitle: alert.title, error: lastError ? '通知未成功投递，请检查渠道配置或稍后重试' : null }));
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }
}
