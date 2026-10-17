import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { HelmModule } from '../helm/helm.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { ResourcesModule } from '../resources/resources.module';
import { TopologyGraphModule } from '../topology-graph/topology-graph.module';
import { AiActionExecutorService } from './ai-action-executor.service';
import { AiActionApprovalService } from './ai-action-approval.service';
import { AiAssistantAccessService } from './ai-assistant-access.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantGateway } from './ai-assistant.gateway';
import { AiAssistantService } from './ai-assistant.service';
import { AiContextAggregatorService } from './ai-context-aggregator.service';
import { AiProviderService } from './ai-provider.service';
import { AiClusterController } from './ai-cluster.controller';

@Module({
  imports: [
    AuthModule,
    ClustersModule,
    HelmModule,
    MonitoringModule,
    TopologyGraphModule,
    ResourcesModule,
  ],
  controllers: [AiAssistantController, AiClusterController],
  providers: [
    AiAssistantService,
    AiAssistantGateway,
    AiActionExecutorService,
    AiActionApprovalService,
    AiAssistantAccessService,
    AiProviderService,
    AiContextAggregatorService,
    AuthGuard,
  ],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
