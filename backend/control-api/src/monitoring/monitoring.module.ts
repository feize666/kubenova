import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { MetricsModule } from '../metrics/metrics.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

@Module({
  imports: [AuthModule, ClustersModule, MetricsModule],
  controllers: [MonitoringController, ObservabilityController],
  providers: [MonitoringService, ObservabilityService, AuthGuard],
  exports: [MonitoringService, ObservabilityService],
})
export class MonitoringModule {}
