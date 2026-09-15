import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { LogCenterController } from './log-center.controller';
import { LogCenterService } from './log-center.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [LogCenterController],
  providers: [LogCenterService, AuthGuard],
})
export class LogCenterModule {}
