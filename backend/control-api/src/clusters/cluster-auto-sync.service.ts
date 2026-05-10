import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClusterSyncService } from './cluster-sync.service';
import { ClustersService } from './clusters.service';

@Injectable()
export class ClusterAutoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterAutoSyncService.name);
  private readonly intervalMs = 10 * 60_000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.runSyncCycle('interval');
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runSyncCycle(trigger: 'startup' | 'interval'): Promise<void> {
    if (this.running) {
      this.logger.debug(`skip cycle(${trigger}): previous cycle still running`);
      return;
    }
    this.running = true;

    try {
      const list = await this.clustersService.list({
        state: 'active',
        page: '1',
        pageSize: '500',
      });
      const targets = list.items.filter((item) => item.hasKubeconfig);
      if (targets.length === 0) {
        return;
      }

      this.logger.log(
        `auto-sync cycle(${trigger}) start: ${targets.length} cluster(s)`,
      );

      for (const cluster of targets) {
        try {
          const kubeconfig = await this.clustersService.getKubeconfig(
            cluster.id,
          );
          if (!kubeconfig) {
            continue;
          }
          await this.clusterSyncService.syncCluster(cluster.id, kubeconfig);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(
            `auto-sync failed for cluster=${cluster.id}: ${message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
