import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { HelmModule } from '../helm/helm.module';
import { AiActionExecutorService } from './ai-action-executor.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiProviderService } from './ai-provider.service';
import { AiClusterController } from './ai-cluster.controller';

@Module({
  imports: [AuthModule, HelmModule],
  controllers: [AiAssistantController, AiClusterController],
  providers: [AiAssistantService, AiActionExecutorService, AiProviderService, AuthGuard],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
