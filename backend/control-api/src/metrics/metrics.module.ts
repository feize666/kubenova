import { Module } from '@nestjs/common';
import { ClustersModule } from '../clusters/clusters.module';
import { LiveMetricsService } from './live-metrics.service';

@Module({
  imports: [ClustersModule],
  providers: [LiveMetricsService],
  exports: [LiveMetricsService],
})
export class MetricsModule {}
