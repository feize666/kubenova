import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../platform/database/prisma.service';
import { AlertReceiverService } from './alert-receiver.service';
import { parseAlertmanagerInput } from './alertmanager-input';

@Injectable()
export class AlertIngestionService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(clusterId: string, authorization: string | undefined, body: unknown) {
    await new AlertReceiverService(this.prisma).authenticate(clusterId, authorization);
    const events = parseAlertmanagerInput(body);
    return this.prisma.$transaction(async tx => {
      // Serialize each cluster receiver against concurrent batches and token rotation.
      await tx.$queryRaw`SELECT "clusterId" FROM "AlertReceiverCredential" WHERE "clusterId" = ${clusterId} FOR UPDATE`;
      await new AlertReceiverService(tx as PrismaService).authenticate(clusterId, authorization);
      let changed = 0;
      for (const event of events) {
        const occurrenceKey = createHash('sha256').update(JSON.stringify([clusterId, event.fingerprint, event.startsAt.toISOString()])).digest('hex');
        const existing = await tx.monitoringAlert.findUnique({ where: { occurrenceKey } });
        if (existing && (existing.status !== 'firing' || event.status === 'firing')) continue;
        const alert = existing
          ? await tx.monitoringAlert.update({ where: { id: existing.id }, data: { status: 'resolved', resolvedAt: event.endsAt } })
          : await tx.monitoringAlert.create({ data: {
            occurrenceKey, clusterId, namespace: event.namespace, title: event.title,
            message: event.message, severity: event.severity, source: 'prometheus',
            status: event.status, firedAt: event.startsAt, resolvedAt: event.endsAt,
            metadata: { labels: event.labels, annotations: event.annotations },
          } });
        changed++;
        if (!existing && event.status === 'resolved') continue;
        const channels = event.status === 'firing'
          ? (await tx.monitoringNotificationTemplate.findMany({ where: { clusterId, enabled: true }, select: { id: true } })).map(row => row.id)
          : (await tx.notificationDelivery.findMany({ where: { alertId: alert.id, event: 'firing' }, select: { templateId: true } })).map(row => row.templateId);
        if (channels.length) await tx.notificationDelivery.createMany({ data: channels.map(templateId => ({
          alertId: alert.id, templateId, event: event.status,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })), skipDuplicates: true });
      }
      return { accepted: events.length, changed };
    }, { timeout: 15000 });
  }
}
