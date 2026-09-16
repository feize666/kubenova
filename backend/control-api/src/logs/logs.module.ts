import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { AuthorizationModule } from '../common/authorization.module';

@Module({
  imports: [AuthModule, ClustersModule, RuntimeModule, AuthorizationModule],
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
