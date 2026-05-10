import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [AuthModule, ClustersModule, MetricsModule],
  controllers: [DashboardController],
  providers: [DashboardService, AuthGuard],
})
export class DashboardModule {}
