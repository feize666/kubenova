import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClusterHealthService } from './cluster-health.service';

@Injectable()
export class ClusterHealthSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ClusterHealthSchedulerService.name);
  private readonly intervalMs = 10 * 60_000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly clusterHealthService: ClusterHealthService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.runCycle('interval');
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(trigger: 'startup' | 'interval'): Promise<void> {
    if (this.running) {
      this.logger.debug(`skip cycle(${trigger}): previous cycle still running`);
      return;
    }
    this.running = true;
    try {
      const targets =
        trigger === 'interval'
          ? await this.clusterHealthService.listClustersNeedingBackgroundProbe(
              this.intervalMs,
            )
          : [];
      if (targets.length === 0) {
        return;
      }
      this.logger.log(
        `health-scheduler cycle(${trigger}) staleTargets=${targets.length}`,
      );

      for (const clusterId of targets) {
        try {
          await this.clusterHealthService.probeCluster(clusterId, {
            source: 'auto',
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(
            `health-scheduler probe failed clusterId=${clusterId} reason=${message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
