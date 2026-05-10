import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { HelmModule } from '../helm/helm.module';
import { AiActionExecutorService } from './ai-action-executor.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';

@Module({
  imports: [AuthModule, HelmModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiActionExecutorService, AuthGuard],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
