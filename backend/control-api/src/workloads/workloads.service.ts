import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { Prisma } from '@prisma/client';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import {
  NetworkService,
  type CreateNetworkResourceRequest,
} from '../network/network.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import { ClustersService } from '../clusters/clusters.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { PrismaService } from '../platform/database/prisma.service';
import {
  StorageService,
  type CreateStorageResourceRequest,
} from '../storage/storage.service';
import {
  LiveMetricsService,
  type LiveUsageSnapshot,
  type ClusterLiveUsageSnapshot,
} from '../metrics/live-metrics.service';
import {
  WorkloadsRepository,
  type WorkloadRecord,
  type WorkloadListParams,
} from './workloads.repository';
import {
  mapWorkspaceErrorCode,
  workspaceIssue,
  type WorkloadWorkspaceValidationIssue,
} from './workspace-validation';

// ── 公开类型（controller 使用）────────────────────────────

export interface WorkloadsListQuery {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  keyword?: string;
  state?: string;
  page?: string;
  pageSize?: string;
}

export interface WorkloadActionPayload {
  replicas?: number;
  spec?: Prisma.InputJsonValue;
}

export interface WorkloadCreateDto {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  replicas?: number;
  readyReplicas?: number;
  spec?: Prisma.InputJsonValue;
  statusJson?: Prisma.InputJsonValue;
  labels?: Prisma.InputJsonValue;
  annotations?: Prisma.InputJsonValue;
}

export interface WorkloadUpdateDto {
  namespace?: string;
  kind?: string;
  name?: string;
  state?: 'active' | 'disabled' | 'deleted';
  replicas?: number;
  readyReplicas?: number;
  spec?: Prisma.JsonValue;
  statusJson?: Prisma.JsonValue;
  labels?: Prisma.JsonValue;
  annotations?: Prisma.JsonValue;
}

export interface WorkloadListResponse {
  items: WorkloadRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface LegacyWorkloadItem {
  kind: string;
  name: string;
  clusterId: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'Degraded' | 'Failed';
  ready: string;
  replicas: string;
  restarts: number;
  age: string;
  state: 'active' | 'disabled' | 'deleted';
  version: number;
  suspended: boolean;
  policyEnabled: boolean;
}

export interface LegacyWorkloadsListResponse {
  kind: string;
  items: LegacyWorkloadItem[];
  total: number;
  timestamp: string;
}

export interface WorkloadActionResponse {
  id: string;
  action: string;
  accepted: boolean;
  message: string;
  record: WorkloadRecord;
  scaleResult?: {
    desiredReplicas: number;
    observedReplicas: number | null;
    readyReplicas: number | null;
    availableReplicas: number | null;
    phase: string | null;
    status: 'accepted' | 'converging' | 'stable' | 'timeout';
    observedAt: string;
    observedState: {
      desiredReplicas: number;
      observedReplicas: number | null;
      readyReplicas: number | null;
      availableReplicas: number | null;
      phase: string | null;
      status: 'accepted' | 'converging' | 'stable' | 'timeout';
      observedAt: string;
    };
  };
  timestamp: string;
}

export interface WorkloadWorkspaceStorageMountDto {
  storageSourceType?: 'PVC' | 'PV' | 'SC';
  useExistingPvc?: boolean;
  existingPvcName?: string;
  existingPvName?: string;
  existingStorageClassName?: string;
  newPvcName?: string;
  newPvcCapacity?: string;
  newPvcStorageClass?: string;
  mountPath?: string;
}

export interface WorkloadWorkspaceServiceDto {
  name?: string;
  type?: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  containerPort?: number;
  servicePort?: number;
}

export interface WorkloadWorkspaceIngressDto {
  name?: string;
  host?: string;
  path?: string;
  ingressClassName?: string;
}

export interface WorkloadWorkspaceIngressRouteDto {
  name?: string;
  entryPoints?: string;
  match?: string;
  middlewares?: string;
  tlsSecretName?: string;
  serviceName?: string;
  servicePort?: number;
}

export interface WorkloadWorkspaceInitContainerDto {
  name?: string;
  image?: string;
  command?: string;
  args?: string;
}

export interface WorkloadWorkspaceSchedulingDto {
  nodeSelector?: string;
  tolerations?: string;
  affinity?: string;
}

export type WorkloadWorkspaceProbeType = 'httpGet' | 'tcpSocket' | 'exec';

export interface WorkloadWorkspaceProbeDto {
  enabled?: boolean;
  type?: WorkloadWorkspaceProbeType;
  path?: string;
  port?: number;
  scheme?: 'HTTP' | 'HTTPS';
  command?: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

export interface WorkloadWorkspaceProbesDto {
  liveness?: WorkloadWorkspaceProbeDto;
  readiness?: WorkloadWorkspaceProbeDto;
  startup?: WorkloadWorkspaceProbeDto;
}

export interface WorkloadWorkspaceRequest {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
  replicas?: number;
  containerName?: string;
  image?: string;
  command?: string;
  args?: string;
  mountPvc?: boolean;
  pvcMount?: WorkloadWorkspaceStorageMountDto;
  createService?: boolean;
  service?: WorkloadWorkspaceServiceDto;
  createIngress?: boolean;
  networkMode?: 'ingress' | 'ingressroute';
  ingress?: WorkloadWorkspaceIngressDto;
  ingressRoute?: WorkloadWorkspaceIngressRouteDto;
  initContainers?: WorkloadWorkspaceInitContainerDto[];
  scheduling?: WorkloadWorkspaceSchedulingDto;
  probes?: WorkloadWorkspaceProbesDto;
}

export interface WorkloadWorkspaceValidateResponse {
  valid: boolean;
  errors: WorkloadWorkspaceValidationIssue[];
  warnings: WorkloadWorkspaceValidationIssue[];
  timestamp: string;
}

export interface WorkloadWorkspaceSubmitResponse {
  workload: WorkloadRecord;
  createdResources: {
    pvc?: unknown;
    service?: unknown;
    ingress?: unknown;
  };
  summary: {
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
  };
  timestamp: string;
}

export interface WorkloadWorkspaceRenderedManifest {
  kind: string;
  apiVersion: string;
  name: string;
  namespace?: string;
  source: 'workload' | 'pvc' | 'service' | 'ingress';
  yaml: string;
}

export interface WorkloadWorkspaceRenderYamlResponse {
  summary: {
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    image: string;
    createPvc: boolean;
    createService: boolean;
    createIngress: boolean;
  };
  manifests: WorkloadWorkspaceRenderedManifest[];
  yaml: string;
  timestamp: string;
}

interface NormalizedWorkspaceExecutionInput {
  input: WorkloadWorkspaceRequest;
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
}

interface PodLiveMetricsStatus {
  capturedAt: string;
  source: 'metrics-server' | 'cluster-metrics-cache' | 'none';
  available: boolean;
  freshnessWindowMs: number;
  cpuUsage: number | null;
  memoryUsage: number | null;
  history: Array<{
    timestamp: string;
    cpuUsage: number | null;
    memoryUsage: number | null;
  }>;
  note?: string;
}

// ── Service ───────────────────────────────────────────────

@Injectable()
export class WorkloadsService {
  private readonly logger = new Logger(WorkloadsService.name);
  private readonly workloadsSyncAt = new Map<string, number>();

  constructor(
    private readonly repository: WorkloadsRepository,
    private readonly storageService: StorageService,
    private readonly networkService: NetworkService,
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clusterEventSyncService: ClusterEventSyncService,
    private readonly k8sClientService: K8sClientService,
    private readonly liveMetricsService: LiveMetricsService,
    private readonly prisma: PrismaService,
  ) {}

  private normalizeKind(kind: string): string {
    const k = kind.trim().toLowerCase();
    const map: Record<string, string> = {
      pod: 'Pod',
      pods: 'Pod',
      deployment: 'Deployment',
      deployments: 'Deployment',
      statefulset: 'StatefulSet',
      statefulsets: 'StatefulSet',
      daemonset: 'DaemonSet',
      daemonsets: 'DaemonSet',
      replicaset: 'ReplicaSet',
      replicasets: 'ReplicaSet',
      job: 'Job',
      jobs: 'Job',
      cronjob: 'CronJob',
      cronjobs: 'CronJob',
    };
    return map[k] ?? kind;
  }

  isLegacyKind(kind: string): boolean {
    return this.normalizeKind(kind) !== kind;
  }

  async list(query: WorkloadsListQuery): Promise<WorkloadListResponse> {
    const normalizedClusterId = query.clusterId?.trim();
    let readableClusterIds: string[] | undefined;
    if (normalizedClusterId) {
      await this.clusterHealthService.assertClusterOnlineForRead(
        normalizedClusterId,
      );
    } else {
      readableClusterIds =
        await this.clusterHealthService.listReadableClusterIdsForResourceRead();
      if (readableClusterIds.length === 0) {
        return {
          items: [],
          total: 0,
          page: this.parsePositiveInt(query.page, 1),
          pageSize: this.parsePositiveInt(query.pageSize, 10),
          timestamp: new Date().toISOString(),
        };
      }
    }

    const params: WorkloadListParams = {
      clusterId: normalizedClusterId,
      clusterIds: readableClusterIds,
      namespace: query.namespace,
      kind: query.kind ? this.normalizeKind(query.kind) : undefined,
      keyword: query.keyword,
      state: query.state,
      page: this.parsePositiveInt(query.page, 1),
      pageSize: this.parsePositiveInt(query.pageSize, 10),
    };

    const result = await this.repository.list(params);
    void this.refreshWorkloadSyncState(normalizedClusterId, readableClusterIds);
    const items =
      params.kind === 'Pod'
        ? await this.safeEnrichPodListWithLiveMetrics(result.items)
        : result.items;
    return {
      ...result,
      items,
      timestamp: new Date().toISOString(),
    };
  }

  private async refreshWorkloadSyncState(
    normalizedClusterId: string | undefined,
    readableClusterIds: string[] | undefined,
  ): Promise<void> {
    if (normalizedClusterId) {
      void this.ensureClusterWorkloadsSynced(normalizedClusterId);
      return;
    }

    if (readableClusterIds?.length) {
      void Promise.allSettled(
        readableClusterIds.map((clusterId) =>
          this.ensureClusterWorkloadsSynced(clusterId),
        ),
      );
    }
  }

  private async enrichPodListWithLiveMetrics(
    items: WorkloadRecord[],
  ): Promise<WorkloadRecord[]> {
    if (items.length === 0) {
      return items;
    }

    const targets = new Map<string, { clusterId: string; namespace: string }>();
    for (const item of items) {
      if (!item.clusterId || !item.namespace) {
        continue;
      }
      const key = `${item.clusterId}::${item.namespace}`;
      if (!targets.has(key)) {
        targets.set(key, {
          clusterId: item.clusterId,
          namespace: item.namespace,
        });
      }
    }

    const snapshots = new Map<string, ClusterLiveUsageSnapshot>();
    await Promise.allSettled(
      [...targets.entries()].map(async ([key, target]) => {
        try {
          const kubeconfig = await this.clustersService.getKubeconfig(
            target.clusterId,
          );
          if (!kubeconfig) {
            return;
          }
          const snapshot = await this.withTimeout(
            this.liveMetricsService.getClusterSnapshot(
              target.clusterId,
              kubeconfig,
              target.namespace,
            ),
            3000,
          );
          snapshots.set(key, snapshot);
        } catch (error) {
          this.logger.warn(
            `pod live metrics enrich failed for cluster ${target.clusterId} namespace ${target.namespace}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );

    return items.map((item) => {
      const snapshot = snapshots.get(`${item.clusterId}::${item.namespace}`);
      if (!snapshot) {
        return item;
      }
      const podSnapshot = snapshot.pods.find(
        (pod) =>
          pod.podName === item.name &&
          pod.clusterId === item.clusterId &&
          pod.namespace === item.namespace,
      );
      const liveMetrics = this.buildPodLiveMetricsStatus(snapshot, podSnapshot);
      const existingStatus =
        item.statusJson &&
        typeof item.statusJson === 'object' &&
        !Array.isArray(item.statusJson)
          ? (item.statusJson as Record<string, unknown>)
          : {};
      const liveMetricsJson = {
        capturedAt: liveMetrics.capturedAt,
        source: liveMetrics.source,
        available: liveMetrics.available,
        freshnessWindowMs: liveMetrics.freshnessWindowMs,
        cpuUsage: liveMetrics.cpuUsage,
        memoryUsage: liveMetrics.memoryUsage,
        history: liveMetrics.history.map((entry) => ({
          timestamp: entry.timestamp,
          cpuUsage: entry.cpuUsage,
          memoryUsage: entry.memoryUsage,
        })),
        note: liveMetrics.note,
      };
      return {
        ...item,
        statusJson: {
          ...existingStatus,
          liveMetrics: liveMetricsJson,
          usageMetrics: liveMetricsJson,
        },
      };
    });
  }

  private async safeEnrichPodListWithLiveMetrics(
    items: WorkloadRecord[],
  ): Promise<WorkloadRecord[]> {
    try {
      return await this.enrichPodListWithLiveMetrics(items);
    } catch (error) {
      this.logger.warn(
        `pod live metrics enrich skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return items;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private buildPodLiveMetricsStatus(
    snapshot: ClusterLiveUsageSnapshot,
    podSnapshot?: LiveUsageSnapshot,
  ): PodLiveMetricsStatus {
    if (podSnapshot) {
      return {
        capturedAt: podSnapshot.capturedAt,
        source: podSnapshot.source,
        available: podSnapshot.available,
        freshnessWindowMs: podSnapshot.freshnessWindowMs,
        cpuUsage: podSnapshot.cpuUsage,
        memoryUsage: podSnapshot.memoryUsage,
        history: podSnapshot.history,
        note: podSnapshot.note,
      };
    }

    return {
      capturedAt: snapshot.capturedAt,
      source: snapshot.source,
      available: false,
      freshnessWindowMs: snapshot.freshnessWindowMs,
      cpuUsage: null,
      memoryUsage: null,
      history: [],
      note:
        snapshot.note ??
        '当前 Pod 未返回实时指标，可能尚未同步到 metrics-server',
    };
  }

  private async ensureClusterWorkloadsSynced(clusterId: string): Promise<void> {
    const now = Date.now();
    const last = this.workloadsSyncAt.get(clusterId) ?? 0;
    const dirty = this.clusterEventSyncService.consumeClusterDirty(clusterId);
    if (!dirty && now - last < 2_000) {
      return;
    }

    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return;
    }

    const result = await this.clusterSyncService.syncCluster(
      clusterId,
      kubeconfig,
    );
    const workloadErrors = result.errors.filter(
      (item) =>
        item.includes('Pods') ||
        item.includes('Deployments') ||
        item.includes('ReplicaSets') ||
        item.includes('StatefulSets') ||
        item.includes('DaemonSets') ||
        item.includes('Jobs') ||
        item.includes('CronJobs'),
    );
    if (workloadErrors.length > 0) {
      this.logger.warn(
        `workload sync failed for cluster ${clusterId}: ${workloadErrors.join(' | ')}`,
      );
    }
    this.workloadsSyncAt.set(clusterId, now);
  }

  async getById(id: string): Promise<WorkloadRecord> {
    const record = await this.repository.findById(id);
    if (!record) {
      throw new NotFoundException(`工作负载 ${id} 不存在`);
    }
    return record;
  }

  async getByKindAndName(
    kind: string,
    name: string,
    identity: { clusterId?: string; namespace?: string },
  ): Promise<WorkloadRecord> {
    const clusterId = identity.clusterId?.trim();
    const namespace = identity.namespace?.trim();
    if (!clusterId || !namespace) {
      throw new BadRequestException('clusterId 和 namespace 是必填字段');
    }
    const record = await this.repository.findByKey(
      clusterId,
      namespace,
      this.normalizeKind(kind),
      name,
    );
    if (!record) {
      throw new NotFoundException(`工作负载 ${kind}/${name} 不存在`);
    }
    return record;
  }

  async listByLegacyKind(
    kind: string,
    query: Omit<WorkloadsListQuery, 'kind'>,
  ): Promise<LegacyWorkloadsListResponse> {
    const normalizedKind = this.normalizeKind(kind);
    const result = await this.list({ ...query, kind: normalizedKind });
    return {
      kind: kind.toLowerCase(),
      total: result.total,
      timestamp: result.timestamp,
      items: result.items.map((item) => this.toLegacyItem(item)),
    };
  }

  async applyActionByKindAndName(
    kind: string,
    name: string,
    action: string,
    identity: {
      clusterId?: string;
      namespace?: string;
      payload?: WorkloadActionPayload;
    },
  ): Promise<WorkloadActionResponse> {
    const record = await this.getByKindAndName(kind, name, identity);
    return this.applyAction(record.id, action, identity.payload);
  }

  async applyAction(
    id: string,
    action: string,
    payload?: WorkloadActionPayload,
  ): Promise<WorkloadActionResponse> {
    const existing = await this.getById(id);

    if (existing.state === 'deleted') {
      throw new BadRequestException('已删除工作负载不可执行动作');
    }

    const SUPPORTED_ACTIONS = [
      'enable',
      'disable',
      'delete',
      'restart',
      'scale',
      'rollback',
    ] as const;
    type ActionType = (typeof SUPPORTED_ACTIONS)[number];

    if (!SUPPORTED_ACTIONS.includes(action as ActionType)) {
      throw new BadRequestException(
        `action 必须为 ${SUPPORTED_ACTIONS.join('、')}`,
      );
    }

    const now = new Date().toISOString();
    let updated: WorkloadRecord;
    let scaleResultPayload:
      | {
          desiredReplicas: number;
          observedReplicas: number | null;
          readyReplicas: number | null;
          availableReplicas: number | null;
          phase: string | null;
          status: 'accepted' | 'converging' | 'stable' | 'timeout';
          observedAt: string;
          observedState: {
            desiredReplicas: number;
            observedReplicas: number | null;
            readyReplicas: number | null;
            availableReplicas: number | null;
            phase: string | null;
            status: 'accepted' | 'converging' | 'stable' | 'timeout';
            observedAt: string;
          };
        }
      | undefined;

    switch (action as ActionType) {
      case 'enable':
        updated = await this.repository.setState(id, 'active');
        break;

      case 'disable':
        updated = await this.repository.setState(id, 'disabled');
        break;

      case 'delete':
        await this.deleteWorkloadInCluster(existing);
        updated = await this.repository.setState(id, 'deleted');
        break;

      case 'restart': {
        const existingStatus =
          existing.statusJson &&
          typeof existing.statusJson === 'object' &&
          !Array.isArray(existing.statusJson)
            ? (existing.statusJson as Record<string, unknown>)
            : {};
        updated = await this.repository.update(id, {
          statusJson: {
            ...existingStatus,
            restartedAt: now,
          } as Prisma.JsonValue,
        });
        break;
      }

      case 'scale': {
        if (existing.state === 'disabled') {
          throw new BadRequestException('已禁用工作负载不可执行 scale');
        }
        if (payload?.replicas === undefined) {
          throw new BadRequestException('scale 动作必须提供 payload.replicas');
        }
        if (!Number.isInteger(payload.replicas) || payload.replicas < 0) {
          throw new BadRequestException('replicas 必须为大于等于 0 的整数');
        }
        if (
          !['Deployment', 'StatefulSet', 'ReplicaSet'].includes(existing.kind)
        ) {
          throw new BadRequestException(
            `当前仅支持 Deployment/StatefulSet/ReplicaSet 执行 scale，实际类型为 ${existing.kind}`,
          );
        }
        const scaleResult = await this.scaleAppsWorkload(
          existing,
          payload.replicas,
        );
        const convergenceStatus = this.deriveConvergenceStatus({
          desiredReplicas: payload.replicas,
          observedReplicas: scaleResult.observedReplicas,
          readyReplicas: scaleResult.readyReplicas,
          availableReplicas: scaleResult.availableReplicas,
        });
        scaleResultPayload = {
          desiredReplicas: payload.replicas,
          observedReplicas: scaleResult.observedReplicas,
          readyReplicas: scaleResult.readyReplicas,
          availableReplicas: scaleResult.availableReplicas,
          phase: scaleResult.phase,
          status: convergenceStatus,
          observedAt: now,
          observedState: {
            desiredReplicas: payload.replicas,
            observedReplicas: scaleResult.observedReplicas,
            readyReplicas: scaleResult.readyReplicas,
            availableReplicas: scaleResult.availableReplicas,
            phase: scaleResult.phase,
            status: convergenceStatus,
            observedAt: now,
          },
        };
        updated = await this.repository.update(id, {
          replicas: scaleResult.observedReplicas ?? payload.replicas,
          ...(scaleResult.readyReplicas !== null
            ? { readyReplicas: scaleResult.readyReplicas }
            : {}),
        });
        break;
      }

      case 'rollback': {
        if (!payload?.spec) {
          throw new BadRequestException('rollback 动作必须提供 payload.spec');
        }
        updated = await this.repository.update(id, {
          spec: payload.spec as Prisma.JsonValue,
          statusJson: { rolledBackAt: now } as Prisma.JsonValue,
        });
        break;
      }
    }

    return {
      id,
      action,
      accepted: true,
      message: `已接收 ${action} 请求: ${existing.name}`,
      record: updated!,
      ...(scaleResultPayload ? { scaleResult: scaleResultPayload } : {}),
      timestamp: now,
    };
  }

  async create(dto: WorkloadCreateDto): Promise<WorkloadRecord> {
    const normalizedSpec = this.normalizeCreateSpec(dto.spec);
    await this.createWorkloadInCluster({
      ...dto,
      ...(normalizedSpec ? { spec: normalizedSpec } : {}),
    });
    return this.repository.create({
      ...dto,
      ...(normalizedSpec ? { spec: normalizedSpec } : {}),
    });
  }

  async update(id: string, dto: WorkloadUpdateDto): Promise<WorkloadRecord> {
    const existing = await this.getById(id);
    if (
      dto.namespace &&
      dto.namespace.trim() &&
      dto.namespace.trim() !== existing.namespace
    ) {
      await this.moveWorkloadNamespaceInCluster(existing, dto.namespace.trim());
    }
    return this.repository.update(id, dto);
  }

  async validateWorkspace(
    body: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceValidateResponse> {
    const prepared = this.prepareWorkspaceExecutionInput(body);
    return this.validateWorkspaceNormalized(prepared.input);
  }

  private async validateWorkspaceNormalized(
    input: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceValidateResponse> {
    const errors: WorkloadWorkspaceValidationIssue[] = [];
    const warnings: WorkloadWorkspaceValidationIssue[] = [];
    const clusterId = input.clusterId;
    const namespace = input.namespace;
    const name = input.name;
    const image = input.image;
    const kind = input.kind;

    if (!clusterId)
      errors.push(workspaceIssue('basic', 'clusterId', '请选择集群'));
    if (!namespace)
      errors.push(workspaceIssue('basic', 'namespace', '请输入名称空间'));
    if (!kind) errors.push(workspaceIssue('basic', 'kind', '请选择资源类型'));
    if (!name) errors.push(workspaceIssue('basic', 'name', '请输入名称'));
    if (!image)
      errors.push(workspaceIssue('image', 'image', '请输入主容器镜像'));

    const nodeSelectorRaw = input.scheduling?.nodeSelector?.trim();
    if (nodeSelectorRaw) {
      const parsedNodeSelector = this.parseNodeSelector(nodeSelectorRaw);
      if (!parsedNodeSelector.ok) {
        errors.push(
          workspaceIssue(
            'advanced',
            'scheduling.nodeSelector',
            parsedNodeSelector.message,
          ),
        );
      }
    }

    const tolerationsRaw = input.scheduling?.tolerations?.trim();
    if (tolerationsRaw) {
      const parsedTolerations = this.parseJsonValue(
        tolerationsRaw,
        'tolerations',
      );
      if (!parsedTolerations.ok) {
        errors.push(
          workspaceIssue(
            'advanced',
            'scheduling.tolerations',
            parsedTolerations.message,
          ),
        );
      } else if (!Array.isArray(parsedTolerations.value)) {
        errors.push(
          workspaceIssue(
            'advanced',
            'scheduling.tolerations',
            'tolerations 必须为 JSON 数组',
          ),
        );
      }
    }

    const affinityRaw = input.scheduling?.affinity?.trim();
    if (affinityRaw) {
      const parsedAffinity = this.parseJsonValue(affinityRaw, 'affinity');
      if (!parsedAffinity.ok) {
        errors.push(
          workspaceIssue(
            'advanced',
            'scheduling.affinity',
            parsedAffinity.message,
          ),
        );
      } else if (
        !parsedAffinity.value ||
        typeof parsedAffinity.value !== 'object' ||
        Array.isArray(parsedAffinity.value)
      ) {
        errors.push(
          workspaceIssue(
            'advanced',
            'scheduling.affinity',
            'affinity 必须为 JSON 对象',
          ),
        );
      }
    }

    const probeValidationErrors = this.validateWorkspaceProbes(input.probes);
    errors.push(...probeValidationErrors);

    if (clusterId && namespace && kind && name) {
      const cluster = await this.findAvailableCluster(clusterId);
      if (!cluster) {
        errors.push(
          workspaceIssue('basic', 'clusterId', '所选集群不可用，请重新选择'),
        );
      }

      const duplicate = await this.repository.findByKey(
        clusterId,
        namespace,
        this.normalizeKind(kind),
        name,
      );
      if (duplicate) {
        errors.push(
          workspaceIssue(
            'basic',
            'name',
            kind + ' ' + namespace + '/' + name + ' 已存在',
          ),
        );
      }
    }

    if (input.mountPvc) {
      const mountPath = input.pvcMount?.mountPath;
      const sourceType = input.pvcMount?.storageSourceType ?? 'PVC';
      if (!mountPath)
        errors.push(
          workspaceIssue('storage', 'pvcMount.mountPath', '请输入挂载路径'),
        );
      if (input.pvcMount?.useExistingPvc) {
        if (sourceType === 'PVC') {
          if (!input.pvcMount.existingPvcName) {
            errors.push(
              workspaceIssue(
                'storage',
                'pvcMount.existingPvcName',
                '请选择已有 PVC',
              ),
            );
          } else if (clusterId && namespace) {
            const scopedPvc = await this.findScopedPvc(
              clusterId,
              namespace,
              input.pvcMount.existingPvcName,
            );
            if (!scopedPvc) {
              errors.push(
                workspaceIssue(
                  'storage',
                  'pvcMount.existingPvcName',
                  `在集群 ${clusterId} / 名称空间 ${namespace} 中未找到 PVC ${input.pvcMount.existingPvcName}，请刷新后重选`,
                ),
              );
            }
          }
        } else if (sourceType === 'PV') {
          if (!input.pvcMount.existingPvName) {
            errors.push(
              workspaceIssue(
                'storage',
                'pvcMount.existingPvName',
                '请选择已有 PV',
              ),
            );
          } else if (clusterId) {
            const pv = await this.findClusterStorageResource(
              clusterId,
              'PV',
              input.pvcMount.existingPvName,
            );
            if (!pv) {
              errors.push(
                workspaceIssue(
                  'storage',
                  'pvcMount.existingPvName',
                  `在集群 ${clusterId} 中未找到 PV ${input.pvcMount.existingPvName}，请刷新后重选`,
                ),
              );
            }
          }
        } else {
          if (!input.pvcMount.existingStorageClassName) {
            errors.push(
              workspaceIssue(
                'storage',
                'pvcMount.existingStorageClassName',
                '请选择 StorageClass',
              ),
            );
          } else if (clusterId) {
            const sc = await this.findClusterStorageResource(
              clusterId,
              'SC',
              input.pvcMount.existingStorageClassName,
            );
            if (!sc) {
              errors.push(
                workspaceIssue(
                  'storage',
                  'pvcMount.existingStorageClassName',
                  `在集群 ${clusterId} 中未找到 StorageClass ${input.pvcMount.existingStorageClassName}，请刷新后重选`,
                ),
              );
            }
          }
        }
      } else if (!input.pvcMount?.newPvcName) {
        errors.push(
          workspaceIssue('storage', 'pvcMount.newPvcName', '请输入新 PVC 名称'),
        );
      }
    }

    if (input.createService) {
      if (!input.service?.name)
        errors.push(
          workspaceIssue('network', 'service.name', '请输入 Service 名称'),
        );
      if (!input.service?.containerPort)
        errors.push(
          workspaceIssue('network', 'service.containerPort', '请输入容器端口'),
        );
      if (!input.service?.servicePort)
        errors.push(
          workspaceIssue(
            'network',
            'service.servicePort',
            '请输入 Service 端口',
          ),
        );
    }

    if (input.createIngress) {
      const networkMode = input.networkMode ?? 'ingress';
      if (!input.createService)
        errors.push(
          workspaceIssue(
            'network',
            'createIngress',
            '创建 Ingress 前必须启用 Service',
          ),
        );
      if (networkMode === 'ingressroute') {
        if (!input.ingressRoute?.name) {
          errors.push(
            workspaceIssue(
              'network',
              'ingressRoute.name',
              '请输入 IngressRoute 名称',
            ),
          );
        }
        if (!input.ingressRoute?.entryPoints) {
          errors.push(
            workspaceIssue(
              'network',
              'ingressRoute.entryPoints',
              '请输入 entryPoints',
            ),
          );
        }
        if (!input.ingressRoute?.match) {
          errors.push(
            workspaceIssue(
              'network',
              'ingressRoute.match',
              '请输入路由匹配表达式',
            ),
          );
        }
        if (clusterId) {
          const capabilityError =
            await this.checkIngressRouteCapability(clusterId);
          if (capabilityError) {
            errors.push(
              workspaceIssue(
                'network',
                'networkMode',
                capabilityError,
                'INGRESSROUTE_CRD_MISSING',
              ),
            );
          }
        }
      } else {
        if (!input.ingress?.name)
          errors.push(
            workspaceIssue('network', 'ingress.name', '请输入 Ingress 名称'),
          );
        if (!input.ingress?.host)
          errors.push(
            workspaceIssue('network', 'ingress.host', '请输入 Ingress Host'),
          );
      }
    }

    (input.initContainers ?? []).forEach((item, index) => {
      if ((item.name && !item.image) || (!item.name && item.image)) {
        errors.push(
          workspaceIssue(
            'init',
            'initContainers.' + index,
            '初始化容器名称和镜像必须同时提供',
          ),
        );
      }
    });

    if (
      clusterId &&
      namespace &&
      kind === 'StatefulSet' &&
      !input.createService
    ) {
      warnings.push(
        workspaceIssue(
          'network',
          'createService',
          'StatefulSet 通常建议搭配 Service 使用',
        ),
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      timestamp: new Date().toISOString(),
    };
  }

  async submitWorkspace(
    body: WorkloadWorkspaceRequest,
    actor?: {
      username?: string;
      role?: import('../common/governance').PlatformRole;
    },
  ): Promise<WorkloadWorkspaceSubmitResponse> {
    const prepared = this.prepareWorkspaceExecutionInput(body);
    const input = prepared.input;
    const validation = await this.validateWorkspaceNormalized(input);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '工作区校验失败',
        details: validation,
      });
    }

    const clusterId = prepared.clusterId!;
    const namespace = prepared.namespace!;
    const kind = prepared.kind!;
    const name = prepared.name!;
    if (!(await this.findAvailableCluster(clusterId))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '工作区提交失败',
        details: {
          valid: false,
          errors: [
            workspaceIssue('basic', 'clusterId', '所选集群不可用，请重新选择'),
          ],
          warnings: [],
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (
      input.createIngress &&
      (input.networkMode ?? 'ingress') === 'ingressroute'
    ) {
      const capabilityError = await this.checkIngressRouteCapability(clusterId);
      if (capabilityError) {
        throw new BadRequestException({
          code: 'INGRESSROUTE_CRD_MISSING',
          message: '工作区提交失败',
          details: {
            valid: false,
            errors: [
              workspaceIssue(
                'network',
                'networkMode',
                capabilityError,
                'INGRESSROUTE_CRD_MISSING',
              ),
            ],
            warnings: [],
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const mountPlan = await this.resolveWorkspaceMountPlan(input, name);

    let pvc: unknown;
    let service: unknown;
    let ingress: unknown;
    let workload: WorkloadRecord;

    try {
      if (mountPlan.createPvc) {
        const storagePayload: CreateStorageResourceRequest = {
          clusterId,
          namespace,
          kind: 'PVC',
          name: mountPlan.createPvc.name,
          capacity: mountPlan.createPvc.capacity,
          storageClass: mountPlan.createPvc.storageClass,
          spec: mountPlan.createPvc.volumeName
            ? { volumeName: mountPlan.createPvc.volumeName }
            : undefined,
        };
        pvc = await this.storageService.create(storagePayload, actor);
      }

      workload = await this.create({
        clusterId,
        namespace,
        kind,
        name,
        ...(kind === 'Deployment' ||
        kind === 'StatefulSet' ||
        kind === 'ReplicaSet'
          ? { replicas: input.replicas ?? 1 }
          : {}),
        spec: this.buildWorkspaceSpec(input, mountPlan.claimName),
      });

      if (input.createService && input.service?.name) {
        const networkPayload: CreateNetworkResourceRequest = {
          clusterId,
          namespace,
          kind: 'Service',
          name: input.service.name,
          spec: {
            type: input.service.type ?? 'ClusterIP',
            selector: { app: name },
            ports: [
              {
                port: input.service.servicePort,
                targetPort: input.service.containerPort,
              },
            ],
          },
        };
        service = await this.networkService.create(networkPayload, actor);
      }

      if (input.createIngress && input.service?.name) {
        const networkMode = input.networkMode ?? 'ingress';
        if (networkMode === 'ingressroute' && input.ingressRoute?.name) {
          const entryPoints = (input.ingressRoute.entryPoints ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          const middlewares = (input.ingressRoute.middlewares ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

          const ingressRoutePayload: CreateNetworkResourceRequest = {
            clusterId,
            namespace,
            kind: 'IngressRoute',
            name: input.ingressRoute.name,
            spec: {
              entryPoints,
              routes: [
                {
                  match: input.ingressRoute.match,
                  kind: 'Rule',
                  services: [
                    {
                      name:
                        input.ingressRoute.serviceName ?? input.service.name,
                      port:
                        input.ingressRoute.servicePort ??
                        input.service.servicePort,
                    },
                  ],
                  ...(middlewares.length > 0
                    ? {
                        middlewares: middlewares.map((name) => ({ name })),
                      }
                    : {}),
                },
              ],
              ...(input.ingressRoute.tlsSecretName
                ? { tls: { secretName: input.ingressRoute.tlsSecretName } }
                : {}),
            },
          };
          ingress = await this.networkService.create(
            ingressRoutePayload,
            actor,
          );
        } else if (input.ingress?.name) {
          const ingressPayload: CreateNetworkResourceRequest = {
            clusterId,
            namespace,
            kind: 'Ingress',
            name: input.ingress.name,
            spec: {
              ...(input.ingress.ingressClassName
                ? { ingressClassName: input.ingress.ingressClassName }
                : {}),
              rules: [
                {
                  host: input.ingress.host,
                  http: {
                    paths: [
                      {
                        path: input.ingress.path || '/',
                        pathType: 'Prefix',
                        backend: {
                          service: {
                            name: input.service.name,
                            port: { number: input.service.servicePort },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          };
          ingress = await this.networkService.create(ingressPayload, actor);
        }
      }
    } catch (error) {
      const code = mapWorkspaceErrorCode(error);
      const clusterIssue = this.tryMapClusterIssue(error);
      const issue = clusterIssue
        ? workspaceIssue('basic', 'clusterId', clusterIssue, code)
        : workspaceIssue(
            'submit',
            'submit',
            this.resolveErrorMessage(error),
            code,
          );
      throw new BadRequestException({
        code,
        message: '工作区提交失败',
        details: {
          valid: false,
          errors: [issue],
          warnings: [],
          timestamp: new Date().toISOString(),
        },
      });
    }

    return {
      workload: workload!,
      createdResources: { pvc, service, ingress },
      summary: { clusterId, namespace, kind, name },
      timestamp: new Date().toISOString(),
    };
  }

  async renderWorkspaceYaml(
    body: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceRenderYamlResponse> {
    const prepared = this.prepareWorkspaceExecutionInput(body);
    const input = prepared.input;
    const validation = await this.validateWorkspaceNormalized(input);
    if (!validation.valid) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '工作区校验失败',
        details: validation,
      });
    }

    const clusterId = prepared.clusterId!;
    const namespace = prepared.namespace!;
    const kind = prepared.kind!;
    const name = prepared.name!;
    const mountPlan = await this.resolveWorkspaceMountPlan(input, name);

    if (!(await this.findAvailableCluster(clusterId))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '工作区校验失败',
        details: {
          valid: false,
          errors: [
            workspaceIssue('basic', 'clusterId', '所选集群不可用，请重新选择'),
          ],
          warnings: [],
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (
      input.createIngress &&
      (input.networkMode ?? 'ingress') === 'ingressroute'
    ) {
      const capabilityError = await this.checkIngressRouteCapability(clusterId);
      if (capabilityError) {
        throw new BadRequestException({
          code: 'INGRESSROUTE_CRD_MISSING',
          message: '工作区校验失败',
          details: {
            valid: false,
            errors: [
              workspaceIssue(
                'network',
                'networkMode',
                capabilityError,
                'INGRESSROUTE_CRD_MISSING',
              ),
            ],
            warnings: [],
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const manifests = this.buildWorkspaceManifests(
      input,
      {
        clusterId,
        namespace,
        kind,
        name,
      },
      mountPlan,
    );

    const docs = manifests.map((item) => item.yaml);

    return {
      summary: {
        clusterId,
        namespace,
        kind,
        name,
        image: input.image!,
        createPvc: Boolean(mountPlan.createPvc),
        createService: Boolean(input.createService && input.service?.name),
        createIngress: Boolean(input.createIngress && input.ingress?.name),
      },
      manifests,
      yaml: docs.join('\n---\n'),
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeWorkspaceRequest(
    body: WorkloadWorkspaceRequest,
  ): WorkloadWorkspaceRequest {
    const trim = (value: string | undefined): string | undefined => {
      const text = value?.trim();
      return text || undefined;
    };

    return {
      ...body,
      clusterId: trim(body.clusterId),
      namespace: trim(body.namespace),
      kind: trim(body.kind),
      name: trim(body.name),
      containerName: trim(body.containerName),
      image: trim(body.image),
      command: trim(body.command),
      args: trim(body.args),
      pvcMount: body.pvcMount
        ? {
            ...body.pvcMount,
            storageSourceType:
              body.pvcMount.storageSourceType === 'PV' ||
              body.pvcMount.storageSourceType === 'SC'
                ? body.pvcMount.storageSourceType
                : 'PVC',
            existingPvcName: trim(body.pvcMount.existingPvcName),
            existingPvName: trim(body.pvcMount.existingPvName),
            existingStorageClassName: trim(
              body.pvcMount.existingStorageClassName,
            ),
            newPvcName: trim(body.pvcMount.newPvcName),
            newPvcCapacity: trim(body.pvcMount.newPvcCapacity),
            newPvcStorageClass: trim(body.pvcMount.newPvcStorageClass),
            mountPath: trim(body.pvcMount.mountPath),
          }
        : undefined,
      service: body.service
        ? {
            ...body.service,
            name: trim(body.service.name),
          }
        : undefined,
      ingress: body.ingress
        ? {
            ...body.ingress,
            name: trim(body.ingress.name),
            host: trim(body.ingress.host),
            path: trim(body.ingress.path),
            ingressClassName: trim(body.ingress.ingressClassName),
          }
        : undefined,
      networkMode:
        body.networkMode === 'ingressroute' ? 'ingressroute' : 'ingress',
      ingressRoute: body.ingressRoute
        ? {
            ...body.ingressRoute,
            name: trim(body.ingressRoute.name),
            entryPoints: trim(body.ingressRoute.entryPoints),
            match: trim(body.ingressRoute.match),
            middlewares: trim(body.ingressRoute.middlewares),
            tlsSecretName: trim(body.ingressRoute.tlsSecretName),
            serviceName: trim(body.ingressRoute.serviceName),
          }
        : undefined,
      scheduling: body.scheduling
        ? {
            nodeSelector: trim(body.scheduling.nodeSelector),
            tolerations: trim(body.scheduling.tolerations),
            affinity: trim(body.scheduling.affinity),
          }
        : undefined,
      probes: body.probes
        ? {
            liveness: this.normalizeWorkspaceProbe(body.probes.liveness),
            readiness: this.normalizeWorkspaceProbe(body.probes.readiness),
            startup: this.normalizeWorkspaceProbe(body.probes.startup),
          }
        : undefined,
      initContainers: (body.initContainers ?? []).map((item) => ({
        ...item,
        name: trim(item.name),
        image: trim(item.image),
        command: trim(item.command),
        args: trim(item.args),
      })),
    };
  }

  private prepareWorkspaceExecutionInput(
    body: WorkloadWorkspaceRequest,
  ): NormalizedWorkspaceExecutionInput {
    const input = this.normalizeWorkspaceRequest(body);
    return {
      input,
      clusterId: input.clusterId,
      namespace: input.namespace,
      kind: input.kind ? this.normalizeKind(input.kind) : undefined,
      name: input.name,
    };
  }

  private async findAvailableCluster(
    clusterId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.clusterRegistry.findFirst({
      where: {
        id: clusterId,
        deletedAt: null,
        status: { not: 'deleted' },
      },
      select: { id: true },
    });
  }

  private async checkIngressRouteCapability(
    clusterId: string,
  ): Promise<string | null> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return '集群未配置 kubeconfig，无法验证 IngressRoute CRD，请先完成集群接入';
    }

    try {
      const kc = this.k8sClientService.createClient(kubeconfig);
      const api = kc.makeApiClient(k8s.ApiextensionsV1Api);
      const resp = await api.listCustomResourceDefinition();
      const names = resp.items
        .map((item) => item.metadata?.name ?? '')
        .filter(Boolean);
      const hasIngressRoute =
        names.includes('ingressroutes.traefik.io') ||
        names.includes('ingressroutes.traefik.containo.us');
      if (hasIngressRoute) {
        return null;
      }
      return '当前集群未安装 IngressRoute CRD（ingressroutes.traefik.io），请先安装 Traefik CRD 或切换为 Ingress 模式';
    } catch (error) {
      return `IngressRoute CRD 探测失败：${this.resolveErrorMessage(error)}。请检查集群连通与权限`;
    }
  }

  private async findScopedPvc(
    clusterId: string,
    namespace: string,
    pvcName: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.storageResource.findFirst({
      where: {
        clusterId,
        namespace,
        kind: 'PVC',
        name: pvcName,
        state: { not: 'deleted' },
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
        },
      },
      select: { id: true },
    });
  }

  private async findClusterStorageResource(
    clusterId: string,
    kind: 'PV' | 'SC',
    name: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.storageResource.findFirst({
      where: {
        clusterId,
        kind,
        name,
        state: { not: 'deleted' },
        cluster: {
          deletedAt: null,
          status: { not: 'deleted' },
        },
      },
      select: { id: true },
    });
  }

  private async resolveWorkspaceMountPlan(
    body: WorkloadWorkspaceRequest,
    workloadName: string,
  ): Promise<{
    claimName?: string;
    createPvc?: {
      name: string;
      capacity?: string;
      storageClass?: string;
      volumeName?: string;
    };
  }> {
    if (!body.mountPvc) {
      return {};
    }

    const mount = body.pvcMount;
    if (!mount) {
      return {};
    }

    const sourceType = mount.storageSourceType ?? 'PVC';
    const useExisting = Boolean(mount.useExistingPvc);

    if (useExisting && sourceType === 'PVC') {
      if (!mount.existingPvcName) {
        return {};
      }
      return { claimName: mount.existingPvcName };
    }

    if (useExisting && sourceType === 'PV') {
      const pvName = mount.existingPvName;
      if (!pvName) {
        return {};
      }
      const fallbackName = this.toDns1123Name(
        `${workloadName}-${pvName}-claim`,
      );
      const pvcName = mount.newPvcName ?? fallbackName;
      return {
        claimName: pvcName,
        createPvc: {
          name: pvcName,
          capacity: mount.newPvcCapacity,
          storageClass: mount.newPvcStorageClass,
          volumeName: pvName,
        },
      };
    }

    if (useExisting && sourceType === 'SC') {
      const scName = mount.existingStorageClassName;
      if (!scName) {
        return {};
      }
      const fallbackName = this.toDns1123Name(
        `${workloadName}-${scName}-claim`,
      );
      const pvcName = mount.newPvcName ?? fallbackName;
      return {
        claimName: pvcName,
        createPvc: {
          name: pvcName,
          capacity: mount.newPvcCapacity,
          storageClass: scName,
        },
      };
    }

    if (!useExisting && mount.newPvcName) {
      return {
        claimName: mount.newPvcName,
        createPvc: {
          name: mount.newPvcName,
          capacity: mount.newPvcCapacity,
          storageClass: mount.newPvcStorageClass,
        },
      };
    }

    return {};
  }

  private toDns1123Name(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    const fallback = normalized || 'workspace-pvc';
    return fallback.slice(0, 63);
  }

  private tryMapClusterIssue(error: unknown): string | null {
    const message = this.resolveErrorMessage(error).toLowerCase();
    if (message.includes('cluster') || message.includes('集群')) {
      return '所选集群不可用，请重新选择';
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        return '所选集群不存在，请重新选择';
      }
    }

    return null;
  }

  private buildWorkspaceSpec(
    body: WorkloadWorkspaceRequest,
    mountedClaimName?: string,
  ): Prisma.InputJsonValue {
    const labels = { app: body.name!.trim() };
    const mainContainer = this.buildWorkspaceContainerSpec({
      name: body.containerName?.trim() || 'main',
      image: body.image!.trim(),
      command: body.command,
      args: body.args,
      probes: body.probes,
    });
    const initContainers = (body.initContainers ?? [])
      .filter((item) => item.name?.trim() && item.image?.trim())
      .map((item) =>
        this.buildWorkspaceContainerSpec({
          name: item.name!.trim(),
          image: item.image!.trim(),
          command: item.command,
          args: item.args,
        }),
      );
    const volumeMounts = [];
    const volumes = [];
    if (body.mountPvc && body.pvcMount?.mountPath?.trim()) {
      const claimName = mountedClaimName?.trim();
      if (claimName) {
        volumeMounts.push({
          name: 'workspace-pvc',
          mountPath: body.pvcMount.mountPath.trim(),
        });
        volumes.push({
          name: 'workspace-pvc',
          persistentVolumeClaim: { claimName },
        });
      }
    }
    const schedulingPatch = this.buildWorkspaceSchedulingSpec(body.scheduling);
    const podSpec = {
      containers: [
        {
          ...mainContainer,
          ...(volumeMounts.length > 0 ? { volumeMounts } : {}),
        },
      ],
      ...(initContainers.length > 0 ? { initContainers } : {}),
      ...(volumes.length > 0 ? { volumes } : {}),
      ...schedulingPatch,
    };
    if (body.kind === 'Pod') return podSpec as Prisma.InputJsonValue;
    if (body.kind === 'Deployment') {
      return {
        replicas: body.replicas ?? 1,
        selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: podSpec },
      } as Prisma.InputJsonValue;
    }
    if (body.kind === 'StatefulSet')
      return {
        replicas: body.replicas ?? 1,
        serviceName: body.name!.trim(),
        selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: podSpec },
      } as Prisma.InputJsonValue;
    if (body.kind === 'ReplicaSet')
      return {
        replicas: body.replicas ?? 1,
        selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: podSpec },
      } as Prisma.InputJsonValue;
    return {
      selector: { matchLabels: labels },
      template: { metadata: { labels }, spec: podSpec },
    } as Prisma.InputJsonValue;
  }

  private parseNodeSelector(
    raw: string,
  ):
    | { ok: true; value: Record<string, string> }
    | { ok: false; message: string } {
    const result: Record<string, string> = {};
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx <= 0 || idx === line.length - 1) {
        return {
          ok: false,
          message: `nodeSelector 格式错误：${line}（应为 key=value）`,
        };
      }
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key || !value) {
        return {
          ok: false,
          message: `nodeSelector 格式错误：${line}（应为 key=value）`,
        };
      }
      result[key] = value;
    }
    return { ok: true, value: result };
  }

  private parseJsonValue(
    raw: string,
    field: string,
  ): { ok: true; value: unknown } | { ok: false; message: string } {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return {
        ok: false,
        message: `${field} 不是合法 JSON：${
          error instanceof Error ? error.message : '解析失败'
        }`,
      };
    }
  }

  private normalizeWorkspaceProbe(
    probe: WorkloadWorkspaceProbeDto | undefined,
  ): WorkloadWorkspaceProbeDto | undefined {
    if (!probe) {
      return undefined;
    }
    const trim = (value: string | undefined): string | undefined => {
      const text = value?.trim();
      return text || undefined;
    };
    return {
      ...probe,
      type:
        probe.type === 'tcpSocket' || probe.type === 'exec'
          ? probe.type
          : 'httpGet',
      path: trim(probe.path),
      scheme: probe.scheme === 'HTTPS' ? 'HTTPS' : 'HTTP',
      command: trim(probe.command),
    };
  }

  private validateWorkspaceProbes(
    probes: WorkloadWorkspaceProbesDto | undefined,
  ): WorkloadWorkspaceValidationIssue[] {
    if (!probes) {
      return [];
    }
    const issues: WorkloadWorkspaceValidationIssue[] = [];
    (
      [
        ['liveness', probes.liveness],
        ['readiness', probes.readiness],
        ['startup', probes.startup],
      ] as Array<[string, WorkloadWorkspaceProbeDto | undefined]>
    ).forEach(([name, probe]) => {
      if (!probe?.enabled) {
        return;
      }
      const baseField = `probes.${name}`;
      const type = probe.type ?? 'httpGet';
      if (type === 'httpGet') {
        if (!probe.path) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.path`,
              `${name} 探针需填写 Path`,
            ),
          );
        }
        if (!this.isValidProbePort(probe.port)) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.port`,
              `${name} 探针需填写合法端口（1-65535）`,
            ),
          );
        }
      } else if (type === 'tcpSocket') {
        if (!this.isValidProbePort(probe.port)) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.port`,
              `${name} 探针需填写合法端口（1-65535）`,
            ),
          );
        }
      } else if (type === 'exec') {
        if (!this.toWorkspaceTokens(probe.command)) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.command`,
              `${name} 探针需填写命令`,
            ),
          );
        }
      }

      const numericFields: Array<[keyof WorkloadWorkspaceProbeDto, number]> = [
        ['initialDelaySeconds', 0],
        ['periodSeconds', 1],
        ['timeoutSeconds', 1],
        ['successThreshold', 1],
        ['failureThreshold', 1],
      ];
      const maxMap: Partial<Record<keyof WorkloadWorkspaceProbeDto, number>> = {
        initialDelaySeconds: 3600,
        periodSeconds: 3600,
        timeoutSeconds: 3600,
        successThreshold: 300,
        failureThreshold: 300,
      };
      numericFields.forEach(([field, min]) => {
        const value = probe[field];
        if (value === undefined || value === null) {
          return;
        }
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          !Number.isInteger(value) ||
          value < min
        ) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.${String(field)}`,
              `${name} 探针 ${String(field)} 必须为不小于 ${min} 的整数`,
            ),
          );
          return;
        }
        const max = maxMap[field];
        if (max !== undefined && value > max) {
          issues.push(
            workspaceIssue(
              'advanced',
              `${baseField}.${String(field)}`,
              `${name} 探针 ${String(field)} 必须在 ${min}-${max} 范围内`,
            ),
          );
        }
      });

      if (
        typeof probe.timeoutSeconds === 'number' &&
        typeof probe.periodSeconds === 'number' &&
        Number.isInteger(probe.timeoutSeconds) &&
        Number.isInteger(probe.periodSeconds) &&
        probe.timeoutSeconds > probe.periodSeconds
      ) {
        issues.push(
          workspaceIssue(
            'advanced',
            `${baseField}.timeoutSeconds`,
            `${name} 探针 timeoutSeconds 不能大于 periodSeconds`,
          ),
        );
      }
    });
    return issues;
  }

  private isValidProbePort(port: number | undefined): boolean {
    return (
      typeof port === 'number' &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    );
  }

  private buildWorkspaceSchedulingSpec(
    scheduling: WorkloadWorkspaceSchedulingDto | undefined,
  ): Record<string, unknown> {
    if (!scheduling) {
      return {};
    }

    const patch: Record<string, unknown> = {};

    const nodeSelectorRaw = scheduling.nodeSelector?.trim();
    if (nodeSelectorRaw) {
      const parsed = this.parseNodeSelector(nodeSelectorRaw);
      if (parsed.ok && Object.keys(parsed.value).length > 0) {
        patch.nodeSelector = parsed.value;
      }
    }

    const tolerationsRaw = scheduling.tolerations?.trim();
    if (tolerationsRaw) {
      const parsed = this.parseJsonValue(tolerationsRaw, 'tolerations');
      if (parsed.ok && Array.isArray(parsed.value)) {
        patch.tolerations = parsed.value;
      }
    }

    const affinityRaw = scheduling.affinity?.trim();
    if (affinityRaw) {
      const parsed = this.parseJsonValue(affinityRaw, 'affinity');
      if (
        parsed.ok &&
        parsed.value &&
        typeof parsed.value === 'object' &&
        !Array.isArray(parsed.value)
      ) {
        patch.affinity = parsed.value as Record<string, unknown>;
      }
    }

    return patch;
  }

  private buildWorkspaceProbeSpec(
    probe: WorkloadWorkspaceProbeDto | undefined,
  ): Record<string, unknown> | undefined {
    if (!probe?.enabled) {
      return undefined;
    }
    const type = probe.type ?? 'httpGet';
    const common: Record<string, unknown> = {};
    if (
      typeof probe.initialDelaySeconds === 'number' &&
      Number.isInteger(probe.initialDelaySeconds) &&
      probe.initialDelaySeconds >= 0
    ) {
      common.initialDelaySeconds = probe.initialDelaySeconds;
    }
    if (
      typeof probe.periodSeconds === 'number' &&
      Number.isInteger(probe.periodSeconds) &&
      probe.periodSeconds >= 1
    ) {
      common.periodSeconds = probe.periodSeconds;
    }
    if (
      typeof probe.timeoutSeconds === 'number' &&
      Number.isInteger(probe.timeoutSeconds) &&
      probe.timeoutSeconds >= 1
    ) {
      common.timeoutSeconds = probe.timeoutSeconds;
    }
    if (
      typeof probe.successThreshold === 'number' &&
      Number.isInteger(probe.successThreshold) &&
      probe.successThreshold >= 1
    ) {
      common.successThreshold = probe.successThreshold;
    }
    if (
      typeof probe.failureThreshold === 'number' &&
      Number.isInteger(probe.failureThreshold) &&
      probe.failureThreshold >= 1
    ) {
      common.failureThreshold = probe.failureThreshold;
    }

    if (type === 'exec') {
      const command = this.toWorkspaceTokens(probe.command);
      if (!command) {
        return undefined;
      }
      return {
        exec: { command },
        ...common,
      };
    }

    if (type === 'tcpSocket') {
      if (!this.isValidProbePort(probe.port)) {
        return undefined;
      }
      return {
        tcpSocket: { port: probe.port },
        ...common,
      };
    }

    if (!this.isValidProbePort(probe.port) || !probe.path) {
      return undefined;
    }
    return {
      httpGet: {
        path: probe.path,
        port: probe.port,
        scheme: probe.scheme === 'HTTPS' ? 'HTTPS' : 'HTTP',
      },
      ...common,
    };
  }

  private buildWorkspaceManifests(
    body: WorkloadWorkspaceRequest,
    context: {
      clusterId: string;
      namespace: string;
      kind: string;
      name: string;
    },
    mountPlan: {
      claimName?: string;
      createPvc?: {
        name: string;
        capacity?: string;
        storageClass?: string;
        volumeName?: string;
      };
    },
  ): WorkloadWorkspaceRenderedManifest[] {
    const manifests: WorkloadWorkspaceRenderedManifest[] = [];
    const labels = { app: context.name };

    const workloadManifest = {
      apiVersion: this.resolveWorkloadApiVersion(context.kind),
      kind: context.kind,
      metadata: {
        name: context.name,
        namespace: context.namespace,
        labels,
      },
      spec: this.buildWorkspaceSpec(body, mountPlan.claimName),
    };

    manifests.push({
      kind: workloadManifest.kind,
      apiVersion: workloadManifest.apiVersion,
      name: context.name,
      namespace: context.namespace,
      source: 'workload',
      yaml: k8s.dumpYaml(workloadManifest),
    });

    if (mountPlan.createPvc) {
      const pvcManifest: Record<string, unknown> = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: {
          name: mountPlan.createPvc.name,
          namespace: context.namespace,
          labels,
        },
        spec: {
          accessModes: ['ReadWriteOnce'],
          resources: {
            requests: {
              storage: mountPlan.createPvc.capacity || '5Gi',
            },
          },
          ...(mountPlan.createPvc.storageClass
            ? { storageClassName: mountPlan.createPvc.storageClass }
            : {}),
          ...(mountPlan.createPvc.volumeName
            ? { volumeName: mountPlan.createPvc.volumeName }
            : {}),
        },
      };
      manifests.push({
        kind: 'PersistentVolumeClaim',
        apiVersion: 'v1',
        name: mountPlan.createPvc.name,
        namespace: context.namespace,
        source: 'pvc',
        yaml: k8s.dumpYaml(pvcManifest),
      });
    }

    if (body.createService && body.service?.name) {
      const serviceManifest = {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: {
          name: body.service.name,
          namespace: context.namespace,
          labels,
        },
        spec: {
          type: body.service.type ?? 'ClusterIP',
          selector: labels,
          ports: [
            {
              name: 'http',
              port: body.service.servicePort,
              targetPort: body.service.containerPort,
              protocol: 'TCP',
            },
          ],
        },
      };
      manifests.push({
        kind: 'Service',
        apiVersion: 'v1',
        name: body.service.name,
        namespace: context.namespace,
        source: 'service',
        yaml: k8s.dumpYaml(serviceManifest),
      });
    }

    if (body.createIngress && body.service?.name) {
      const networkMode = body.networkMode ?? 'ingress';
      if (networkMode === 'ingressroute' && body.ingressRoute?.name) {
        const entryPoints = (body.ingressRoute.entryPoints ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const middlewares = (body.ingressRoute.middlewares ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const ingressRouteManifest = {
          apiVersion: 'traefik.io/v1alpha1',
          kind: 'IngressRoute',
          metadata: {
            name: body.ingressRoute.name,
            namespace: context.namespace,
            labels,
          },
          spec: {
            entryPoints,
            routes: [
              {
                match: body.ingressRoute.match,
                kind: 'Rule',
                services: [
                  {
                    name: body.ingressRoute.serviceName ?? body.service.name,
                    port:
                      body.ingressRoute.servicePort ?? body.service.servicePort,
                  },
                ],
                ...(middlewares.length > 0
                  ? {
                      middlewares: middlewares.map((name) => ({ name })),
                    }
                  : {}),
              },
            ],
            ...(body.ingressRoute.tlsSecretName
              ? { tls: { secretName: body.ingressRoute.tlsSecretName } }
              : {}),
          },
        };
        manifests.push({
          kind: 'IngressRoute',
          apiVersion: 'traefik.io/v1alpha1',
          name: body.ingressRoute.name,
          namespace: context.namespace,
          source: 'ingress',
          yaml: k8s.dumpYaml(ingressRouteManifest),
        });
      } else if (body.ingress?.name) {
        const ingressManifest = {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: {
            name: body.ingress.name,
            namespace: context.namespace,
            labels,
          },
          spec: {
            ...(body.ingress.ingressClassName
              ? { ingressClassName: body.ingress.ingressClassName }
              : {}),
            rules: [
              {
                host: body.ingress.host,
                http: {
                  paths: [
                    {
                      path: body.ingress.path || '/',
                      pathType: 'Prefix',
                      backend: {
                        service: {
                          name: body.service.name,
                          port: { number: body.service.servicePort },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        };
        manifests.push({
          kind: 'Ingress',
          apiVersion: 'networking.k8s.io/v1',
          name: body.ingress.name,
          namespace: context.namespace,
          source: 'ingress',
          yaml: k8s.dumpYaml(ingressManifest),
        });
      }
    }

    return manifests;
  }

  private resolveWorkloadApiVersion(kind: string): string {
    if (kind === 'Pod') {
      return 'v1';
    }

    return 'apps/v1';
  }

  private buildWorkspaceContainerSpec(input: {
    name: string;
    image: string;
    command?: string;
    args?: string;
    probes?: WorkloadWorkspaceProbesDto;
  }): Record<string, unknown> {
    const livenessProbe = this.buildWorkspaceProbeSpec(input.probes?.liveness);
    const readinessProbe = this.buildWorkspaceProbeSpec(
      input.probes?.readiness,
    );
    const startupProbe = this.buildWorkspaceProbeSpec(input.probes?.startup);
    return {
      name: input.name,
      image: input.image,
      ...(this.toWorkspaceTokens(input.command)
        ? { command: this.toWorkspaceTokens(input.command) }
        : {}),
      ...(this.toWorkspaceTokens(input.args)
        ? { args: this.toWorkspaceTokens(input.args) }
        : {}),
      ...(livenessProbe ? { livenessProbe } : {}),
      ...(readinessProbe ? { readinessProbe } : {}),
      ...(startupProbe ? { startupProbe } : {}),
    };
  }

  private toWorkspaceTokens(raw?: string): string[] | undefined {
    const text = raw?.trim();
    if (!text) return undefined;
    const tokens = text
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return tokens.length > 0 ? tokens : undefined;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('分页参数必须为正整数');
    }
    return value;
  }

  private normalizeCreateSpec(
    input: Prisma.InputJsonValue | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }
    const cleaned = this.stripUndefinedDeep(input as Record<string, unknown>);
    if (!cleaned || Object.keys(cleaned).length === 0) {
      return undefined;
    }
    return cleaned as Prisma.InputJsonValue;
  }

  private stripUndefinedDeep(
    value: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || item === null) {
        continue;
      }
      if (Array.isArray(item)) {
        const list: unknown[] = [];
        for (const entry of item) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            list.push(entry);
            continue;
          }
          const nested = this.stripUndefinedDeep(
            entry as Record<string, unknown>,
          );
          if (nested) {
            list.push(nested);
          }
        }
        if (list.length > 0) {
          out[key] = list;
        }
        continue;
      }
      if (typeof item === 'object') {
        const nested = this.stripUndefinedDeep(item as Record<string, unknown>);
        if (nested && Object.keys(nested).length > 0) {
          out[key] = nested;
        }
        continue;
      }
      out[key] = item;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private async createWorkloadInCluster(dto: WorkloadCreateDto): Promise<void> {
    const kubeconfig = await this.repository.getClusterKubeconfig(
      dto.clusterId,
    );
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    const kind = this.normalizeKind(dto.kind);
    const namespace = dto.namespace;
    const name = dto.name;
    const rawSpec =
      dto.spec && typeof dto.spec === 'object' && !Array.isArray(dto.spec)
        ? (dto.spec as Record<string, unknown>)
        : {};

    const appsApi = this.k8sClientService.getAppsApi(kubeconfig) as any;
    const coreApi = this.k8sClientService.getCoreApi(kubeconfig) as any;
    const batchApi = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.BatchV1Api as never);

    const defaultTemplate = {
      metadata: { labels: { app: name } },
      spec: {
        containers: [{ name: 'main', image: 'nginx:alpine' }],
      },
    };

    try {
      if (kind === 'Deployment') {
        await appsApi.createNamespacedDeployment({
          namespace,
          body: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name, namespace },
            spec: {
              replicas: dto.replicas ?? 1,
              selector: { matchLabels: { app: name } },
              template: defaultTemplate,
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'StatefulSet') {
        await appsApi.createNamespacedStatefulSet({
          namespace,
          body: {
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            metadata: { name, namespace },
            spec: {
              serviceName: `${name}-svc`,
              replicas: dto.replicas ?? 1,
              selector: { matchLabels: { app: name } },
              template: defaultTemplate,
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'DaemonSet') {
        await appsApi.createNamespacedDaemonSet({
          namespace,
          body: {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name, namespace },
            spec: {
              selector: { matchLabels: { app: name } },
              template: defaultTemplate,
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'ReplicaSet') {
        await appsApi.createNamespacedReplicaSet({
          namespace,
          body: {
            apiVersion: 'apps/v1',
            kind: 'ReplicaSet',
            metadata: { name, namespace },
            spec: {
              replicas: dto.replicas ?? 1,
              selector: { matchLabels: { app: name } },
              template: defaultTemplate,
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'Job') {
        await (batchApi as any).createNamespacedJob({
          namespace,
          body: {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: { name, namespace },
            spec: {
              template: {
                ...defaultTemplate,
                spec: {
                  ...(defaultTemplate.spec ?? {}),
                  restartPolicy: 'OnFailure',
                },
              },
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'CronJob') {
        await (batchApi as any).createNamespacedCronJob({
          namespace,
          body: {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            metadata: { name, namespace },
            spec: {
              schedule: '*/5 * * * *',
              jobTemplate: {
                spec: {
                  template: {
                    ...defaultTemplate,
                    spec: {
                      ...(defaultTemplate.spec ?? {}),
                      restartPolicy: 'OnFailure',
                    },
                  },
                },
              },
              ...rawSpec,
            },
          },
        });
        return;
      }
      if (kind === 'Pod') {
        await coreApi.createNamespacedPod({
          namespace,
          body: {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name, namespace, labels: { app: name } },
            spec: defaultTemplate.spec,
          },
        });
      }
    } catch (error) {
      throw new BadRequestException(
        `${kind} 创建失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async moveWorkloadNamespaceInCluster(
    existing: WorkloadRecord,
    targetNamespace: string,
  ): Promise<void> {
    if (existing.kind !== 'Deployment') {
      throw new BadRequestException(
        `${existing.kind} 暂不支持跨名称空间迁移，请新建后删除旧资源`,
      );
    }
    const kubeconfig = await this.repository.getClusterKubeconfig(
      existing.clusterId,
    );
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    const appsApi = this.k8sClientService.getAppsApi(kubeconfig) as any;
    try {
      const current = await appsApi.readNamespacedDeployment({
        name: existing.name,
        namespace: existing.namespace,
      });
      const body = current?.body ?? current;
      const next = JSON.parse(JSON.stringify(body));
      next.metadata = {
        ...(next.metadata ?? {}),
        namespace: targetNamespace,
      };
      delete next.metadata?.uid;
      delete next.metadata?.resourceVersion;
      delete next.metadata?.generation;
      delete next.metadata?.creationTimestamp;
      delete next.metadata?.managedFields;
      delete next.status;

      await appsApi.createNamespacedDeployment({
        namespace: targetNamespace,
        body: next,
      });
      await appsApi.deleteNamespacedDeployment({
        name: existing.name,
        namespace: existing.namespace,
      });
    } catch (error) {
      throw new BadRequestException(
        `Deployment 迁移失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async deleteWorkloadInCluster(
    existing: WorkloadRecord,
  ): Promise<void> {
    const kubeconfig = await this.repository.getClusterKubeconfig(
      existing.clusterId,
    );
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    const appsApi = this.k8sClientService.getAppsApi(kubeconfig) as any;
    const coreApi = this.k8sClientService.getCoreApi(kubeconfig) as any;
    const batchApi = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.BatchV1Api as never);
    try {
      if (existing.kind === 'Deployment') {
        await appsApi.deleteNamespacedDeployment({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'StatefulSet') {
        await appsApi.deleteNamespacedStatefulSet({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'DaemonSet') {
        await appsApi.deleteNamespacedDaemonSet({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'ReplicaSet') {
        await appsApi.deleteNamespacedReplicaSet({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'Job') {
        await (batchApi as any).deleteNamespacedJob({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'CronJob') {
        await (batchApi as any).deleteNamespacedCronJob({
          name: existing.name,
          namespace: existing.namespace,
        });
        return;
      }
      if (existing.kind === 'Pod') {
        await coreApi.deleteNamespacedPod({
          name: existing.name,
          namespace: existing.namespace,
          body: {
            gracePeriodSeconds: 0,
            propagationPolicy: 'Background',
          },
        });
      }
    } catch (error) {
      throw new BadRequestException(
        `${existing.kind} 删除失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private toLegacyItem(item: WorkloadRecord): LegacyWorkloadItem {
    const replicas = Math.max(item.replicas ?? 0, 0);
    const ready = Math.max(item.readyReplicas ?? 0, 0);
    const status = this.computeLegacyStatus(item.state, replicas, ready);
    const createdAt =
      this.readK8sCreationTimestamp(item.statusJson) ?? item.createdAt;
    return {
      kind: item.kind.toLowerCase(),
      name: item.name,
      clusterId: item.clusterId,
      namespace: item.namespace,
      status,
      ready: `${ready}/${replicas}`,
      replicas: `${ready}/${replicas}`,
      restarts: 0,
      age: this.formatAge(createdAt),
      state: item.state,
      version: 1,
      suspended: false,
      policyEnabled: true,
    };
  }

  private computeLegacyStatus(
    state: WorkloadRecord['state'],
    replicas: number,
    ready: number,
  ): LegacyWorkloadItem['status'] {
    if (state === 'deleted') {
      return 'Failed';
    }
    if (state === 'disabled') {
      return 'Pending';
    }
    if (replicas === 0) {
      return 'Pending';
    }
    if (ready >= replicas) {
      return 'Running';
    }
    if (ready > 0) {
      return 'Degraded';
    }
    return 'Failed';
  }

  private formatAge(createdAt: Date): string {
    const diffMs = Date.now() - createdAt.getTime();
    const minutes = Math.max(1, Math.floor(diffMs / 60000));
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  private readK8sCreationTimestamp(
    statusJson: Prisma.JsonValue | null,
  ): Date | null {
    if (
      !statusJson ||
      typeof statusJson !== 'object' ||
      Array.isArray(statusJson)
    ) {
      return null;
    }
    const creationTimestamp = (statusJson as Record<string, unknown>)
      .creationTimestamp;
    if (typeof creationTimestamp !== 'string' || !creationTimestamp.trim()) {
      return null;
    }
    const parsed = new Date(creationTimestamp);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private async scaleAppsWorkload(
    existing: WorkloadRecord,
    replicas: number,
  ): Promise<{
    observedReplicas: number | null;
    readyReplicas: number | null;
    availableReplicas: number | null;
    phase: string | null;
  }> {
    const kubeconfig = await this.repository.getClusterKubeconfig(
      existing.clusterId,
    );
    if (!kubeconfig) {
      throw new NotFoundException('目标集群未配置 kubeconfig，无法执行 scale');
    }

    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeconfig);
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc);

    try {
      await objectApi.patch(
        {
          apiVersion: 'apps/v1',
          kind: existing.kind,
          metadata: {
            namespace: existing.namespace,
            name: existing.name,
          },
          spec: {
            replicas,
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        k8s.PatchStrategy.MergePatch,
      );
    } catch (error) {
      throw new BadRequestException(
        `${existing.kind} scale 失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }

    try {
      const latest = await objectApi.read({
        apiVersion: 'apps/v1',
        kind: existing.kind,
        metadata: {
          namespace: existing.namespace,
          name: existing.name,
        },
      });
      const latestSpecReplicas = this.pickNumber(latest, ['spec', 'replicas']);
      const latestObservedReplicas = this.pickNumber(latest, [
        'status',
        'replicas',
      ]);
      const latestReadyReplicas = this.pickNumber(latest, [
        'status',
        'readyReplicas',
      ]);
      const latestAvailableReplicas = this.pickNumber(latest, [
        'status',
        'availableReplicas',
      ]);
      const observedReplicas =
        latestObservedReplicas ?? latestSpecReplicas ?? replicas;
      const phase =
        this.pickString(latest, ['status', 'phase']) ??
        this.deriveScalePhase({
          desiredReplicas: replicas,
          observedReplicas,
          readyReplicas: latestReadyReplicas,
          availableReplicas: latestAvailableReplicas,
        });
      return {
        observedReplicas,
        readyReplicas: latestReadyReplicas,
        availableReplicas: latestAvailableReplicas,
        phase,
      };
    } catch {
      return {
        observedReplicas: replicas,
        readyReplicas: null,
        availableReplicas: null,
        phase: null,
      };
    }
  }

  private pickNumber(
    value: unknown,
    path: readonly [string, string],
  ): number | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const first = source[path[0]];
    if (!first || typeof first !== 'object' || Array.isArray(first)) {
      return null;
    }
    const second = (first as Record<string, unknown>)[path[1]];
    return typeof second === 'number' && Number.isFinite(second)
      ? Math.max(0, Math.floor(second))
      : null;
  }

  private pickString(
    value: unknown,
    path: readonly [string, string],
  ): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const source = value as Record<string, unknown>;
    const first = source[path[0]];
    if (!first || typeof first !== 'object' || Array.isArray(first)) {
      return null;
    }
    const second = (first as Record<string, unknown>)[path[1]];
    if (typeof second !== 'string') {
      return null;
    }
    const trimmed = second.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private deriveScalePhase(input: {
    desiredReplicas: number;
    observedReplicas: number | null;
    readyReplicas: number | null;
    availableReplicas: number | null;
  }): string {
    const desired = Math.max(0, input.desiredReplicas);
    const observed = input.observedReplicas ?? 0;
    const ready = input.readyReplicas ?? 0;
    const available = input.availableReplicas ?? 0;

    if (desired === 0 && observed === 0) {
      return 'ScaledToZero';
    }
    if (ready >= desired && available >= desired && desired > 0) {
      return 'Running';
    }
    if (ready > 0 || available > 0) {
      return 'Degraded';
    }
    if (observed > 0) {
      return 'Progressing';
    }
    return 'Pending';
  }

  private deriveConvergenceStatus(input: {
    desiredReplicas: number;
    observedReplicas: number | null;
    readyReplicas: number | null;
    availableReplicas: number | null;
  }): 'accepted' | 'converging' | 'stable' | 'timeout' {
    const desired = Math.max(0, input.desiredReplicas);
    const observed = input.observedReplicas;
    const ready = input.readyReplicas;
    const available = input.availableReplicas;

    if (
      observed === desired &&
      ready === desired &&
      (available === null || available === desired)
    ) {
      return 'stable';
    }
    if (observed === null && ready === null && available === null) {
      return 'accepted';
    }
    return 'converging';
  }

  private extractK8sErrorMessage(error: unknown): string {
    if (!error) {
      return '未知错误';
    }
    if (error instanceof Error) {
      const withBody = error as Error & {
        body?: unknown;
        response?: { body?: unknown };
      };
      const body = withBody.body ?? withBody.response?.body;
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return `${error.message} (${message})`;
        }
      }
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return '未知错误';
    }
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message?.trim();
      return message || '请求处理失败';
    }
    if (typeof error === 'string') {
      const message = error.trim();
      return message || '请求处理失败';
    }
    return '请求处理失败';
  }
}
