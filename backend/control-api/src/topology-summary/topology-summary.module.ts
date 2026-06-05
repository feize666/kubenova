import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { TopologySummaryController } from './topology-summary.controller';
import { TopologySummaryService } from './topology-summary.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [TopologySummaryController],
  providers: [TopologySummaryService],
})
export class TopologySummaryModule {}
