import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { NetworkModule } from '../network/network.module';
import { MetricsModule } from '../metrics/metrics.module';
import { StorageModule } from '../storage/storage.module';
import { AuthGuard } from '../common/auth.guard';
import { WorkloadsController } from './workloads.controller';
import { WorkloadsService } from './workloads.service';
import { WorkloadsRepository } from './workloads.repository';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    NetworkModule,
    ClustersModule,
    MetricsModule,
  ],
  controllers: [WorkloadsController],
  providers: [WorkloadsService, WorkloadsRepository, AuthGuard],
})
export class WorkloadsModule {}
