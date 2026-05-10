import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { RuntimeController } from './runtime.controller';
import { RuntimeInternalController } from './runtime-internal.controller';
import { RuntimeGateway } from './runtime.gateway';
import { RuntimeRepository } from './runtime.repository';
import { RuntimeSessionService } from './runtime-session.service';
import { RuntimeService } from './runtime.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [RuntimeController, RuntimeInternalController],
  providers: [
    RuntimeService,
    RuntimeRepository,
    RuntimeSessionService,
    RuntimeGateway,
    AuthGuard,
  ],
  exports: [RuntimeService, RuntimeSessionService],
})
export class RuntimeModule {}
