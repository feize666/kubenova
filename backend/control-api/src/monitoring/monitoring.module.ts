import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { MetricsModule } from '../metrics/metrics.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [AuthModule, ClustersModule, MetricsModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, AuthGuard],
  exports: [MonitoringService],
})
export class MonitoringModule {}
