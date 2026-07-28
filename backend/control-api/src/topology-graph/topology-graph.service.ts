import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ClusterHealthService,
  type ClusterHealthSnapshotView,
} from '../clusters/cluster-health.service';
import { PrismaService } from '../platform/database/prisma.service';
import {
  TOPOLOGY_V2_SOURCES,
  TopologyGraphAssembler,
} from './topology-graph.assembler';
import type {
  LegacyTopologySource,
  PersistedResource,
  TopologyGraphQuery,
  TopologyGraphResponse,
  TopologyGraphV2Response,
  TopologyRow,
  TopologySource,
} from './topology-graph.contract';
import {
  indexWarnings,
  TopologyResourceProjector,
} from './topology-resource.projector';
import { TopologyRelationResolver } from './topology-relation.resolver';
import {
  boundedInteger,
  TopologyGraphCacheService,
} from './topology-graph-cache.service';

export type {
  TopologyGraphQuery,
  TopologyGraphRelation,
  TopologyGraphResource,
  TopologyGraphResponse,
  TopologyGraphV2Relation,
  TopologyGraphV2Resource,
  TopologyGraphV2Response,
} from './topology-graph.contract';

const LEGACY_SOURCES: LegacyTopologySource[] = [
  'workloads',
  'network',
  'storage',
  'configuration',
  'gateway',
];

const DEFAULT_STALE_AFTER_MS = 15 * 60_000;
const MIN_STALE_AFTER_MS = 60_000;
const MAX_STALE_AFTER_MS = 24 * 60 * 60_000;

interface MonitoringAlert {
  clusterId: string | null;
  namespace: string | null;
  resourceType: string | null;
  resourceName: string | null;
}

@Injectable()
export class TopologyGraphService {
  private readonly logger = new Logger(TopologyGraphService.name);
  private readonly projector = new TopologyResourceProjector();
  private readonly relationResolver = new TopologyRelationResolver();
  private readonly assembler = new TopologyGraphAssembler();
  private readonly staleAfterMs = boundedInteger(
    process.env.TOPOLOGY_GRAPH_V2_STALE_AFTER_MS,
    DEFAULT_STALE_AFTER_MS,
    MIN_STALE_AFTER_MS,
    MAX_STALE_AFTER_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly cache: TopologyGraphCacheService,
  ) {}

  async getGraph(
    query: TopologyGraphQuery = {},
  ): Promise<TopologyGraphResponse> {
    const clusterIds = await this.resolveReadableClusterIds(query.clusterId);
    const enabledSources = this.normalizeLegacySources(query.sources);
    if (clusterIds.length === 0)
      return this.assembler.assembleLegacy({
        resources: [],
        relations: [],
        warningRecords: 0,
      });

    const { rows, alerts } = await this.loadRows(
      clusterIds,
      query.namespace,
      enabledSources,
    );
    const resources = this.projector.projectLegacy(rows, indexWarnings(alerts));
    return this.assembler.assembleLegacy({
      resources,
      relations: this.relationResolver.resolveLegacy(rows, resources),
      warningRecords: alerts.length,
    });
  }

  async getGraphV2(
    query: TopologyGraphQuery = {},
  ): Promise<TopologyGraphV2Response> {
    const clusterId = query.clusterId?.trim();
    if (!clusterId)
      throw new BadRequestException(
        'clusterId is required for a single-cluster topology graph',
      );
    const enabledSources = this.normalizeV2Sources(query.sources);
    const namespace = query.namespace?.trim() || undefined;
    const legacySources = new Set<LegacyTopologySource>(enabledSources);
    if (enabledSources.has('network')) legacySources.add('gateway');

    const revision = await this.loadInventoryRevision(
      clusterId,
      namespace,
      enabledSources,
    );
    const cacheKey = this.v2CacheKey(
      clusterId,
      namespace,
      enabledSources,
      revision,
    );
    const cached = await this.safeCacheGet(cacheKey);
    if (cached) {
      this.logger.debug(
        `topology-v2 cache_hit clusterId=${clusterId} revision=${revision}`,
      );
      return this.decorateFreshness(cached, await this.latestHealth(clusterId));
    }
    this.logger.debug(
      `topology-v2 cache_miss clusterId=${clusterId} revision=${revision}`,
    );

    // V2 reads the persisted inventory directly. Cluster reachability must not
    // erase a usable graph snapshot or trigger a live Kubernetes request.
    const { rows, alerts } = await this.loadRows(
      [clusterId],
      namespace,
      legacySources,
      true,
    );
    const resources = this.projector.projectV2(rows, indexWarnings(alerts));
    const relations = this.relationResolver.resolveV2(rows, resources);
    const graph = this.assembler.assembleV2({
      clusterId,
      enabledSources,
      rows,
      resources,
      relations,
      warningRecords: alerts.length,
      revision,
    });
    await this.safeCacheSet(cacheKey, graph);
    return this.decorateFreshness(graph, await this.latestHealth(clusterId));
  }

  private async loadRows(
    clusterIds: string[],
    namespace: string | undefined,
    enabledSources: ReadonlySet<LegacyTopologySource>,
    scopeAlertsToNamespace = false,
  ): Promise<{ rows: TopologyRow[]; alerts: MonitoringAlert[] }> {
    const where = {
      clusterId: { in: clusterIds },
      state: { not: 'deleted' },
      cluster: { deletedAt: null, status: { not: 'deleted' } },
      ...(namespace ? { namespace } : {}),
    };
    const [workloads, networkResources, storageResources, configs, alerts] =
      await Promise.all([
        enabledSources.has('workloads')
          ? this.prisma.workloadRecord.findMany({
              where,
              select: {
                id: true,
                clusterId: true,
                namespace: true,
                kind: true,
                name: true,
                state: true,
                replicas: true,
                readyReplicas: true,
                spec: true,
                statusJson: true,
                labels: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
        enabledSources.has('network') || enabledSources.has('gateway')
          ? this.prisma.networkResource.findMany({
              where,
              select: {
                id: true,
                clusterId: true,
                namespace: true,
                kind: true,
                name: true,
                state: true,
                spec: true,
                statusJson: true,
                labels: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
        enabledSources.has('storage')
          ? this.prisma.storageResource.findMany({
              where,
              select: {
                id: true,
                clusterId: true,
                namespace: true,
                kind: true,
                name: true,
                state: true,
                capacity: true,
                storageClass: true,
                bindingMode: true,
                spec: true,
                statusJson: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
        enabledSources.has('configuration')
          ? this.prisma.configResource.findMany({
              where,
              select: {
                id: true,
                clusterId: true,
                namespace: true,
                kind: true,
                name: true,
                state: true,
                dataKeys: true,
                currentRev: true,
                labels: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
        this.prisma.monitoringAlert.findMany({
          where: {
            clusterId: { in: clusterIds },
            status: 'firing',
            severity: { in: ['warning', 'critical'] },
            ...(scopeAlertsToNamespace && namespace ? { namespace } : {}),
          },
          select: {
            clusterId: true,
            namespace: true,
            resourceType: true,
            resourceName: true,
          },
        }),
      ]);
    const rows: TopologyRow[] = [
      ...workloads.map((row) => ({
        source: 'workloads' as const,
        row: row as PersistedResource,
      })),
      ...networkResources.map((row) => ({
        source: networkSource(row.kind),
        row: row as PersistedResource,
      })),
      ...storageResources.map((row) => ({
        source: 'storage' as const,
        row: row as PersistedResource,
      })),
      ...configs.map((row) => ({
        source: 'configuration' as const,
        row: row as PersistedResource,
      })),
    ];
    return { rows, alerts };
  }

  private async loadInventoryRevision(
    clusterId: string,
    namespace: string | undefined,
    enabledSources: ReadonlySet<TopologySource>,
  ): Promise<string> {
    const where = {
      clusterId,
      state: { not: 'deleted' },
      cluster: { deletedAt: null, status: { not: 'deleted' } },
      ...(namespace ? { namespace } : {}),
    };
    const aggregate = {
      _count: { _all: true },
      _max: { updatedAt: true },
    } as const;
    const [workloads, network, storage, configuration, alerts] =
      await Promise.all([
        enabledSources.has('workloads')
          ? this.prisma.workloadRecord.aggregate({ where, ...aggregate })
          : Promise.resolve(null),
        enabledSources.has('network')
          ? this.prisma.networkResource.aggregate({ where, ...aggregate })
          : Promise.resolve(null),
        enabledSources.has('storage')
          ? this.prisma.storageResource.aggregate({ where, ...aggregate })
          : Promise.resolve(null),
        enabledSources.has('configuration')
          ? this.prisma.configResource.aggregate({ where, ...aggregate })
          : Promise.resolve(null),
        this.prisma.monitoringAlert.aggregate({
          where: {
            clusterId,
            status: 'firing',
            severity: { in: ['warning', 'critical'] },
            ...(namespace ? { namespace } : {}),
          },
          ...aggregate,
        }),
      ]);
    const payload = {
      schemaVersion: '2.0',
      clusterId,
      namespace: namespace ?? null,
      sources: [...enabledSources].sort(),
      inventory: {
        workloads: aggregateRevision(workloads),
        network: aggregateRevision(network),
        storage: aggregateRevision(storage),
        configuration: aggregateRevision(configuration),
        alerts: aggregateRevision(alerts),
      },
    };
    return `sha256:${createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')}`;
  }

  private v2CacheKey(
    clusterId: string,
    namespace: string | undefined,
    sources: ReadonlySet<TopologySource>,
    revision: string,
  ): string {
    return [
      'kubenova',
      'topology',
      'v2',
      encodeURIComponent(clusterId),
      encodeURIComponent(namespace ?? '*'),
      [...sources].sort().join(','),
      revision,
    ].join(':');
  }

  private async safeCacheGet(
    key: string,
  ): Promise<TopologyGraphV2Response | null> {
    try {
      return await this.cache.get(key);
    } catch (error) {
      this.logger.warn(
        `topology-v2 cache_get_failed error=${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async safeCacheSet(
    key: string,
    graph: TopologyGraphV2Response,
  ): Promise<void> {
    try {
      await this.cache.set(key, graph);
    } catch (error) {
      this.logger.warn(
        `topology-v2 cache_set_failed error=${errorMessage(error)}`,
      );
    }
  }

  private async latestHealth(
    clusterId: string,
  ): Promise<ClusterHealthSnapshotView | null> {
    try {
      return await this.clusterHealthService.getLatestSnapshot(clusterId);
    } catch (error) {
      this.logger.warn(
        `topology-v2 health_snapshot_failed clusterId=${clusterId} error=${errorMessage(error)}`,
      );
      return null;
    }
  }

  private decorateFreshness(
    graph: TopologyGraphV2Response,
    health: ClusterHealthSnapshotView | null,
  ): TopologyGraphV2Response {
    const now = Date.now();
    const ageMs = ageOf(graph.dataAsOf, now);
    const healthAgeMs = ageOf(health?.checkedAt ?? null, now);
    const hasData = graph.resources.length > 0;
    const status = !hasData
      ? ('unavailable' as const)
      : !health?.ok ||
          healthAgeMs === null ||
          healthAgeMs > this.staleAfterMs ||
          ageMs === null ||
          ageMs > this.staleAfterMs
        ? ('stale' as const)
        : ('fresh' as const);
    return {
      ...graph,
      freshness: {
        status,
        observedAt: graph.dataAsOf,
        ageMs,
        staleAfterMs: this.staleAfterMs,
      },
      resources: graph.resources.map((resource) => ({
        ...resource,
        freshness: {
          status,
          observedAt: resource.freshness.observedAt,
          ageMs: ageOf(resource.freshness.observedAt, now),
          staleAfterMs: this.staleAfterMs,
        },
      })),
    };
  }

  private normalizeLegacySources(
    sources?: readonly string[],
  ): Set<LegacyTopologySource> {
    const requested = new Set(
      sources?.filter((source): source is LegacyTopologySource =>
        LEGACY_SOURCES.includes(source as LegacyTopologySource),
      ),
    );
    return requested.size ? requested : new Set(LEGACY_SOURCES);
  }

  private normalizeV2Sources(sources?: readonly string[]): Set<TopologySource> {
    const normalized = sources?.map((source) =>
      source === 'gateway' ? 'network' : source,
    );
    const requested = new Set(
      normalized?.filter((source): source is TopologySource =>
        TOPOLOGY_V2_SOURCES.includes(source as TopologySource),
      ),
    );
    return requested.size ? requested : new Set(TOPOLOGY_V2_SOURCES);
  }

  private async resolveReadableClusterIds(
    clusterId?: string,
  ): Promise<string[]> {
    const normalized = clusterId?.trim();
    if (normalized) {
      await this.clusterHealthService.assertClusterOnlineForRead(normalized);
      return [normalized];
    }
    return this.clusterHealthService.listReadableClusterIdsForResourceRead();
  }
}

function networkSource(kind: string): LegacyTopologySource {
  return [
    'GatewayClass',
    'Gateway',
    'HTTPRoute',
    'GRPCRoute',
    'TCPRoute',
    'TLSRoute',
    'UDPRoute',
  ].includes(kind)
    ? 'gateway'
    : 'network';
}

function aggregateRevision(
  value: {
    _count: { _all: number };
    _max: { updatedAt: Date | null };
  } | null,
): { count: number; updatedAt: string | null } | null {
  if (!value) return null;
  return {
    count: value._count._all,
    updatedAt: value._max.updatedAt?.toISOString() ?? null,
  };
}

function ageOf(observedAt: string | null, now: number): number | null {
  if (!observedAt) return null;
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  return Math.max(0, now - observedAtMs);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
