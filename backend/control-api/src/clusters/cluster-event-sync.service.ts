import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import * as k8s from '@kubernetes/client-node';
import { ClusterSyncService } from './cluster-sync.service';
import { ClustersService } from './clusters.service';

type WatchTarget =
  | { path: string; kind: 'namespaces' }
  | { path: string; kind: 'pods' }
  | { path: string; kind: 'deployments' }
  | { path: string; kind: 'replicasets' }
  | { path: string; kind: 'statefulsets' }
  | { path: string; kind: 'daemonsets' }
  | { path: string; kind: 'jobs' }
  | { path: string; kind: 'cronjobs' }
  | { path: string; kind: 'services' }
  | { path: string; kind: 'endpoints' }
  | { path: string; kind: 'endpointSlices' }
  | { path: string; kind: 'ingresses' }
  | { path: string; kind: 'networkPolicies' }
  | { path: string; kind: 'ingressroutes' }
  | { path: string; kind: 'configmaps' }
  | { path: string; kind: 'secrets' }
  | { path: string; kind: 'serviceaccounts' }
  | { path: string; kind: 'pvs' }
  | { path: string; kind: 'pvcs' }
  | { path: string; kind: 'storageclasses' };

interface WatchHandle {
  abort: () => void;
}

export type ClusterRealtimeDomain =
  | 'workloads'
  | 'network'
  | 'configs'
  | 'storage'
  | 'namespaces'
  | 'clusters';

export interface ClusterRealtimeEvent {
  clusterId: string;
  domains: ClusterRealtimeDomain[];
  kind: WatchTarget['kind'];
  phase: string;
  action: 'upsert' | 'delete' | 'unknown';
  resource: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    state?: string;
  };
  timestamp: string;
}

@Injectable()
export class ClusterEventSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterEventSyncService.name);
  private readonly eventBus = new EventEmitter();
  private readonly watches = new Map<string, WatchHandle[]>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly restartFailures = new Map<string, number>();
  private readonly dirtyClusters = new Set<string>();
  private readonly debounceMs = 1500;
  private readonly restartBaseDelayMs = 30_000;
  private readonly restartMaxDelayMs = 10 * 60_000;
  private readonly startupDelayMs = 120_000;

  constructor(
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
  ) {
    this.eventBus.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    setTimeout(() => {
      void this.start().catch((error) => {
        this.logger.error(
          `cluster event sync bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, this.startupDelayMs);
  }

  onModuleDestroy(): void {
    for (const handles of this.watches.values()) {
      for (const handle of handles) {
        handle.abort();
      }
    }
    this.watches.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    this.restartFailures.clear();
    this.dirtyClusters.clear();
  }

  private async start(): Promise<void> {
    const clusters = await this.clustersService.list({
      state: 'active',
      page: '1',
      pageSize: '500',
    });
    for (const cluster of clusters.items) {
      if (!cluster.hasKubeconfig) {
        continue;
      }
      await this.startForCluster(cluster.id);
    }
  }

  private async startForCluster(clusterId: string): Promise<void> {
    this.stopForCluster(clusterId);
    this.restartFailures.delete(clusterId);
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return;
    }
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfig);
    const watch = new k8s.Watch(kc);
    const targets = this.buildTargets();
    const handles: WatchHandle[] = [];
    for (const target of targets) {
      try {
        const abortController = await watch.watch(
          target.path,
          {},
          (phase: string, apiObj: any) => {
            this.markClusterDirty(clusterId);
            this.emitRealtimeEvent(
              this.buildRealtimeEvent(clusterId, target, phase, apiObj),
            );
            void this.scheduleSync(clusterId);
          },
          (err) => {
            if (err && err !== k8s.Watch.SERVER_SIDE_CLOSE) {
              const message = err instanceof Error ? err.message : String(err);
              const normalized = message.toLowerCase();
              const transient =
                normalized.includes('timeout') ||
                normalized.includes('econnreset') ||
                normalized.includes('etimedout');
              if (transient) {
                this.logger.debug(
                  `watch ended for cluster=${clusterId} target=${target.path}: ${message}`,
                );
              } else {
                this.logger.warn(
                  `watch ended for cluster=${clusterId} target=${target.path}: ${message}`,
                );
              }
            }
            this.markClusterDirty(clusterId);
            void this.scheduleRestart(clusterId);
          },
        );
        handles.push({ abort: () => abortController.abort() });
      } catch (error) {
        this.logger.warn(
          `watch start failed cluster=${clusterId} target=${target.path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.markClusterDirty(clusterId);
        void this.scheduleRestart(clusterId);
      }
    }
    this.watches.set(clusterId, handles);
    this.logger.log(
      `cluster event sync started for ${clusterId}: ${handles.length} watch targets`,
    );
  }

  private buildTargets(): WatchTarget[] {
    return [
      { path: '/api/v1/namespaces', kind: 'namespaces' },
      { path: '/api/v1/pods', kind: 'pods' },
      { path: '/apis/apps/v1/deployments', kind: 'deployments' },
      { path: '/apis/apps/v1/replicasets', kind: 'replicasets' },
      { path: '/apis/apps/v1/statefulsets', kind: 'statefulsets' },
      { path: '/apis/apps/v1/daemonsets', kind: 'daemonsets' },
      { path: '/apis/batch/v1/jobs', kind: 'jobs' },
      { path: '/apis/batch/v1/cronjobs', kind: 'cronjobs' },
      { path: '/api/v1/services', kind: 'services' },
      { path: '/api/v1/endpoints', kind: 'endpoints' },
      {
        path: '/apis/discovery.k8s.io/v1/endpointslices',
        kind: 'endpointSlices',
      },
      { path: '/apis/networking.k8s.io/v1/ingresses', kind: 'ingresses' },
      {
        path: '/apis/networking.k8s.io/v1/networkpolicies',
        kind: 'networkPolicies',
      },
      {
        path: '/apis/traefik.io/v1alpha1/ingressroutes',
        kind: 'ingressroutes',
      },
      {
        path: '/apis/traefik.containo.us/v1alpha1/ingressroutes',
        kind: 'ingressroutes',
      },
      { path: '/api/v1/configmaps', kind: 'configmaps' },
      { path: '/api/v1/secrets', kind: 'secrets' },
      { path: '/api/v1/serviceaccounts', kind: 'serviceaccounts' },
      { path: '/api/v1/persistentvolumes', kind: 'pvs' },
      { path: '/api/v1/persistentvolumeclaims', kind: 'pvcs' },
      {
        path: '/apis/storage.k8s.io/v1/storageclasses',
        kind: 'storageclasses',
      },
    ];
  }

  async ensureClusterWatching(clusterId: string): Promise<void> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return;
    }
    await this.startForCluster(clusterId);
  }

  private stopForCluster(clusterId: string): void {
    const existing = this.watches.get(clusterId);
    if (!existing) {
      return;
    }
    for (const handle of existing) {
      handle.abort();
    }
    this.watches.delete(clusterId);
  }

  private async scheduleSync(clusterId: string): Promise<void> {
    const existing = this.debounceTimers.get(clusterId);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      clusterId,
      setTimeout(() => {
        void this.runSync(clusterId);
      }, this.debounceMs),
    );
  }

  markClusterDirty(clusterId: string): void {
    this.dirtyClusters.add(clusterId);
  }

  subscribe(listener: (event: ClusterRealtimeEvent) => void): () => void {
    this.eventBus.on('cluster-realtime', listener);
    return () => {
      this.eventBus.off('cluster-realtime', listener);
    };
  }

  consumeClusterDirty(clusterId: string): boolean {
    if (!this.dirtyClusters.has(clusterId)) {
      return false;
    }
    this.dirtyClusters.delete(clusterId);
    return true;
  }

  private getRestartDelayMs(clusterId: string): number {
    const failures = (this.restartFailures.get(clusterId) ?? 0) + 1;
    this.restartFailures.set(clusterId, failures);
    const delay = this.restartBaseDelayMs * 2 ** Math.min(failures - 1, 5);
    return Math.min(delay, this.restartMaxDelayMs);
  }

  private async scheduleRestart(clusterId: string): Promise<void> {
    const existing = this.restartTimers.get(clusterId);
    if (existing) {
      clearTimeout(existing);
    }
    const delayMs = this.getRestartDelayMs(clusterId);
    this.restartTimers.set(
      clusterId,
      setTimeout(() => {
        this.restartTimers.delete(clusterId);
        void this.ensureClusterWatching(clusterId);
      }, delayMs),
    );
  }

  private async runSync(clusterId: string): Promise<void> {
    this.debounceTimers.delete(clusterId);
    try {
      const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
      if (!kubeconfig) {
        return;
      }
      await this.clusterSyncService.syncCluster(clusterId, kubeconfig);
    } catch (error) {
      this.logger.warn(
        `cluster event sync failed for ${clusterId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private emitRealtimeEvent(event: ClusterRealtimeEvent): void {
    this.eventBus.emit('cluster-realtime', event);
  }

  private buildRealtimeEvent(
    clusterId: string,
    target: WatchTarget,
    phase: string,
    apiObj?: unknown,
  ): ClusterRealtimeEvent {
    const normalizedPhase = phase.trim().toLowerCase();
    const action =
      normalizedPhase.includes('delete') || normalizedPhase.includes('removed')
        ? 'delete'
        : normalizedPhase.includes('add') ||
            normalizedPhase.includes('modify') ||
            normalizedPhase.includes('update')
          ? 'upsert'
          : 'unknown';
    const resource = this.extractResourceSnapshot(apiObj);
    return {
      clusterId,
      domains: this.mapDomains(target.kind),
      kind: target.kind,
      phase,
      action,
      resource,
      timestamp: new Date().toISOString(),
    };
  }

  private extractResourceSnapshot(
    apiObj: unknown,
  ): ClusterRealtimeEvent['resource'] {
    if (!apiObj || typeof apiObj !== 'object') {
      return {};
    }
    const object = apiObj as Record<string, unknown>;
    const metadata =
      object.metadata && typeof object.metadata === 'object'
        ? (object.metadata as Record<string, unknown>)
        : {};
    return {
      apiVersion:
        typeof object.apiVersion === 'string' ? object.apiVersion : undefined,
      kind: typeof object.kind === 'string' ? object.kind : undefined,
      name: typeof metadata.name === 'string' ? metadata.name : undefined,
      namespace:
        typeof metadata.namespace === 'string' ? metadata.namespace : undefined,
      uid: typeof metadata.uid === 'string' ? metadata.uid : undefined,
      resourceVersion:
        typeof metadata.resourceVersion === 'string'
          ? metadata.resourceVersion
          : undefined,
      labels:
        metadata.labels && typeof metadata.labels === 'object'
          ? (metadata.labels as Record<string, string>)
          : undefined,
      annotations:
        metadata.annotations && typeof metadata.annotations === 'object'
          ? (metadata.annotations as Record<string, string>)
          : undefined,
      state:
        typeof object.state === 'string'
          ? object.state
          : typeof metadata.deletionTimestamp === 'string'
            ? 'deleted'
            : undefined,
    };
  }

  private mapDomains(kind: WatchTarget['kind']): ClusterRealtimeDomain[] {
    switch (kind) {
      case 'deployments':
      case 'replicasets':
      case 'statefulsets':
      case 'daemonsets':
      case 'jobs':
      case 'cronjobs':
      case 'pods':
        return ['workloads'];
      case 'services':
      case 'endpoints':
      case 'endpointSlices':
      case 'ingresses':
      case 'networkPolicies':
      case 'ingressroutes':
        return ['network'];
      case 'configmaps':
      case 'secrets':
      case 'serviceaccounts':
        return ['configs'];
      case 'pvs':
      case 'pvcs':
      case 'storageclasses':
        return ['storage'];
      case 'namespaces':
        return ['namespaces', 'workloads', 'network', 'configs', 'storage'];
      default:
        return ['clusters'];
    }
  }
}
