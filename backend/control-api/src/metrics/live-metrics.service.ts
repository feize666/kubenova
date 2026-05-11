import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { K8sClientService } from '../clusters/k8s-client.service';

export interface LiveUsageHistoryPoint {
  timestamp: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
}

export interface LiveUsageSnapshot {
  podName: string;
  namespace: string;
  clusterId: string;
  capturedAt: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
  source: 'metrics-server' | 'cluster-metrics-cache' | 'none';
  available: boolean;
  freshnessWindowMs: number;
  history: LiveUsageHistoryPoint[];
  note?: string;
}

export interface ClusterLiveUsageSnapshot {
  capturedAt: string;
  source: 'metrics-server' | 'cluster-metrics-cache' | 'none';
  available: boolean;
  freshnessWindowMs: number;
  cpuUsage: number | null;
  memoryUsage: number | null;
  pods: LiveUsageSnapshot[];
  history: LiveUsageHistoryPoint[];
  note?: string;
}

type PodMetricItem = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  timestamp?: string;
  containers?: Array<{
    name?: string;
    usage?: {
      cpu?: string;
      memory?: string;
    };
  }>;
};

@Injectable()
export class LiveMetricsService {
  private readonly logger = new Logger(LiveMetricsService.name);
  private readonly freshnessWindowMs = 60_000;
  private readonly snapshotCache = new Map<string, ClusterLiveUsageSnapshot>();

  constructor(private readonly k8sClient: K8sClientService) {}

  private parseCpuToCores(value?: string): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number.parseFloat(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (trimmed.endsWith('n')) {
      return numeric / 1_000_000_000;
    }
    if (trimmed.endsWith('u') || trimmed.endsWith('µ') || trimmed.endsWith('μ')) {
      return numeric / 1_000_000;
    }
    if (trimmed.endsWith('m')) {
      return numeric / 1_000;
    }
    if (trimmed.endsWith('K') || trimmed.endsWith('k')) {
      return numeric * 1_000;
    }
    if (trimmed.endsWith('M')) {
      return numeric * 1_000_000;
    }
    if (trimmed.endsWith('G')) {
      return numeric * 1_000_000_000;
    }
    if (trimmed.endsWith('T')) {
      return numeric * 1_000_000_000_000;
    }
    if (trimmed.endsWith('P')) {
      return numeric * 1_000_000_000_000_000;
    }
    if (trimmed.endsWith('E')) {
      return numeric * 1_000_000_000_000_000_000;
    }
    return numeric;
  }

  private parseMemoryToBytes(value?: string): number | null {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)?$/);
    if (!match) return null;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = (match[2] ?? '').toLowerCase();
    const units: Record<string, number> = {
      '': 1,
      k: 1_000,
      m: 1_000_000,
      g: 1_000_000_000,
      t: 1_000_000_000_000,
      ki: 1024,
      mi: 1024 ** 2,
      gi: 1024 ** 3,
      ti: 1024 ** 4,
    };
    const base = units[suffix];
    if (!base) return null;
    return amount * base;
  }

  private buildHistoryPoint(
    cpu: number | null,
    memory: number | null,
  ): LiveUsageHistoryPoint {
    return {
      timestamp: new Date().toISOString(),
      cpuUsage: cpu,
      memoryUsage: memory,
    };
  }

  private toPodSnapshot(
    clusterId: string,
    namespace: string,
    podName: string,
    metric?: PodMetricItem,
  ): LiveUsageSnapshot {
    const containerUsages = (metric?.containers ?? []).map((container) => ({
      cpu: this.parseCpuToCores(container.usage?.cpu),
      memory: this.parseMemoryToBytes(container.usage?.memory),
    }));

    const cpuValues = containerUsages
      .map((item) => item.cpu)
      .filter((value): value is number => typeof value === 'number');
    const memoryValues = containerUsages
      .map((item) => item.memory)
      .filter((value): value is number => typeof value === 'number');

    const cpuUsage =
      cpuValues.length > 0
        ? cpuValues.reduce((sum, item) => sum + item, 0)
        : null;
    const memoryUsage =
      memoryValues.length > 0
        ? memoryValues.reduce((sum, item) => sum + item, 0)
        : null;
    const available = cpuUsage !== null || memoryUsage !== null;
    const capturedAt = metric?.timestamp ?? new Date().toISOString();

    return {
      podName,
      namespace,
      clusterId,
      capturedAt,
      cpuUsage,
      memoryUsage,
      source: 'metrics-server',
      available,
      freshnessWindowMs: this.freshnessWindowMs,
      history: [this.buildHistoryPoint(cpuUsage, memoryUsage)],
      note: available
        ? undefined
        : 'live metrics provider returned no pod sample',
    };
  }

  private buildClusterAggregate(
    pods: LiveUsageSnapshot[],
    capturedAt: string,
  ): Pick<
    ClusterLiveUsageSnapshot,
    'cpuUsage' | 'memoryUsage' | 'history' | 'available'
  > {
    const cpuUsage = pods
      .map((item) => item.cpuUsage)
      .filter((value): value is number => typeof value === 'number')
      .reduce((sum, item) => sum + item, 0);
    const memoryUsage = pods
      .map((item) => item.memoryUsage)
      .filter((value): value is number => typeof value === 'number')
      .reduce((sum, item) => sum + item, 0);
    const available = pods.length > 0;
    return {
      cpuUsage: available ? cpuUsage : null,
      memoryUsage: available ? memoryUsage : null,
      available,
      history: [
        {
          timestamp: capturedAt,
          cpuUsage: available ? cpuUsage : null,
          memoryUsage: available ? memoryUsage : null,
        },
      ],
    };
  }

  private cloneSnapshot(
    snapshot: ClusterLiveUsageSnapshot,
  ): ClusterLiveUsageSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as ClusterLiveUsageSnapshot;
  }

  private cacheKey(clusterId: string, namespace?: string): string {
    return `${clusterId}::${namespace?.trim() || '*'}`;
  }

  async getClusterSnapshot(
    clusterId: string,
    kubeconfigYaml: string,
    namespace?: string,
  ): Promise<ClusterLiveUsageSnapshot> {
    const key = this.cacheKey(clusterId, namespace);
    const cached = this.snapshotCache.get(key);
    if (cached) {
      const cachedAge = Date.now() - new Date(cached.capturedAt).getTime();
      if (cachedAge >= 0 && cachedAge < this.freshnessWindowMs) {
        return this.cloneSnapshot({
          ...cached,
          source: 'cluster-metrics-cache',
        });
      }
    }

    try {
      const kc = this.k8sClient.createClient(kubeconfigYaml);
      const metricsApi = new k8s.Metrics(kc);
      const podMetrics = await metricsApi.getPodMetrics(namespace);
      const livePods = podMetrics.items.map((item) =>
        this.toPodSnapshot(
          clusterId,
          item.metadata?.namespace ?? namespace ?? 'default',
          item.metadata?.name ?? 'unknown-pod',
          item as PodMetricItem,
        ),
      );
      const capturedAt = new Date().toISOString();
      const aggregate = this.buildClusterAggregate(livePods, capturedAt);
      const nextSnapshot: ClusterLiveUsageSnapshot = {
        capturedAt,
        source: livePods.length > 0 ? 'metrics-server' : 'none',
        available: aggregate.available,
        freshnessWindowMs: this.freshnessWindowMs,
        cpuUsage: aggregate.cpuUsage,
        memoryUsage: aggregate.memoryUsage,
        pods: livePods,
        history: aggregate.history,
        note:
          livePods.length > 0
            ? undefined
            : 'no live pod metrics returned by metrics-server',
      };
      if (cached) {
        nextSnapshot.history = [
          ...cached.history,
          ...nextSnapshot.history,
        ].slice(-12);
        nextSnapshot.pods = nextSnapshot.pods.map((pod) => {
          const previous = cached.pods.find(
            (item) =>
              item.podName === pod.podName && item.namespace === pod.namespace,
          );
          if (!previous) {
            return pod;
          }
          return {
            ...pod,
            history: [...previous.history, ...pod.history].slice(-12),
          };
        });
      }

      this.snapshotCache.set(key, nextSnapshot);
      return this.cloneSnapshot(nextSnapshot);
    } catch (err) {
      this.logger.warn(
        `live metrics snapshot failed for cluster ${clusterId}: ${(err as Error).message}`,
      );
      if (cached) {
        return this.cloneSnapshot({
          ...cached,
          source: 'cluster-metrics-cache',
          note: (err as Error).message,
        });
      }
      return {
        capturedAt: new Date().toISOString(),
        source: 'none',
        available: false,
        freshnessWindowMs: this.freshnessWindowMs,
        cpuUsage: null,
        memoryUsage: null,
        pods: [],
        history: [],
        note: (err as Error).message,
      };
    }
  }
}
