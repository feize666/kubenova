import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { AiopsController } from './aiops.controller';
import { AiopsService } from './aiops.service';

@Module({
  imports: [AuthModule, MonitoringModule, ClustersModule],
  controllers: [AiopsController],
  providers: [AiopsService, AuthGuard],
})
export class AiopsModule {}
