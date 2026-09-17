import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';
import { NotificationWorker } from './notification-worker';

@Injectable()
export class NotificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;
  private stopping = false;
  private cursor = '';

  constructor(private readonly prisma: PrismaService, private readonly worker: NotificationWorker) {}

  onModuleInit(): void {
    if (process.env.NOTIFICATION_DELIVERY_ENABLED !== 'true' || this.timer || this.stopping) return;
    this.timer = setInterval(() => {
      if (this.stopping || this.activeCycle) return;
      this.activeCycle = this.runCycle().finally(() => { this.activeCycle = null; });
    }, 5000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeCycle;
  }

  private async runCycle(): Promise<void> {
    try {
      // Rotate across cluster IDs so a permanently busy cluster cannot starve later IDs.
      const targets = await this.prisma.$queryRaw<{ clusterId: string }[]>`
        SELECT due."clusterId" FROM (
          SELECT DISTINCT a."clusterId"
          FROM "NotificationDelivery" d
          JOIN "MonitoringAlert" a ON a."id" = d."alertId"
          WHERE a."clusterId" IS NOT NULL AND
            ((d."status" = 'pending' AND d."nextAttemptAt" <= NOW()) OR
             (d."status" = 'sending' AND d."leaseUntil" <= NOW()))
        ) due
        ORDER BY CASE WHEN due."clusterId" > ${this.cursor} THEN 0 ELSE 1 END, due."clusterId"
        LIMIT 20`;
      for (const { clusterId } of targets) {
        if (this.stopping) break;
        this.cursor = clusterId;
        try {
          await this.worker.runOnce(clusterId);
        } catch {
          this.logger.warn('Notification delivery dispatch failed; retrying on a later cycle');
        }
      }
    } catch {
      this.logger.warn('Notification delivery selection failed; retrying on a later cycle');
    }
  }
}
