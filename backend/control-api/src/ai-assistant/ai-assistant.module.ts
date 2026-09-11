import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { HelmModule } from '../helm/helm.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { TopologyGraphModule } from '../topology-graph/topology-graph.module';
import { AiActionExecutorService } from './ai-action-executor.service';
import { AiAssistantController } from './ai-assistant.controller';
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
  ],
  controllers: [AiAssistantController, AiClusterController],
  providers: [
    AiAssistantService,
    AiActionExecutorService,
    AiProviderService,
    AiContextAggregatorService,
    AuthGuard,
  ],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
