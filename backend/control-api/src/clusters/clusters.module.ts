import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClusterAccessService } from '../common/cluster-access.service';
import { ClusterAutoSyncService } from './cluster-auto-sync.service';
import { ClusterEventSyncService } from './cluster-event-sync.service';
import { ClusterHealthController } from './cluster-health.controller';
import { ClusterHealthSchedulerService } from './cluster-health-scheduler.service';
import { ClusterHealthService } from './cluster-health.service';
import { ClustersController } from './clusters.controller';
import { ClustersService } from './clusters.service';
import { K8sClientService } from './k8s-client.service';
import { ClusterSyncService } from './cluster-sync.service';

@Module({
  imports: [AuthModule],
  controllers: [ClustersController, ClusterHealthController],
  providers: [
    ClustersService,
    K8sClientService,
    ClusterSyncService,
    ClusterHealthService,
    ClusterHealthSchedulerService,
    ClusterAutoSyncService,
    ClusterEventSyncService,
    ClusterAccessService,
  ],
  exports: [
    ClustersService,
    K8sClientService,
    ClusterSyncService,
    ClusterHealthService,
    ClusterEventSyncService,
    ClusterAccessService,
  ],
})
export class ClustersModule {}
