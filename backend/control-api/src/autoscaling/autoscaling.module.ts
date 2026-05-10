import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { AutoscalingController } from './autoscaling.controller';
import { AutoscalingService } from './autoscaling.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [AutoscalingController],
  providers: [AutoscalingService, AuthGuard],
  exports: [AutoscalingService],
})
export class AutoscalingModule {}
