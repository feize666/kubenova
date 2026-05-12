import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';
import {
  type ClusterItemResponse,
  type ClusterState,
  ClustersService,
} from './clusters.service';
import { K8sClientService } from './k8s-client.service';

export type HealthProbeSource = 'auto' | 'manual' | 'event';
export type RuntimeStatus =
  | 'running'
  | 'offline'
  | 'checking'
  | 'disabled'
  | 'offline-mode';

export interface ClusterHealthSnapshotView {
  clusterId: string;
  ok: boolean;
  status: RuntimeStatus;
  latencyMs: number | null;
  checkedAt: string;
  reason: string | null;
  source: HealthProbeSource;
  timeoutMs: number;
  failureCount: number;
  detailJson: Record<string, unknown> | null;
  isStale: boolean;
}

export interface ClusterHealthListQuery {
  keyword?: string;
  provider?: string;
  environment?: string;
  lifecycleState?: ClusterState;
  runtimeStatus?: RuntimeStatus;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ClusterHealthListItem {
  clusterId: string;
  clusterName: string;
  lifecycleState: ClusterState;
  runtimeStatus: RuntimeStatus;
  ok: boolean | null;
  latencyMs: number | null;
  checkedAt: string | null;
  reason: string | null;
  source: HealthProbeSource | null;
  isStale: boolean;
}

export interface ClusterHealthListResponse {
  items: ClusterHealthListItem[];
  page: number;
  pageSize: number;
  total: number;
  timestamp: string;
}

export interface ClusterHealthDetailResponse {
  summary: ClusterHealthListItem;
  detail: {
    timeoutMs: number | null;
    failureCount: number | null;
    payload: Record<string, unknown> | null;
  };
}

export interface LegacyHealthResult {
  ok: boolean;
  latencyMs: number;
  version: string | null;
  nodeCount: number | null;
  message: string;
}

export interface ProbeOptions {
  source?: HealthProbeSource;
  timeoutMs?: number;
  bypassBackoff?: boolean;
}

interface ProbePayload {
  ok: boolean;
  latencyMs: number | null;
  reason: string | null;
  detailJson: Record<string, unknown> | null;
}

function toJsonInput(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | undefined {
  if (!value) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class ClusterHealthService {
  private readonly logger = new Logger(ClusterHealthService.name);
  private readonly defaultTimeoutMs = 8000;
  private readonly freshnessWindowMs = 90_000;
  private readonly maxBackoffMs = 60_000;
  private readonly inFlight = new Map<
    string,
    Promise<ClusterHealthSnapshotView>
  >();
  private readonly backoffUntil = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clustersService: ClustersService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async listClusterHealth(
    query: ClusterHealthListQuery,
  ): Promise<ClusterHealthListResponse> {
    const list = await this.clustersService.list({
      keyword: query.keyword,
      provider: query.provider,
      environment: query.environment,
      state: query.lifecycleState,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    const clusterIds = list.items.map((item) => item.id);
    const snapshots =
      clusterIds.length > 0
        ? await this.prisma.clusterHealthSnapshot.findMany({
            where: { clusterId: { in: clusterIds } },
          })
        : [];

    const snapshotMap = new Map(snapshots.map((row) => [row.clusterId, row]));
    const filteredItems = list.items
      .map((cluster) => {
        const snapshot = snapshotMap.get(cluster.id);
        const runtimeStatus = this.resolveRuntimeStatus({
          state: cluster.state,
          hasKubeconfig: Boolean(cluster.hasKubeconfig),
          snapshot: snapshot
            ? { ok: snapshot.ok, checkedAt: snapshot.checkedAt }
            : null,
          isProbing: this.inFlight.has(cluster.id),
        });
        const isStale = snapshot ? this.isStale(snapshot.checkedAt) : true;
        return {
          clusterId: cluster.id,
          clusterName: cluster.name,
          lifecycleState: cluster.state,
          runtimeStatus,
          ok: snapshot ? snapshot.ok : null,
          latencyMs: snapshot?.latencyMs ?? null,
          checkedAt: snapshot?.checkedAt.toISOString() ?? null,
          reason: snapshot?.reason ?? (snapshot ? null : '等待首个探测结果'),
          source: snapshot ? this.normalizeSource(snapshot.source) : null,
          isStale,
        } satisfies ClusterHealthListItem;
      })
      .filter((item) =>
        query.runtimeStatus ? item.runtimeStatus === query.runtimeStatus : true,
      );
    const items = this.sortHealthItems(
      filteredItems,
      query.sortBy,
      query.sortOrder,
    );

    return {
      items,
      page: list.page,
      pageSize: list.pageSize,
      total: items.length,
      timestamp: new Date().toISOString(),
    };
  }

  private sortHealthItems(
    items: ClusterHealthListItem[],
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): ClusterHealthListItem[] {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const field = (sortBy ?? '').trim();
    return [...items].sort((left, right) => {
      if (field === 'clusterName' || field === 'name') {
        const cmp = left.clusterName.localeCompare(right.clusterName);
        if (cmp !== 0) return cmp * direction;
      }
      if (field === 'runtimeStatus') {
        const cmp = left.runtimeStatus.localeCompare(right.runtimeStatus);
        if (cmp !== 0) return cmp * direction;
      }
      if (field === 'checkedAt' || field === 'updatedAt') {
        const leftTime = left.checkedAt ? Date.parse(left.checkedAt) : 0;
        const rightTime = right.checkedAt ? Date.parse(right.checkedAt) : 0;
        if (leftTime !== rightTime) return (leftTime - rightTime) * direction;
      }
      if (field === 'latencyMs') {
        const leftMs = left.latencyMs ?? Number.MAX_SAFE_INTEGER;
        const rightMs = right.latencyMs ?? Number.MAX_SAFE_INTEGER;
        if (leftMs !== rightMs) return (leftMs - rightMs) * direction;
      }
      return left.clusterName.localeCompare(right.clusterName);
    });
  }

  async getClusterHealthDetail(
    clusterId: string,
  ): Promise<ClusterHealthDetailResponse> {
    const cluster = await this.requireCluster(clusterId);
    const snapshot = await this.prisma.clusterHealthSnapshot.findUnique({
      where: { clusterId },
    });
    const runtimeStatus = this.resolveRuntimeStatus({
      state: cluster.state,
      hasKubeconfig: Boolean(cluster.hasKubeconfig),
      snapshot: snapshot
        ? { ok: snapshot.ok, checkedAt: snapshot.checkedAt }
        : null,
      isProbing: this.inFlight.has(clusterId),
    });

    return {
      summary: {
        clusterId: cluster.id,
        clusterName: cluster.name,
        lifecycleState: cluster.state,
        runtimeStatus,
        ok: snapshot?.ok ?? null,
        latencyMs: snapshot?.latencyMs ?? null,
        checkedAt: snapshot?.checkedAt.toISOString() ?? null,
        reason: snapshot?.reason ?? (snapshot ? null : '等待首个探测结果'),
        source: snapshot ? this.normalizeSource(snapshot.source) : null,
        isStale: snapshot ? this.isStale(snapshot.checkedAt) : true,
      },
      detail: {
        timeoutMs: snapshot?.timeoutMs ?? null,
        failureCount: snapshot?.failureCount ?? null,
        payload: this.parseDetail(snapshot?.detailJson),
      },
    };
  }

  async getLegacyHealthResult(clusterId: string): Promise<LegacyHealthResult> {
    const cluster = await this.requireCluster(clusterId);
    const latest = await this.getLatestSnapshot(clusterId);
    const snapshot =
      latest && !latest.isStale
        ? latest
        : await this.probeCluster(clusterId, {
            source: 'auto',
          });
    const detail = snapshot.detailJson ?? {};
    const version =
      typeof detail.version === 'string'
        ? detail.version
        : (cluster.kubernetesVersion ?? null);
    const nodeCount =
      typeof detail.nodeCount === 'number' ? detail.nodeCount : null;

    if (snapshot.status === 'offline-mode') {
      return {
        ok: true,
        latencyMs: snapshot.latencyMs ?? 0,
        version,
        nodeCount,
        message: '离线模式，无法验证真实连接状态',
      };
    }

    if (snapshot.ok) {
      return {
        ok: true,
        latencyMs: snapshot.latencyMs ?? 0,
        version,
        nodeCount,
        message: '集群连接正常',
      };
    }

    const fallbackReason =
      snapshot.reason ??
      (typeof detail.message === 'string' ? detail.message : '连接失败');
    return {
      ok: false,
      latencyMs: snapshot.latencyMs ?? 0,
      version: null,
      nodeCount,
      message: `集群连接异常: ${fallbackReason}`,
    };
  }

  async assertClusterOnlineForRead(clusterId: string): Promise<void> {
    const cluster = await this.requireCluster(clusterId);
    if (cluster.state !== 'active') {
      throw new BadRequestException('集群未处于 active 状态，禁止读取资源数据');
    }
    if (!cluster.hasKubeconfig) {
      throw new BadRequestException(
        '集群未配置 kubeconfig，无法读取在线资源数据',
      );
    }

    const snapshot = await this.getLatestSnapshot(clusterId);
    if (!snapshot || snapshot.isStale) {
      void this.probeCluster(clusterId, {
        source: 'auto',
        timeoutMs: 5_000,
      });
    }
  }

  async getLatestSnapshot(
    clusterId: string,
  ): Promise<ClusterHealthSnapshotView | null> {
    const row = await this.prisma.clusterHealthSnapshot.findUnique({
      where: { clusterId },
    });
    if (!row) {
      return null;
    }
    return {
      clusterId: row.clusterId,
      ok: row.ok,
      status: this.normalizeRuntimeStatus(row.status),
      latencyMs: row.latencyMs ?? null,
      checkedAt: row.checkedAt.toISOString(),
      reason: row.reason ?? null,
      source: this.normalizeSource(row.source),
      timeoutMs: row.timeoutMs,
      failureCount: row.failureCount,
      detailJson: this.parseDetail(row.detailJson),
      isStale: this.isStale(row.checkedAt),
    };
  }

  async listReadableClusterIdsForResourceRead(): Promise<string[]> {
    return this.listSelectableClusterIdsForResourceRead();
  }

  async listSelectableClusterIdsForResourceRead(): Promise<string[]> {
    const health = await this.listClusterHealth({
      lifecycleState: 'active',
      runtimeStatus: 'running',
      page: '1',
      pageSize: '500',
    });
    return health.items.map((item) => item.clusterId);
  }

  async listClustersNeedingBackgroundProbe(
    maxAgeMs = 10 * 60_000,
  ): Promise<string[]> {
    const list = await this.clustersService.list({
      state: 'active',
      page: '1',
      pageSize: '500',
    });
    const targets = list.items.filter(
      (item) => item.state === 'active' && item.hasKubeconfig,
    );
    if (targets.length === 0) {
      return [];
    }

    const rows = await this.prisma.clusterHealthSnapshot.findMany({
      where: {
        clusterId: { in: targets.map((item) => item.id) },
      },
      select: {
        clusterId: true,
        checkedAt: true,
      },
    });
    const snapshotMap = new Map(
      rows.map((row) => [row.clusterId, row.checkedAt]),
    );
    const staleBoundary = Date.now() - maxAgeMs;
    return targets
      .filter((item) => {
        const checkedAt = snapshotMap.get(item.id);
        return !checkedAt || checkedAt.getTime() < staleBoundary;
      })
      .map((item) => item.id);
  }

  async probeCluster(
    clusterId: string,
    options: ProbeOptions = {},
  ): Promise<ClusterHealthSnapshotView> {
    const existing = this.inFlight.get(clusterId);
    if (existing) {
      return existing;
    }

    const task = this.runProbe(clusterId, options).finally(() => {
      this.inFlight.delete(clusterId);
    });

    this.inFlight.set(clusterId, task);
    return task;
  }

  resolveRuntimeStatus(input: {
    state: ClusterState;
    hasKubeconfig: boolean;
    snapshot?: { ok: boolean; checkedAt: Date } | null;
    isProbing?: boolean;
  }): RuntimeStatus {
    if (input.state === 'disabled') {
      return 'disabled';
    }
    if (!input.hasKubeconfig) {
      return 'offline-mode';
    }
    if (input.isProbing) {
      return 'checking';
    }
    if (!input.snapshot) {
      return 'checking';
    }
    return input.snapshot.ok ? 'running' : 'offline';
  }

  private async listAllActiveClusters(): Promise<ClusterItemResponse[]> {
    const pageSize = 500;
    const items: ClusterItemResponse[] = [];
    let page = 1;

    for (;;) {
      const list = await this.clustersService.list({
        state: 'active',
        page: String(page),
        pageSize: String(pageSize),
      });
      items.push(...list.items);
      if (list.items.length < pageSize) {
        break;
      }
      page += 1;
    }

    return items;
  }

  private async runProbe(
    clusterId: string,
    options: ProbeOptions,
  ): Promise<ClusterHealthSnapshotView> {
    const source = options.source ?? 'manual';
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const cluster = await this.requireCluster(clusterId);
    const probeId = `probe_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const now = Date.now();
    const nextAllowedAt = this.backoffUntil.get(clusterId) ?? 0;
    if (source === 'auto' && !options.bypassBackoff && now < nextAllowedAt) {
      this.logger.log(
        `health-probe skip_backoff probeId=${probeId} clusterId=${clusterId} source=${source} nextAllowedAt=${new Date(
          nextAllowedAt,
        ).toISOString()}`,
      );
      const snapshot = await this.getLatestSnapshot(clusterId);
      if (snapshot) {
        return snapshot;
      }
    }

    this.logger.log(
      `health-probe start probeId=${probeId} clusterId=${clusterId} source=${source} timeoutMs=${timeoutMs}`,
    );

    let payload: ProbePayload;
    let status: RuntimeStatus;
    let failureCount = 0;

    if (cluster.state === 'disabled') {
      status = 'disabled';
      payload = {
        ok: false,
        latencyMs: 0,
        reason: 'CLUSTER_DISABLED',
        detailJson: { message: 'cluster is disabled' },
      };
    } else if (!cluster.hasKubeconfig) {
      status = 'offline-mode';
      payload = {
        ok: true,
        latencyMs: 0,
        reason: 'OFFLINE_MODE',
        detailJson: { message: 'kubeconfig not configured' },
      };
    } else {
      const probeResult = await this.probeConnectedCluster(cluster, timeoutMs);
      status = probeResult.ok ? 'running' : 'offline';
      payload = probeResult;
      const latest = await this.prisma.clusterHealthSnapshot.findUnique({
        where: { clusterId },
        select: { failureCount: true },
      });
      failureCount = probeResult.ok ? 0 : (latest?.failureCount ?? 0) + 1;
      if (!probeResult.ok) {
        const backoffMs = Math.min(
          2 ** Math.min(failureCount, 6) * 1000,
          this.maxBackoffMs,
        );
        this.backoffUntil.set(clusterId, Date.now() + backoffMs);
        this.logger.warn(
          `health-probe backoff probeId=${probeId} clusterId=${clusterId} failureCount=${failureCount} backoffMs=${backoffMs}`,
        );
      } else {
        this.backoffUntil.delete(clusterId);
      }
    }

    const row = await this.prisma.clusterHealthSnapshot.upsert({
      where: { clusterId },
      create: {
        clusterId,
        ok: payload.ok,
        status,
        latencyMs: payload.latencyMs,
        checkedAt: new Date(),
        reason: payload.reason,
        source,
        timeoutMs,
        failureCount,
        detailJson: toJsonInput(payload.detailJson),
      },
      update: {
        ok: payload.ok,
        status,
        latencyMs: payload.latencyMs,
        checkedAt: new Date(),
        reason: payload.reason,
        source,
        timeoutMs,
        failureCount,
        detailJson: toJsonInput(payload.detailJson),
      },
    });

    const reasonText = row.reason ?? 'NONE';
    if (row.ok) {
      this.logger.log(
        `health-probe success probeId=${probeId} clusterId=${clusterId} source=${source} latencyMs=${row.latencyMs ?? 0} status=${row.status}`,
      );
    } else {
      this.logger.warn(
        `health-probe failure probeId=${probeId} clusterId=${clusterId} source=${source} latencyMs=${row.latencyMs ?? 0} status=${row.status} reason=${reasonText}`,
      );
    }

    return {
      clusterId: row.clusterId,
      ok: row.ok,
      status: this.normalizeRuntimeStatus(row.status),
      latencyMs: row.latencyMs ?? null,
      checkedAt: row.checkedAt.toISOString(),
      reason: row.reason ?? null,
      source: this.normalizeSource(row.source),
      timeoutMs: row.timeoutMs,
      failureCount: row.failureCount,
      detailJson: this.parseDetail(row.detailJson),
      isStale: this.isStale(row.checkedAt),
    };
  }

  private async requireCluster(
    clusterId: string,
  ): Promise<ClusterItemResponse> {
    const cluster = await this.clustersService.findById(clusterId);
    if (!cluster) {
      throw new NotFoundException(`未找到集群: ${clusterId}`);
    }
    return cluster;
  }

  private async probeConnectedCluster(
    cluster: ClusterItemResponse,
    timeoutMs: number,
  ): Promise<ProbePayload> {
    const kubeconfig = await this.clustersService.getKubeconfig(cluster.id);
    if (!kubeconfig) {
      return {
        ok: false,
        latencyMs: 0,
        reason: 'KUBECONFIG_MISSING',
        detailJson: { message: 'kubeconfig not found' },
      };
    }

    const startedAt = Date.now();
    try {
      const result = await this.withTimeout(
        this.fetchClusterVersionAndNodeCount(kubeconfig),
        timeoutMs,
      );
      const latencyMs = Date.now() - startedAt;
      return {
        ok: true,
        latencyMs,
        reason: null,
        detailJson: {
          version: result.version,
          nodeCount: result.nodeCount,
        },
      };
    } catch (error: unknown) {
      const latencyMs = Math.min(Date.now() - startedAt, timeoutMs);
      const message = error instanceof Error ? error.message : 'probe failed';
      const isTimeout = message === 'PROBE_TIMEOUT';
      this.logger.warn(
        `cluster probe failed: clusterId=${cluster.id} reason=${message}`,
      );
      return {
        ok: false,
        latencyMs,
        reason: isTimeout ? 'PROBE_TIMEOUT' : 'API_UNREACHABLE',
        detailJson: { message },
      };
    }
  }

  private async fetchClusterVersionAndNodeCount(
    kubeconfig: string,
  ): Promise<{ version: string; nodeCount: number | null }> {
    const kc = this.k8sClientService.createClient(kubeconfig);
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const versionResp = await (
      versionApi as unknown as { getCode: () => Promise<unknown> }
    ).getCode();
    const versionInfo =
      versionResp &&
      typeof versionResp === 'object' &&
      'body' in (versionResp as Record<string, unknown>) &&
      (versionResp as { body?: { gitVersion?: string } }).body
        ? (versionResp as { body: { gitVersion?: string } }).body
        : (versionResp as { gitVersion?: string });

    let nodeCount: number | null = null;
    try {
      const nodes = await coreApi.listNode();
      nodeCount = nodes.items.length;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`cluster node count probe degraded: reason=${message}`);
      nodeCount = null;
    }

    return {
      version: versionInfo?.gitVersion ?? 'unknown',
      nodeCount,
    };
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('PROBE_TIMEOUT')),
        timeoutMs,
      );
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private isStale(checkedAt: Date): boolean {
    return Date.now() - checkedAt.getTime() > this.freshnessWindowMs;
  }

  private normalizeRuntimeStatus(value: string): RuntimeStatus {
    if (
      value === 'running' ||
      value === 'offline' ||
      value === 'checking' ||
      value === 'disabled' ||
      value === 'offline-mode'
    ) {
      return value;
    }
    return 'checking';
  }

  private normalizeSource(value: string): HealthProbeSource {
    if (value === 'auto' || value === 'manual' || value === 'event') {
      return value;
    }
    return 'manual';
  }

  private parseDetail(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
