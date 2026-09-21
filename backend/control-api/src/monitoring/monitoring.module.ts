import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { MetricsModule } from '../metrics/metrics.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';
import { AlertReceiverService } from './alert-receiver.service';
import { AlertReceiverController } from './alert-receiver.controller';
import { AlertIngestionService } from './alert-ingestion.service';
import { AlertIngestionController } from './alert-ingestion.controller';
import { NotificationWorker } from './notification-worker';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationHistoryService } from './notification-history.service';
import { NotificationHistoryController } from './notification-history.controller';
import { ReceiverStatusService } from './receiver-status.service';

@Module({
  imports: [AuthModule, ClustersModule, MetricsModule],
  controllers: [MonitoringController, ObservabilityController, AlertReceiverController, AlertIngestionController, NotificationHistoryController],
  providers: [MonitoringService, ObservabilityService, AlertReceiverService, AlertIngestionService, NotificationWorker, NotificationSchedulerService, NotificationHistoryService, ReceiverStatusService, AuthGuard],
  exports: [MonitoringService, ObservabilityService],
})
export class MonitoringModule {}
