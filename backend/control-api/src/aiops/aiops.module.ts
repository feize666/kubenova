import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { AiopsController } from './aiops.controller';
import { AiopsService } from './aiops.service';

@Module({
  imports: [AuthModule, MonitoringModule],
  controllers: [AiopsController],
  providers: [AiopsService, AuthGuard],
})
export class AiopsModule {}
