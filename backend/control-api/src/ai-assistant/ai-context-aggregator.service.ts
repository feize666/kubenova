import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import {
  ClustersService,
  type ClusterItemResponse,
} from '../clusters/clusters.service';
import {
  MonitoringService,
  type AlertsResponse,
  type MonitoringEventsResponse,
} from '../monitoring/monitoring.service';
import { PrismaService } from '../platform/database/prisma.service';
import {
  TopologyGraphService,
  type TopologyGraphV2Response,
} from '../topology-graph/topology-graph.service';

const DEFAULT_TIMEOUT_MS = 2_500;
const MAX_ALERTS = 20;
const MAX_EVENTS = 20;
const MAX_EVIDENCE_DEPTH = 4;
const MAX_EVIDENCE_KEYS = 40;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_STRING_LENGTH = 1_000;

const SENSITIVE_KEY =
  /(?:password|passwd|secret|token|kubeconfig|api[-_]?key|authorization|credential|private[-_]?key|ciphertext|refresh)/i;
const BEARER_VALUE = /(bearer\s+)[^\s,;]+/gi;
const KEY_VALUE_SECRET =
  /((?:api[-_]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;]+)/gi;
const URL_WITH_SECRET_QUERY =
  /([?&](?:token|api[_-]?key|password|secret|sig(?:nature)?)=)[^&#\s]+/gi;
const PEM_PRIVATE_KEY =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;
const JWT_VALUE =
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const PROVIDER_KEY_VALUE = /\b(?:sk|rk|ak|AKIA)[-_]?[A-Za-z0-9_-]{16,}\b/g;

type SafeRecord = Record<string, unknown>;

export interface AiClusterContextOptions {
  /** Additional client-provided evidence is bounded and treated as untrusted input. */
  evidence?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface AiClusterContext {
  schemaVersion: '1.0';
  generatedAt: string;
  cluster: {
    id: string;
    name: string;
    lifecycleState: string;
    runtimeStatus: string;
    provider: string;
    environment: string;
    kubernetesVersion: string;
  };
  health: {
    ok: boolean | null;
    status: string;
    latencyMs: number | null;
    checkedAt: string | null;
    reason: string | null;
    failureCount: number | null;
    stale: boolean;
    version: string | null;
    nodeCount: number | null;
  };
  resources: {
    total: number;
    namespaces: number;
    byKind: Record<string, number>;
    latestUpdatedAt: string | null;
    degraded: boolean;
  };
  alerts: {
    activeTotal: number;
    critical: number;
    warning: number;
    info: number;
    items: Array<{
      severity: string;
      title: string;
      message: string;
      namespace: string | null;
      resourceType: string | null;
      resourceName: string | null;
      firedAt: string;
    }>;
    degraded: boolean;
  };
  events: {
    total: number;
    items: Array<{
      level: string;
      source: string;
      message: string;
      timestamp: string;
    }>;
    degraded: boolean;
  };
  topology: {
    resourceCount: number;
    relationCount: number;
    resourcesByKind: Record<string, number>;
    relationsByType: Record<string, number>;
    warningRecords: number;
    coverage: Record<
      string,
      { records: number; status: string; dataAsOf: string | null }
    >;
    dataAsOf: string | null;
    freshness: string;
    degraded: boolean;
  };
  supplementalEvidence: SafeRecord;
  degradedSources: string[];
}

interface ResourceAggregateRow {
  kind: string;
  _count: { _all: number };
  _max: { updatedAt: Date | null };
}

/**
 * Builds a bounded, server-side snapshot for AI analysis. The service exposes
 * counts and operational signals only; it never reads kubeconfig, credentials,
 * resource specs, secret values, or API keys into the prompt context.
 */
@Injectable()
export class AiContextAggregatorService {
  private readonly logger = new Logger(AiContextAggregatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clustersService: ClustersService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly monitoringService: MonitoringService,
    private readonly topologyGraphService: TopologyGraphService,
  ) {}

  async collect(
    clusterId: string,
    options: AiClusterContextOptions = {},
  ): Promise<AiClusterContext> {
    const canonicalId = clusterId.trim();
    const timeoutMs = this.normalizeTimeout(options.timeoutMs);
    const degradedSources: string[] = [];

    const clusterResult = await this.safeCall(
      'cluster',
      () => this.clustersService.findById(canonicalId),
      null,
      timeoutMs,
      degradedSources,
    );
    const cluster = clusterResult ?? this.fallbackCluster(canonicalId);

    const [health, resources, alerts, events, topology] = await Promise.all([
      this.safeCall(
        'health',
        () => this.loadHealth(canonicalId),
        this.fallbackHealth(),
        timeoutMs,
        degradedSources,
      ),
      this.safeCall(
        'resources',
        () => this.loadResources(canonicalId),
        this.fallbackResources(),
        timeoutMs,
        degradedSources,
      ),
      this.safeCall(
        'alerts',
        () => this.loadAlerts(canonicalId),
        this.fallbackAlerts(),
        timeoutMs,
        degradedSources,
      ),
      this.safeCall(
        'events',
        () => this.loadEvents(canonicalId),
        this.fallbackEvents(),
        timeoutMs,
        degradedSources,
      ),
      this.safeCall(
        'topology',
        () => this.loadTopology(canonicalId),
        this.fallbackTopology(),
        timeoutMs,
        degradedSources,
      ),
    ]);

    return {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      cluster: {
        id: cluster.id,
        name: this.safeString(cluster.name),
        lifecycleState: this.safeString(cluster.state),
        runtimeStatus: health.status,
        provider: this.safeString(cluster.provider),
        environment: this.safeString(cluster.environment),
        kubernetesVersion: this.safeString(cluster.kubernetesVersion),
      },
      health,
      resources,
      alerts,
      events,
      topology,
      supplementalEvidence: sanitizeEvidence(options.evidence ?? {}),
      degradedSources: [...new Set(degradedSources)].sort(),
    };
  }

  private async loadHealth(
    clusterId: string,
  ): Promise<AiClusterContext['health']> {
    const detail =
      await this.clusterHealthService.getClusterHealthDetail(clusterId);
    const payload = isRecord(detail.detail.payload)
      ? detail.detail.payload
      : {};
    return {
      ok: detail.summary.ok,
      status: detail.summary.runtimeStatus,
      latencyMs: detail.summary.latencyMs,
      checkedAt: detail.summary.checkedAt,
      reason: sanitizeText(detail.summary.reason),
      failureCount: detail.detail.failureCount,
      stale: detail.summary.isStale,
      version: this.safeOptionalString(payload.version),
      nodeCount: this.safeOptionalNumber(payload.nodeCount),
    };
  }

  private async loadResources(
    clusterId: string,
  ): Promise<AiClusterContext['resources']> {
    const where = {
      clusterId,
      state: { not: 'deleted' },
    } satisfies Prisma.WorkloadRecordWhereInput;
    const [workloads, networks, storages, configs, namespaces] =
      await Promise.all([
        this.prisma.workloadRecord.groupBy({
          by: ['kind'],
          where,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.networkResource.groupBy({
          by: ['kind'],
          where,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.storageResource.groupBy({
          by: ['kind'],
          where,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.configResource.groupBy({
          by: ['kind'],
          where,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        this.prisma.namespaceRecord.count({
          where: { clusterId, state: { not: 'deleted' } },
        }),
      ]);
    const rows = [
      ...workloads,
      ...networks,
      ...storages,
      ...configs,
    ] as unknown as ResourceAggregateRow[];
    const byKind: Record<string, number> = {};
    let latestUpdatedAt: Date | null = null;
    for (const row of rows) {
      const kind = this.safeString(row.kind) || 'Unknown';
      byKind[kind] = (byKind[kind] ?? 0) + row._count._all;
      const updated = row._max.updatedAt;
      if (updated && (!latestUpdatedAt || updated > latestUpdatedAt))
        latestUpdatedAt = updated;
    }
    const total = Object.values(byKind).reduce((sum, count) => sum + count, 0);
    return {
      total,
      namespaces,
      byKind: sortCounts(byKind),
      latestUpdatedAt: latestUpdatedAt?.toISOString() ?? null,
      degraded: false,
    };
  }

  private async loadAlerts(
    clusterId: string,
  ): Promise<AiClusterContext['alerts']> {
    const result = await this.monitoringService.getAlerts({
      clusterId,
      status: 'firing',
      page: 1,
      pageSize: MAX_ALERTS,
      range: '24h',
    });
    return mapAlerts(result);
  }

  private async loadEvents(
    clusterId: string,
  ): Promise<AiClusterContext['events']> {
    const result = await this.monitoringService.getEvents({
      clusterId,
      range: '24h',
    });
    return mapEvents(result);
  }

  private async loadTopology(
    clusterId: string,
  ): Promise<AiClusterContext['topology']> {
    const graph = await this.topologyGraphService.getGraphV2({ clusterId });
    return mapTopology(graph);
  }

  private fallbackCluster(clusterId: string): ClusterItemResponse {
    return {
      id: clusterId,
      name: clusterId,
      apiServer: null,
      environment: 'unknown',
      status: 'unknown',
      cpuUsage: 0,
      memoryUsage: 0,
      storageUsage: 0,
      provider: 'unknown',
      kubernetesVersion: 'unknown',
      state: 'active',
      version: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      hasKubeconfig: false,
    };
  }

  private fallbackHealth(): AiClusterContext['health'] {
    return {
      ok: null,
      status: 'unknown',
      latencyMs: null,
      checkedAt: null,
      reason: 'health unavailable',
      failureCount: null,
      stale: true,
      version: null,
      nodeCount: null,
    };
  }

  private fallbackResources(): AiClusterContext['resources'] {
    return {
      total: 0,
      namespaces: 0,
      byKind: {},
      latestUpdatedAt: null,
      degraded: true,
    };
  }

  private fallbackAlerts(): AiClusterContext['alerts'] {
    return {
      activeTotal: 0,
      critical: 0,
      warning: 0,
      info: 0,
      items: [],
      degraded: true,
    };
  }

  private fallbackEvents(): AiClusterContext['events'] {
    return { total: 0, items: [], degraded: true };
  }

  private fallbackTopology(): AiClusterContext['topology'] {
    return {
      resourceCount: 0,
      relationCount: 0,
      resourcesByKind: {},
      relationsByType: {},
      warningRecords: 0,
      coverage: {},
      dataAsOf: null,
      freshness: 'unavailable',
      degraded: true,
    };
  }

  private normalizeTimeout(value?: number): number {
    if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
    return Math.min(10_000, Math.max(250, Math.trunc(value as number)));
  }

  private safeString(value: unknown): string {
    return sanitizeText(value) ?? 'unknown';
  }

  private safeOptionalString(value: unknown): string | null {
    return sanitizeText(value);
  }

  private safeOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private async safeCall<T>(
    source: string,
    operation: () => Promise<T>,
    fallback: T,
    timeoutMs: number,
    degradedSources: string[],
  ): Promise<T> {
    try {
      return await withTimeout(operation(), timeoutMs);
    } catch (error) {
      degradedSources.push(source);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `ai context source degraded source=${source} reason=${sanitizeText(message)}`,
      );
      return fallback;
    }
  }

  /** Exported for the controller so supplemental evidence is safe even without the aggregator in unit tests. */
  static sanitizeEvidence(value: unknown): SafeRecord {
    return sanitizeEvidence(value);
  }
}

export function sanitizeEvidence(value: unknown, depth = 0): SafeRecord {
  const sanitized = sanitizeValue(value, depth);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_EVIDENCE_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return value;
  if (Array.isArray(value))
    return value
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  if (!isRecord(value)) return undefined;
  const output: SafeRecord = {};
  for (const [key, entry] of Object.entries(value).slice(
    0,
    MAX_EVIDENCE_KEYS,
  )) {
    output[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : sanitizeValue(entry, depth + 1);
  }
  return output;
}

export function sanitizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(PEM_PRIVATE_KEY, '[REDACTED]')
    .replace(JWT_VALUE, '[REDACTED]')
    .replace(PROVIDER_KEY_VALUE, '[REDACTED]')
    .replace(BEARER_VALUE, '$1[REDACTED]')
    .replace(KEY_VALUE_SECRET, '$1[REDACTED]')
    .replace(URL_WITH_SECRET_QUERY, '$1[REDACTED]')
    .slice(0, MAX_STRING_LENGTH);
}

function mapAlerts(result: AlertsResponse): AiClusterContext['alerts'] {
  const items = result.items.slice(0, MAX_ALERTS).map((item) => ({
    severity: sanitizeText(item.severity) ?? 'unknown',
    title: sanitizeText(item.title) ?? 'untitled alert',
    message: sanitizeText(item.message) ?? '',
    namespace: sanitizeText(item.namespace),
    resourceType: sanitizeText(item.resourceType),
    resourceName: sanitizeText(item.resourceName),
    firedAt: item.firedAt,
  }));
  return {
    activeTotal: result.total,
    critical: items.filter((item) => item.severity === 'critical').length,
    warning: items.filter((item) => item.severity === 'warning').length,
    info: items.filter((item) => item.severity === 'info').length,
    items,
    degraded: result.degraded,
  };
}

function mapEvents(
  result: MonitoringEventsResponse,
): AiClusterContext['events'] {
  return {
    total: result.total,
    items: result.items.slice(0, MAX_EVENTS).map((item) => ({
      level: sanitizeText(item.level) ?? 'INFO',
      source: sanitizeText(item.source) ?? 'unknown',
      message: sanitizeText(item.message) ?? '',
      timestamp: item.timestamp,
    })),
    degraded: result.degraded,
  };
}

function mapTopology(
  graph: TopologyGraphV2Response,
): AiClusterContext['topology'] {
  const resourcesByKind: Record<string, number> = {};
  for (const resource of graph.resources)
    resourcesByKind[resource.kind] = (resourcesByKind[resource.kind] ?? 0) + 1;
  const relationsByType: Record<string, number> = {};
  for (const relation of graph.relations)
    relationsByType[relation.type] = (relationsByType[relation.type] ?? 0) + 1;
  const coverage: AiClusterContext['topology']['coverage'] = {};
  for (const [source, item] of Object.entries(graph.coverage.sources))
    coverage[source] = {
      records: item.records,
      status: item.status,
      dataAsOf: item.dataAsOf,
    };
  return {
    resourceCount: graph.resources.length,
    relationCount: graph.relations.length,
    resourcesByKind: sortCounts(resourcesByKind),
    relationsByType: sortCounts(relationsByType),
    warningRecords: graph.coverage.warningRecords,
    coverage,
    dataAsOf: graph.dataAsOf,
    freshness: graph.freshness.status,
    degraded:
      graph.freshness.status !== 'fresh' ||
      Object.values(coverage).some((item) => item.status !== 'complete'),
  };
}

function sortCounts(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function isRecord(value: unknown): value is SafeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('AI_CONTEXT_TIMEOUT')),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
