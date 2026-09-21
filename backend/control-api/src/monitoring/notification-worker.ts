import { Injectable } from '@nestjs/common';
import type { NotificationDelivery } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';
import { ObservabilityService } from './observability.service';

@Injectable()
export class NotificationWorker {
  constructor(private readonly prisma: PrismaService, private readonly sender: ObservabilityService) {}

  async runOnce(clusterId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<NotificationDelivery[]>`
      WITH candidate AS (
        SELECT d."id" FROM "NotificationDelivery" d
        JOIN "MonitoringAlert" a ON a."id" = d."alertId"
        WHERE a."clusterId" = ${clusterId} AND
          ((d."status" = 'pending' AND d."nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')) OR
           (d."status" = 'sending' AND d."leaseUntil" <= (NOW() AT TIME ZONE 'UTC')))
        ORDER BY d."createdAt", d."id" FOR UPDATE OF d SKIP LOCKED LIMIT 1
      ) UPDATE "NotificationDelivery" d SET "status" = 'sending',
        "attempts" = "attempts" + 1, "leaseUntil" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '30 seconds', "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM candidate WHERE d."id" = candidate."id" RETURNING d.*`;
    const delivery = rows[0];
    if (!delivery) return false;
    const finish = async (status: string, lastError: string | null = null, nextAttemptAt = new Date()) => {
      await this.prisma.notificationDelivery.updateMany({
        where: { id: delivery.id, status: 'sending', attempts: delivery.attempts },
        data: { status, lastError, leaseUntil: null, nextAttemptAt },
      });
    };
    try {
      if (delivery.expiresAt <= new Date()) { await finish('expired'); return true; }
      if (delivery.attempts > 5) { await finish('failed', '投递次数已耗尽'); return true; }
      const [alert, template, cluster] = await Promise.all([
        this.prisma.monitoringAlert.findUnique({ where: { id: delivery.alertId } }),
        this.prisma.monitoringNotificationTemplate.findUnique({ where: { id: delivery.templateId } }),
        this.prisma.clusterRegistry.findFirst({ where: { id: clusterId, deletedAt: null, status: { not: 'deleted' } }, select: { id: true } }),
      ]);
      if (!cluster || !alert || !template?.enabled || template.clusterId !== clusterId) { await finish('cancelled'); return true; }
      if (delivery.event === 'firing' && alert.status === 'resolved' && delivery.attempts === 1) { await finish('cancelled'); return true; }
      if (delivery.event === 'resolved') {
        const firing = await this.prisma.notificationDelivery.findUnique({ where: { alertId_templateId_event: { alertId: delivery.alertId, templateId: delivery.templateId, event: 'firing' } } });
        if (!firing || ['cancelled', 'failed', 'expired'].includes(firing.status)) { await finish('cancelled'); return true; }
        if (firing.status !== 'sent') {
          await this.prisma.notificationDelivery.updateMany({ where: { id: delivery.id, status: 'sending', attempts: delivery.attempts }, data: { status: 'pending', attempts: { decrement: 1 }, leaseUntil: null, nextAttemptAt: new Date(Date.now() + 5000) } });
          return true;
        }
      }
      const result = await this.sender.sendNotification(template, { title: `${delivery.event === 'resolved' ? '已恢复' : '告警'}：${alert.title}`, message: alert.message });
      if (result.success) await finish('sent');
      else await finish(delivery.attempts >= 5 ? 'failed' : 'pending', '通知渠道未确认投递成功', new Date(Date.now() + Math.min(300000, 5000 * 2 ** (delivery.attempts - 1))));
    } catch {
      // The lease permits recovery if the database itself is unavailable here.
      await finish(delivery.attempts >= 5 ? 'failed' : 'pending', '通知投递失败', new Date(Date.now() + 30000));
    }
    return true;
  }
}
