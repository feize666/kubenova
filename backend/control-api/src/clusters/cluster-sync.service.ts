import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';
import { K8sClientService } from './k8s-client.service';

/** 将 k8s 强类型对象序列化为 Prisma Json 兼容值 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export interface SyncResult {
  ok: boolean;
  clusterId: string;
  syncedAt: string;
  counts: {
    namespaces: number;
    pods: number;
    deployments: number;
    replicasets: number;
    statefulsets: number;
    daemonsets: number;
    jobs: number;
    cronjobs: number;
    services: number;
    endpoints: number;
    endpointSlices: number;
    ingresses: number;
    networkPolicies: number;
    ingressRoutes: number;
    configmaps: number;
    secrets: number;
    pvs: number;
    pvcs: number;
    storageclasses: number;
  };
  errors: string[];
}

/** 上次同步状态缓存（内存级，进程重启后丢失，足够满足 /sync/status 查询） */
export interface SyncStatus {
  syncedAt: string;
  ok: boolean;
  result?: SyncResult;
}

type ImageResolutionSourceName =
  | 'spec.containers'
  | 'spec.template.spec.containers'
  | 'status.containerImages'
  | 'template.annotations';

interface ImageResolutionSourceDetail {
  source: ImageResolutionSourceName;
  images: string[];
}

interface WorkloadImageResolution {
  image: string | null;
  images: string[];
  imageResolution: {
    selectedSource: ImageResolutionSourceName | null;
    missing: boolean;
    sources: ImageResolutionSourceDetail[];
  };
}

@Injectable()
export class ClusterSyncService {
  private readonly logger = new Logger(ClusterSyncService.name);
  private readonly lastSyncStatus = new Map<string, SyncStatus>();
  private readonly listTimeoutMs = 3_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly k8sClient: K8sClientService,
  ) {}

  /** 获取上次同步状态 */
  getLastSyncStatus(clusterId: string): SyncStatus | null {
    return this.lastSyncStatus.get(clusterId) ?? null;
  }

  /** 触发指定集群的全量数据同步 */
  async syncCluster(
    clusterId: string,
    kubeconfig: string,
  ): Promise<SyncResult> {
    const errors: string[] = [];
    const counts: SyncResult['counts'] = {
      namespaces: 0,
      pods: 0,
      deployments: 0,
      replicasets: 0,
      statefulsets: 0,
      daemonsets: 0,
      jobs: 0,
      cronjobs: 0,
      services: 0,
      endpoints: 0,
      endpointSlices: 0,
      ingresses: 0,
      networkPolicies: 0,
      ingressRoutes: 0,
      configmaps: 0,
      secrets: 0,
      pvs: 0,
      pvcs: 0,
      storageclasses: 0,
    };

    const coreApi = this.k8sClient.getCoreApi(kubeconfig);
    const appsApi = this.k8sClient.getAppsApi(kubeconfig);
    const discoveryApi = this.k8sClient.getDiscoveryApi(kubeconfig);
    const networkingApi = this.k8sClient.getNetworkingApi(kubeconfig);
    const customObjectsApi = this.k8sClient.getCustomObjectsApi(kubeconfig);
    const storageApi = this.k8sClient.getStorageApi(kubeconfig);
    const batchApi = this.k8sClient.getBatchApi(kubeconfig);

    // ── 同步 Namespaces ──────────────────────────────────────────
    counts.namespaces = await this.syncNamespaces(clusterId, coreApi, errors);

    // ── 同步 Pods ────────────────────────────────────────────────
    counts.pods = await this.syncPods(clusterId, coreApi, errors);

    // ── 同步 Deployments ─────────────────────────────────────────
    counts.deployments = await this.syncDeployments(clusterId, appsApi, errors);

    // ── 同步 ReplicaSets ────────────────────────────────────────
    counts.replicasets = await this.syncReplicaSets(clusterId, appsApi, errors);

    // ── 同步 StatefulSets ────────────────────────────────────────
    counts.statefulsets = await this.syncStatefulSets(
      clusterId,
      appsApi,
      errors,
    );

    // ── 同步 DaemonSets ──────────────────────────────────────────
    counts.daemonsets = await this.syncDaemonSets(clusterId, appsApi, errors);

    // ── 同步 Jobs / CronJobs ────────────────────────────────────
    counts.jobs = await this.syncJobs(clusterId, batchApi, errors);
    counts.cronjobs = await this.syncCronJobs(clusterId, batchApi, errors);

    // ── 同步 Services ────────────────────────────────────────────
    counts.services = await this.syncServices(clusterId, coreApi, errors);

    // ── 同步 Endpoints / EndpointSlices ──────────────────────────
    counts.endpoints = await this.syncEndpoints(clusterId, coreApi, errors);
    counts.endpointSlices = await this.syncEndpointSlices(
      clusterId,
      discoveryApi,
      errors,
    );

    // ── 同步 Ingresses ───────────────────────────────────────────
    counts.ingresses = await this.syncIngresses(
      clusterId,
      networkingApi,
      errors,
    );
    counts.networkPolicies = await this.syncNetworkPolicies(
      clusterId,
      networkingApi,
      errors,
    );
    counts.ingressRoutes = await this.syncIngressRoutes(
      clusterId,
      customObjectsApi,
      errors,
    );

    // ── 同步 ConfigMaps ──────────────────────────────────────────
    counts.configmaps = await this.syncConfigMaps(clusterId, coreApi, errors);

    // ── 同步 Secrets（只同步 key，不同步 value）─────────────────
    counts.secrets = await this.syncSecrets(clusterId, coreApi, errors);

    // ── 同步 PV / PVC / StorageClass ────────────────────────────
    counts.pvs = await this.syncPersistentVolumes(clusterId, coreApi, errors);
    counts.pvcs = await this.syncPersistentVolumeClaims(
      clusterId,
      coreApi,
      errors,
    );
    counts.storageclasses = await this.syncStorageClasses(
      clusterId,
      storageApi,
      errors,
    );
    await this.syncClusterUsageMetadata(clusterId, coreApi, errors);

    const syncedAt = new Date().toISOString();
    const result: SyncResult = {
      ok: errors.length === 0,
      clusterId,
      syncedAt,
      counts,
      errors,
    };

    this.lastSyncStatus.set(clusterId, {
      syncedAt,
      ok: result.ok,
      result,
    });

    return result;
  }

  private parseCpuToCores(value: string | undefined): number {
    if (!value) return 0;
    const normalized = value.trim();
    if (!normalized) return 0;
    if (normalized.endsWith('m')) {
      const milli = Number.parseFloat(normalized.slice(0, -1));
      return Number.isFinite(milli) ? milli / 1000 : 0;
    }
    const cores = Number.parseFloat(normalized);
    return Number.isFinite(cores) ? cores : 0;
  }

  private parseMemoryToBytes(value: string | undefined): number {
    if (!value) return 0;
    const normalized = value.trim();
    if (!normalized) return 0;
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)?$/);
    if (!match) return 0;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return 0;
    const suffix = (match[2] ?? '').toLowerCase();
    const units: Record<string, number> = {
      '': 1,
      k: 1_000,
      m: 1_000_000,
      g: 1_000_000_000,
      t: 1_000_000_000_000,
      p: 1_000_000_000_000_000,
      e: 1_000_000_000_000_000_000,
      ki: 1024,
      mi: 1024 ** 2,
      gi: 1024 ** 3,
      ti: 1024 ** 4,
      pi: 1024 ** 5,
      ei: 1024 ** 6,
    };
    const base = units[suffix];
    if (!base) return 0;
    return amount * base;
  }

  private pickPrimaryImage(images: string[]): string | null {
    return images.length > 0 ? images[0] : null;
  }

  private logMissingImage(
    kind: string,
    clusterId: string,
    namespace: string,
    name: string,
  ): void {
    this.logger.warn(
      `[image-missing] kind=${kind} clusterId=${clusterId} namespace=${namespace} name=${name}`,
    );
  }

  private extractContainerImages(
    containers: Array<{ image?: string }>,
  ): string[] {
    return containers
      .map((container) =>
        typeof container.image === 'string' ? container.image.trim() : '',
      )
      .filter((image): image is string => Boolean(image));
  }

  private toImageArray(values: unknown[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((image): image is string => Boolean(image)),
      ),
    );
  }

  private looksLikeImageRef(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    // registry/repo:tag, repo@sha256:..., or repo/name
    return /[/:@]/.test(trimmed) && !trimmed.includes(' ');
  }

  private parseStatusContainerImages(
    status: unknown,
    fallbackStatuses: Array<{ image?: string }> = [],
  ): string[] {
    const statusObj =
      status && typeof status === 'object' && !Array.isArray(status)
        ? (status as Record<string, unknown>)
        : {};

    const fromContainerImages = Array.isArray(statusObj.containerImages)
      ? this.toImageArray(
          statusObj.containerImages.flatMap((item) => {
            if (typeof item === 'string') return [item];
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const maybeImage = (item as Record<string, unknown>).image;
              return typeof maybeImage === 'string' ? [maybeImage] : [];
            }
            return [];
          }),
        )
      : [];

    if (fromContainerImages.length > 0) {
      return fromContainerImages;
    }

    return this.extractContainerImages(fallbackStatuses);
  }

  private parseTemplateAnnotationImages(
    annotations: Record<string, string> | undefined,
  ): string[] {
    if (!annotations) {
      return [];
    }

    const imageKeyPattern = /(?:^|[./-])images?(?:$|[./-])/i;
    const values = Object.entries(annotations)
      .filter(([key]) => imageKeyPattern.test(key))
      .flatMap(([, raw]) => {
        const value = raw.trim();
        if (!value) {
          return [];
        }
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              return parsed;
            }
          } catch {
            // ignore JSON parse failure and fallback to delimiter split.
          }
        }
        return value
          .split(/[\s,;]+/)
          .map((token) => token.trim())
          .filter(Boolean);
      })
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => this.looksLikeImageRef(value));

    return this.toImageArray(values);
  }

  private resolveWorkloadImages(params: {
    specContainers?: Array<{ image?: string }>;
    templateSpecContainers?: Array<{ image?: string }>;
    status?: unknown;
    statusContainerStatuses?: Array<{ image?: string }>;
    templateAnnotations?: Record<string, string>;
  }): WorkloadImageResolution {
    const sources: ImageResolutionSourceDetail[] = [
      {
        source: 'spec.containers',
        images: this.extractContainerImages(params.specContainers ?? []),
      },
      {
        source: 'spec.template.spec.containers',
        images: this.extractContainerImages(
          params.templateSpecContainers ?? [],
        ),
      },
      {
        source: 'status.containerImages',
        images: this.parseStatusContainerImages(
          params.status,
          params.statusContainerStatuses ?? [],
        ),
      },
      {
        source: 'template.annotations',
        images: this.parseTemplateAnnotationImages(params.templateAnnotations),
      },
    ];

    const selected = sources.find((source) => source.images.length > 0) ?? null;
    return {
      image: selected?.images[0] ?? null,
      images: selected?.images ?? [],
      imageResolution: {
        selectedSource: selected?.source ?? null,
        missing: selected === null,
        sources,
      },
    };
  }

  private async syncClusterUsageMetadata(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<void> {
    try {
      const [nodesResp, podsResp] = await Promise.all([
        coreApi.listNode(),
        coreApi.listPodForAllNamespaces(),
      ]);

      const allocatableCpuCores = nodesResp.items.reduce((sum, node) => {
        const cpu = node.status?.allocatable?.cpu;
        return sum + this.parseCpuToCores(cpu);
      }, 0);
      const allocatableMemoryBytes = nodesResp.items.reduce((sum, node) => {
        const memory = node.status?.allocatable?.memory;
        return sum + this.parseMemoryToBytes(memory);
      }, 0);

      const requestedCpuCores = podsResp.items.reduce((sum, pod) => {
        const regular = pod.spec?.containers ?? [];
        const init = pod.spec?.initContainers ?? [];
        const all = [...regular, ...init];
        const cpuReq = all.reduce((acc, container) => {
          const value = container.resources?.requests?.cpu;
          return acc + this.parseCpuToCores(value);
        }, 0);
        return sum + cpuReq;
      }, 0);

      const requestedMemoryBytes = podsResp.items.reduce((sum, pod) => {
        const regular = pod.spec?.containers ?? [];
        const init = pod.spec?.initContainers ?? [];
        const all = [...regular, ...init];
        const memReq = all.reduce((acc, container) => {
          const value = container.resources?.requests?.memory;
          return acc + this.parseMemoryToBytes(value);
        }, 0);
        return sum + memReq;
      }, 0);

      const cpuUsage =
        allocatableCpuCores > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round((requestedCpuCores / allocatableCpuCores) * 100),
              ),
            )
          : 0;
      const memoryUsage =
        allocatableMemoryBytes > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  (requestedMemoryBytes / allocatableMemoryBytes) * 100,
                ),
              ),
            )
          : 0;

      const cluster = await this.prisma.clusterRegistry.findUnique({
        where: { id: clusterId },
        select: { metadata: true },
      });
      if (!cluster) {
        return;
      }

      const metadata =
        cluster.metadata &&
        typeof cluster.metadata === 'object' &&
        !Array.isArray(cluster.metadata)
          ? (cluster.metadata as Record<string, unknown>)
          : {};

      await this.prisma.clusterRegistry.update({
        where: { id: clusterId },
        data: {
          metadata: {
            ...metadata,
            cpuUsage,
            memoryUsage,
            usageMetrics: {
              source: 'k8s-node-allocatable-requested',
              cpu: {
                allocatableCores: Number(allocatableCpuCores.toFixed(3)),
                requestedCores: Number(requestedCpuCores.toFixed(3)),
                usagePercent: cpuUsage,
              },
              memory: {
                allocatableBytes: Math.round(allocatableMemoryBytes),
                requestedBytes: Math.round(requestedMemoryBytes),
                usagePercent: memoryUsage,
              },
              nodeCount: nodesResp.items.length,
              calculatedAt: new Date().toISOString(),
            },
          },
        },
      });
    } catch (err) {
      const msg = `Cluster usage metadata sync failed: ${(err as Error).message}`;
      this.logger.warn(msg);
      errors.push(msg);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: 各类资源同步实现
  // ─────────────────────────────────────────────────────────────────────────

  private async syncNamespaces(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await this.withTimeout(
        coreApi.listNamespace(),
        this.listTimeoutMs,
      );
      const items = resp.items;
      const liveNames = new Set<string>();

      for (const ns of items) {
        const name = ns.metadata?.name ?? '';
        if (!name) continue;
        liveNames.add(name);

        await this.prisma.namespaceRecord.upsert({
          where: { clusterId_name: { clusterId, name } },
          create: {
            clusterId,
            name,
            state: 'active',
            labels: (ns.metadata?.labels ?? {}) as Record<string, string>,
          },
          update: {
            state: 'active',
            labels: (ns.metadata?.labels ?? {}) as Record<string, string>,
          },
        });
      }

      // 标记不在当前结果中的记录为 deleted
      await this.prisma.namespaceRecord.updateMany({
        where: {
          clusterId,
          state: { not: 'deleted' },
          name: { notIn: Array.from(liveNames) },
        },
        data: { state: 'deleted' },
      });

      return liveNames.size;
    } catch (err) {
      const msg = `Namespaces sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncPods(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await this.withTimeout(
        coreApi.listPodForAllNamespaces(),
        this.listTimeoutMs,
      );
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const pod of items) {
        const namespace = pod.metadata?.namespace ?? '';
        const name = pod.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const phase = pod.status?.phase ?? 'Unknown';
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const regularContainers = pod.spec?.containers ?? [];
        const replicas = containerStatuses.length;
        const readyReplicas = containerStatuses.filter((s) => s.ready).length;
        const restartCount = containerStatuses.reduce(
          (sum, s) => sum + (s.restartCount ?? 0),
          0,
        );
        const containerNames = containerStatuses
          .map((s) => s.name)
          .filter(Boolean);
        const resolvedImages = this.resolveWorkloadImages({
          specContainers: regularContainers as Array<{ image?: string }>,
          status: pod.status ?? null,
          statusContainerStatuses: containerStatuses as Array<{
            image?: string;
          }>,
        });
        const containerImages = resolvedImages.images;
        const image = resolvedImages.image;
        if (!image) {
          this.logMissingImage('Pod', clusterId, namespace, name);
        }
        const ownerReferences = (pod.metadata?.ownerReferences ?? []).map(
          (owner) => ({
            apiVersion: owner.apiVersion ?? null,
            kind: owner.kind ?? null,
            name: owner.name ?? null,
            uid: owner.uid ?? null,
            controller: owner.controller ?? false,
            blockOwnerDeletion: owner.blockOwnerDeletion ?? false,
          }),
        );
        const createdAt =
          pod.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Pod',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Pod',
            name,
            state: 'active',
            replicas,
            readyReplicas,
            labels: (pod.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (pod.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            statusJson: toJson({
              phase,
              podIP: pod.status?.podIP ?? null,
              nodeName: pod.spec?.nodeName ?? null,
              restartCount,
              containerNames,
              containerImages,
              image,
              imageResolution: resolvedImages.imageResolution,
              ownerReferences,
              conditions: pod.status?.conditions ?? [],
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas,
            readyReplicas,
            labels: (pod.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (pod.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            statusJson: toJson({
              phase,
              podIP: pod.status?.podIP ?? null,
              nodeName: pod.spec?.nodeName ?? null,
              restartCount,
              containerNames,
              containerImages,
              image,
              imageResolution: resolvedImages.imageResolution,
              ownerReferences,
              conditions: pod.status?.conditions ?? [],
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'Pod', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Pods sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
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

  private async syncDeployments(
    clusterId: string,
    appsApi: k8s.AppsV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await appsApi.listDeploymentForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const dep of items) {
        const namespace = dep.metadata?.namespace ?? '';
        const name = dep.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const resolvedImages = this.resolveWorkloadImages({
          specContainers: ((
            (dep.spec ?? {}) as { containers?: Array<{ image?: string }> }
          ).containers ?? []) as Array<{ image?: string }>,
          templateSpecContainers: (dep.spec?.template?.spec?.containers ??
            []) as Array<{
            image?: string;
          }>,
          status: dep.status ?? null,
          templateAnnotations: (dep.spec?.template?.metadata?.annotations ??
            {}) as Record<string, string>,
        });
        const images = resolvedImages.images;
        const image = resolvedImages.image;
        if (!image) {
          this.logMissingImage('Deployment', clusterId, namespace, name);
        }

        const createdAt =
          dep.metadata?.creationTimestamp?.toISOString() ?? null;
        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Deployment',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Deployment',
            name,
            state: 'active',
            replicas: dep.spec?.replicas ?? null,
            readyReplicas: dep.status?.readyReplicas ?? null,
            labels: (dep.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (dep.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(dep.spec ?? {}),
            statusJson: toJson({
              replicas: dep.status?.replicas,
              readyReplicas: dep.status?.readyReplicas,
              availableReplicas: dep.status?.availableReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas: dep.spec?.replicas ?? null,
            readyReplicas: dep.status?.readyReplicas ?? null,
            labels: (dep.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (dep.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(dep.spec ?? {}),
            statusJson: toJson({
              replicas: dep.status?.replicas,
              readyReplicas: dep.status?.readyReplicas,
              availableReplicas: dep.status?.availableReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'Deployment', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Deployments sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncReplicaSets(
    clusterId: string,
    appsApi: k8s.AppsV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await appsApi.listReplicaSetForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const rs of items) {
        const namespace = rs.metadata?.namespace ?? '';
        const name = rs.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const resolvedImages = this.resolveWorkloadImages({
          specContainers: ((
            (rs.spec ?? {}) as { containers?: Array<{ image?: string }> }
          ).containers ?? []) as Array<{ image?: string }>,
          templateSpecContainers: (rs.spec?.template?.spec?.containers ??
            []) as Array<{
            image?: string;
          }>,
          status: rs.status ?? null,
          templateAnnotations: (rs.spec?.template?.metadata?.annotations ??
            {}) as Record<string, string>,
        });
        const createdAt = rs.metadata?.creationTimestamp?.toISOString() ?? null;
        const images = resolvedImages.images;
        const image = resolvedImages.image;
        if (!image) {
          this.logMissingImage('ReplicaSet', clusterId, namespace, name);
        }

        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'ReplicaSet',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'ReplicaSet',
            name,
            state: 'active',
            replicas: rs.spec?.replicas ?? null,
            readyReplicas: rs.status?.readyReplicas ?? null,
            labels: (rs.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (rs.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(rs.spec ?? {}),
            statusJson: toJson({
              replicas: rs.status?.replicas,
              readyReplicas: rs.status?.readyReplicas,
              availableReplicas: rs.status?.availableReplicas,
              fullyLabeledReplicas: rs.status?.fullyLabeledReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas: rs.spec?.replicas ?? null,
            readyReplicas: rs.status?.readyReplicas ?? null,
            labels: (rs.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (rs.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(rs.spec ?? {}),
            statusJson: toJson({
              replicas: rs.status?.replicas,
              readyReplicas: rs.status?.readyReplicas,
              availableReplicas: rs.status?.availableReplicas,
              fullyLabeledReplicas: rs.status?.fullyLabeledReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'ReplicaSet', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `ReplicaSets sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncStatefulSets(
    clusterId: string,
    appsApi: k8s.AppsV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await appsApi.listStatefulSetForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const sts of items) {
        const namespace = sts.metadata?.namespace ?? '';
        const name = sts.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const resolvedImages = this.resolveWorkloadImages({
          specContainers: ((
            (sts.spec ?? {}) as { containers?: Array<{ image?: string }> }
          ).containers ?? []) as Array<{ image?: string }>,
          templateSpecContainers: (sts.spec?.template?.spec?.containers ??
            []) as Array<{
            image?: string;
          }>,
          status: sts.status ?? null,
          templateAnnotations: (sts.spec?.template?.metadata?.annotations ??
            {}) as Record<string, string>,
        });
        const images = resolvedImages.images;
        const image = resolvedImages.image;
        if (!image) {
          this.logMissingImage('StatefulSet', clusterId, namespace, name);
        }

        const createdAt =
          sts.metadata?.creationTimestamp?.toISOString() ?? null;
        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'StatefulSet',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'StatefulSet',
            name,
            state: 'active',
            replicas: sts.spec?.replicas ?? null,
            readyReplicas: sts.status?.readyReplicas ?? null,
            labels: (sts.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (sts.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(sts.spec ?? {}),
            statusJson: toJson({
              replicas: sts.status?.replicas,
              readyReplicas: sts.status?.readyReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas: sts.spec?.replicas ?? null,
            readyReplicas: sts.status?.readyReplicas ?? null,
            labels: (sts.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (sts.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(sts.spec ?? {}),
            statusJson: toJson({
              replicas: sts.status?.replicas,
              readyReplicas: sts.status?.readyReplicas,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'StatefulSet', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `StatefulSets sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncDaemonSets(
    clusterId: string,
    appsApi: k8s.AppsV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await appsApi.listDaemonSetForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const ds of items) {
        const namespace = ds.metadata?.namespace ?? '';
        const name = ds.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const resolvedImages = this.resolveWorkloadImages({
          specContainers: ((
            (ds.spec ?? {}) as { containers?: Array<{ image?: string }> }
          ).containers ?? []) as Array<{ image?: string }>,
          templateSpecContainers: (ds.spec?.template?.spec?.containers ??
            []) as Array<{
            image?: string;
          }>,
          status: ds.status ?? null,
          templateAnnotations: (ds.spec?.template?.metadata?.annotations ??
            {}) as Record<string, string>,
        });
        const images = resolvedImages.images;
        const image = resolvedImages.image;
        if (!image) {
          this.logMissingImage('DaemonSet', clusterId, namespace, name);
        }

        const createdAt = ds.metadata?.creationTimestamp?.toISOString() ?? null;
        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'DaemonSet',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'DaemonSet',
            name,
            state: 'active',
            readyReplicas: ds.status?.numberReady ?? null,
            labels: (ds.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (ds.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(ds.spec ?? {}),
            statusJson: toJson({
              desiredNumberScheduled: ds.status?.desiredNumberScheduled,
              numberReady: ds.status?.numberReady,
              numberAvailable: ds.status?.numberAvailable,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            readyReplicas: ds.status?.numberReady ?? null,
            labels: (ds.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (ds.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(ds.spec ?? {}),
            statusJson: toJson({
              desiredNumberScheduled: ds.status?.desiredNumberScheduled,
              numberReady: ds.status?.numberReady,
              numberAvailable: ds.status?.numberAvailable,
              image,
              images,
              imageResolution: resolvedImages.imageResolution,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'DaemonSet', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `DaemonSets sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncJobs(
    clusterId: string,
    batchApi: k8s.BatchV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await batchApi.listJobForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const job of items) {
        const namespace = job.metadata?.namespace ?? '';
        const name = job.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const createdAt =
          job.metadata?.creationTimestamp?.toISOString() ?? null;
        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Job',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Job',
            name,
            state: 'active',
            replicas: job.spec?.completions ?? null,
            readyReplicas: job.status?.succeeded ?? null,
            labels: (job.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (job.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(job.spec ?? {}),
            statusJson: toJson({
              active: job.status?.active,
              succeeded: job.status?.succeeded,
              failed: job.status?.failed,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas: job.spec?.completions ?? null,
            readyReplicas: job.status?.succeeded ?? null,
            labels: (job.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (job.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(job.spec ?? {}),
            statusJson: toJson({
              active: job.status?.active,
              succeeded: job.status?.succeeded,
              failed: job.status?.failed,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'Job', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Jobs sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncCronJobs(
    clusterId: string,
    batchApi: k8s.BatchV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await batchApi.listCronJobForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const cronjob of items) {
        const namespace = cronjob.metadata?.namespace ?? '';
        const name = cronjob.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const createdAt =
          cronjob.metadata?.creationTimestamp?.toISOString() ?? null;
        await this.prisma.workloadRecord.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'CronJob',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'CronJob',
            name,
            state: 'active',
            replicas: cronjob.spec?.suspend ? 0 : null,
            readyReplicas: null,
            labels: (cronjob.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (cronjob.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(cronjob.spec ?? {}),
            statusJson: toJson({
              lastScheduleTime: cronjob.status?.lastScheduleTime ?? null,
              active: cronjob.status?.active ?? [],
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            replicas: cronjob.spec?.suspend ? 0 : null,
            readyReplicas: null,
            labels: (cronjob.metadata?.labels ?? {}) as Record<string, string>,
            annotations: (cronjob.metadata?.annotations ?? {}) as Record<
              string,
              string
            >,
            spec: toJson(cronjob.spec ?? {}),
            statusJson: toJson({
              lastScheduleTime: cronjob.status?.lastScheduleTime ?? null,
              active: cronjob.status?.active ?? [],
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedWorkloads(clusterId, 'CronJob', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `CronJobs sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncServices(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listServiceForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const svc of items) {
        const namespace = svc.metadata?.namespace ?? '';
        const name = svc.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          svc.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Service',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Service',
            name,
            state: 'active',
            labels: (svc.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              type: svc.spec?.type,
              clusterIP: svc.spec?.clusterIP,
              ports: svc.spec?.ports,
            }),
            statusJson: toJson({
              loadBalancer: svc.status?.loadBalancer,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            labels: (svc.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              type: svc.spec?.type,
              clusterIP: svc.spec?.clusterIP,
              ports: svc.spec?.ports,
            }),
            statusJson: toJson({
              loadBalancer: svc.status?.loadBalancer,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedNetworkResources(clusterId, 'Service', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Services sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncEndpoints(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listEndpointsForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const endpoint of items) {
        const namespace = endpoint.metadata?.namespace ?? '';
        const name = endpoint.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          endpoint.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Endpoints',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Endpoints',
            name,
            state: 'active',
            labels: (endpoint.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              subsets: endpoint.subsets ?? [],
            }),
            statusJson: toJson({
              addresses:
                endpoint.subsets?.flatMap((subset) =>
                  (subset.addresses ?? []).map((item) => ({
                    ip: item.ip,
                    hostname: item.hostname,
                    nodeName: item.nodeName,
                    targetRef: item.targetRef,
                  })),
                ) ?? [],
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            labels: (endpoint.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              subsets: endpoint.subsets ?? [],
            }),
            statusJson: toJson({
              addresses:
                endpoint.subsets?.flatMap((subset) =>
                  (subset.addresses ?? []).map((item) => ({
                    ip: item.ip,
                    hostname: item.hostname,
                    nodeName: item.nodeName,
                    targetRef: item.targetRef,
                  })),
                ) ?? [],
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedNetworkResources(clusterId, 'Endpoints', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Endpoints sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncEndpointSlices(
    clusterId: string,
    discoveryApi: k8s.DiscoveryV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await discoveryApi.listEndpointSliceForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const endpointSlice of items) {
        const namespace = endpointSlice.metadata?.namespace ?? '';
        const name = endpointSlice.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          endpointSlice.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'EndpointSlice',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'EndpointSlice',
            name,
            state: 'active',
            labels: (endpointSlice.metadata?.labels ?? {}) as Record<
              string,
              string
            >,
            spec: toJson({
              addressType: endpointSlice.addressType,
              endpoints: endpointSlice.endpoints ?? [],
              ports: endpointSlice.ports ?? [],
            }),
            statusJson: toJson({
              serviceName:
                endpointSlice.metadata?.labels?.[
                  'kubernetes.io/service-name'
                ] ?? null,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            labels: (endpointSlice.metadata?.labels ?? {}) as Record<
              string,
              string
            >,
            spec: toJson({
              addressType: endpointSlice.addressType,
              endpoints: endpointSlice.endpoints ?? [],
              ports: endpointSlice.ports ?? [],
            }),
            statusJson: toJson({
              serviceName:
                endpointSlice.metadata?.labels?.[
                  'kubernetes.io/service-name'
                ] ?? null,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedNetworkResources(
        clusterId,
        'EndpointSlice',
        liveKeys,
      );
      return liveKeys.size;
    } catch (err) {
      const msg = `EndpointSlices sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncIngresses(
    clusterId: string,
    networkingApi: k8s.NetworkingV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await networkingApi.listIngressForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const ing of items) {
        const namespace = ing.metadata?.namespace ?? '';
        const name = ing.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          ing.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Ingress',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Ingress',
            name,
            state: 'active',
            labels: (ing.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              ingressClassName: ing.spec?.ingressClassName,
              rules: ing.spec?.rules,
              tls: ing.spec?.tls,
            }),
            statusJson: toJson({
              loadBalancer: ing.status?.loadBalancer,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            labels: (ing.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              ingressClassName: ing.spec?.ingressClassName,
              rules: ing.spec?.rules,
              tls: ing.spec?.tls,
            }),
            statusJson: toJson({
              loadBalancer: ing.status?.loadBalancer,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedNetworkResources(clusterId, 'Ingress', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Ingresses sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncNetworkPolicies(
    clusterId: string,
    networkingApi: k8s.NetworkingV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await networkingApi.listNetworkPolicyForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const policy of items) {
        const namespace = policy.metadata?.namespace ?? '';
        const name = policy.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          policy.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'NetworkPolicy',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'NetworkPolicy',
            name,
            state: 'active',
            labels: (policy.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              podSelector: policy.spec?.podSelector ?? {},
              policyTypes: policy.spec?.policyTypes ?? [],
              ingress: policy.spec?.ingress ?? [],
              egress: policy.spec?.egress ?? [],
            }),
            statusJson: toJson({
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            labels: (policy.metadata?.labels ?? {}) as Record<string, string>,
            spec: toJson({
              podSelector: policy.spec?.podSelector ?? {},
              policyTypes: policy.spec?.policyTypes ?? [],
              ingress: policy.spec?.ingress ?? [],
              egress: policy.spec?.egress ?? [],
            }),
            statusJson: toJson({
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedNetworkResources(
        clusterId,
        'NetworkPolicy',
        liveKeys,
      );
      return liveKeys.size;
    } catch (err) {
      const msg = `NetworkPolicies sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncIngressRoutes(
    clusterId: string,
    customObjectsApi: k8s.CustomObjectsApi,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await customObjectsApi.listClusterCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        plural: 'ingressroutes',
      });
      const items = ((resp as { items?: unknown[] }).items ?? []).filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      );
      const liveKeys = new Set<string>();

      for (const item of items) {
        const metadata =
          item.metadata &&
          typeof item.metadata === 'object' &&
          !Array.isArray(item.metadata)
            ? (item.metadata as Record<string, unknown>)
            : {};
        const namespace =
          typeof metadata.namespace === 'string' ? metadata.namespace : '';
        const name = typeof metadata.name === 'string' ? metadata.name : '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          typeof metadata.creationTimestamp === 'string'
            ? metadata.creationTimestamp
            : null;

        await this.prisma.networkResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'IngressRoute',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'IngressRoute',
            name,
            state: 'active',
            labels:
              (metadata.labels as Record<string, string> | undefined) ?? {},
            spec: toJson(
              item.spec &&
                typeof item.spec === 'object' &&
                !Array.isArray(item.spec)
                ? item.spec
                : {},
            ),
            statusJson: toJson(
              item.status &&
                typeof item.status === 'object' &&
                !Array.isArray(item.status)
                ? {
                    ...(item.status as Record<string, unknown>),
                    creationTimestamp: createdAt,
                  }
                : {},
            ),
          },
          update: {
            state: 'active',
            labels:
              (metadata.labels as Record<string, string> | undefined) ?? {},
            spec: toJson(
              item.spec &&
                typeof item.spec === 'object' &&
                !Array.isArray(item.spec)
                ? item.spec
                : {},
            ),
            statusJson: toJson(
              item.status &&
                typeof item.status === 'object' &&
                !Array.isArray(item.status)
                ? {
                    ...(item.status as Record<string, unknown>),
                    creationTimestamp: createdAt,
                  }
                : {},
            ),
          },
        });
      }

      await this.markDeletedNetworkResources(
        clusterId,
        'IngressRoute',
        liveKeys,
      );
      return liveKeys.size;
    } catch (err) {
      const msg = `IngressRoutes sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncConfigMaps(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listConfigMapForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const cm of items) {
        const namespace = cm.metadata?.namespace ?? '';
        const name = cm.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        const dataKeys = Object.keys(cm.data ?? {});

        await this.prisma.configResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'ConfigMap',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'ConfigMap',
            name,
            state: 'active',
            dataKeys,
            labels: (cm.metadata?.labels ?? {}) as Record<string, string>,
          },
          update: {
            state: 'active',
            dataKeys,
            labels: (cm.metadata?.labels ?? {}) as Record<string, string>,
          },
        });
      }

      await this.markDeletedConfigResources(clusterId, 'ConfigMap', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `ConfigMaps sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncSecrets(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listSecretForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const secret of items) {
        const namespace = secret.metadata?.namespace ?? '';
        const name = secret.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);

        // 只同步 key 名，不同步 value
        const dataKeys = Object.keys(secret.data ?? {});

        await this.prisma.configResource.upsert({
          where: {
            clusterId_namespace_kind_name: {
              clusterId,
              namespace,
              kind: 'Secret',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'Secret',
            name,
            state: 'active',
            dataKeys,
            labels: (secret.metadata?.labels ?? {}) as Record<string, string>,
          },
          update: {
            state: 'active',
            dataKeys,
            labels: (secret.metadata?.labels ?? {}) as Record<string, string>,
          },
        });
      }

      await this.markDeletedConfigResources(clusterId, 'Secret', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `Secrets sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncPersistentVolumes(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listPersistentVolume();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const pv of items) {
        const name = pv.metadata?.name ?? '';
        if (!name) continue;
        liveKeys.add(`_cluster/${name}`);
        const createdAt = pv.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.storageResource.upsert({
          where: {
            clusterId_kind_name: {
              clusterId,
              kind: 'PV',
              name,
            },
          },
          create: {
            clusterId,
            namespace: null,
            kind: 'PV',
            name,
            state: 'active',
            capacity: pv.spec?.capacity?.storage ?? null,
            accessModes: toJson(pv.spec?.accessModes ?? []),
            storageClass: pv.spec?.storageClassName ?? null,
            bindingMode: pv.status?.phase ?? null,
            spec: toJson({
              reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy,
              volumeMode: pv.spec?.volumeMode,
            }),
            statusJson: toJson({
              phase: pv.status?.phase,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            capacity: pv.spec?.capacity?.storage ?? null,
            accessModes: toJson(pv.spec?.accessModes ?? []),
            storageClass: pv.spec?.storageClassName ?? null,
            bindingMode: pv.status?.phase ?? null,
            spec: toJson({
              reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy,
              volumeMode: pv.spec?.volumeMode,
            }),
            statusJson: toJson({
              phase: pv.status?.phase,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedStorageResources(clusterId, 'PV', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `PersistentVolumes sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncPersistentVolumeClaims(
    clusterId: string,
    coreApi: k8s.CoreV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await coreApi.listPersistentVolumeClaimForAllNamespaces();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const pvc of items) {
        const namespace = pvc.metadata?.namespace ?? '';
        const name = pvc.metadata?.name ?? '';
        if (!namespace || !name) continue;
        liveKeys.add(`${namespace}/${name}`);
        const createdAt =
          pvc.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.storageResource.upsert({
          where: {
            clusterId_kind_name: {
              clusterId,
              kind: 'PVC',
              name,
            },
          },
          create: {
            clusterId,
            namespace,
            kind: 'PVC',
            name,
            state: 'active',
            capacity: pvc.status?.capacity?.storage ?? null,
            accessModes: toJson(pvc.spec?.accessModes ?? []),
            storageClass: pvc.spec?.storageClassName ?? null,
            bindingMode: pvc.status?.phase ?? null,
            spec: toJson({
              volumeName: pvc.spec?.volumeName,
              volumeMode: pvc.spec?.volumeMode,
            }),
            statusJson: toJson({
              phase: pvc.status?.phase,
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            namespace,
            capacity: pvc.status?.capacity?.storage ?? null,
            accessModes: toJson(pvc.spec?.accessModes ?? []),
            storageClass: pvc.spec?.storageClassName ?? null,
            bindingMode: pvc.status?.phase ?? null,
            spec: toJson({
              volumeName: pvc.spec?.volumeName,
              volumeMode: pvc.spec?.volumeMode,
            }),
            statusJson: toJson({
              phase: pvc.status?.phase,
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedStorageResources(clusterId, 'PVC', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `PersistentVolumeClaims sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  private async syncStorageClasses(
    clusterId: string,
    storageApi: k8s.StorageV1Api,
    errors: string[],
  ): Promise<number> {
    try {
      const resp = await storageApi.listStorageClass();
      const items = resp.items;
      const liveKeys = new Set<string>();

      for (const sc of items) {
        const name = sc.metadata?.name ?? '';
        if (!name) continue;
        liveKeys.add(`_cluster/${name}`);
        const createdAt = sc.metadata?.creationTimestamp?.toISOString() ?? null;

        await this.prisma.storageResource.upsert({
          where: {
            clusterId_kind_name: {
              clusterId,
              kind: 'SC',
              name,
            },
          },
          create: {
            clusterId,
            namespace: null,
            kind: 'SC',
            name,
            state: 'active',
            capacity: null,
            accessModes: toJson([]),
            storageClass: name,
            bindingMode: sc.volumeBindingMode ?? null,
            spec: toJson({
              provisioner: sc.provisioner,
              reclaimPolicy: sc.reclaimPolicy,
              allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
            }),
            statusJson: toJson({
              isDefault:
                (sc.metadata?.annotations?.[
                  'storageclass.kubernetes.io/is-default-class'
                ] ??
                  sc.metadata?.annotations?.[
                    'storageclass.beta.kubernetes.io/is-default-class'
                  ]) === 'true',
              creationTimestamp: createdAt,
            }),
          },
          update: {
            state: 'active',
            storageClass: name,
            bindingMode: sc.volumeBindingMode ?? null,
            spec: toJson({
              provisioner: sc.provisioner,
              reclaimPolicy: sc.reclaimPolicy,
              allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
            }),
            statusJson: toJson({
              isDefault:
                (sc.metadata?.annotations?.[
                  'storageclass.kubernetes.io/is-default-class'
                ] ??
                  sc.metadata?.annotations?.[
                    'storageclass.beta.kubernetes.io/is-default-class'
                  ]) === 'true',
              creationTimestamp: createdAt,
            }),
          },
        });
      }

      await this.markDeletedStorageResources(clusterId, 'SC', liveKeys);
      return liveKeys.size;
    } catch (err) {
      const msg = `StorageClasses sync failed: ${(err as Error).message}`;
      this.logger.error(msg);
      errors.push(msg);
      return 0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: 标记不在当前同步结果中的记录为 deleted
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * liveKeys 格式为 "namespace/name"
   */
  private async markDeletedWorkloads(
    clusterId: string,
    kind: string,
    liveKeys: Set<string>,
  ): Promise<void> {
    const existing = await this.prisma.workloadRecord.findMany({
      where: { clusterId, kind, state: { not: 'deleted' } },
      select: { id: true, namespace: true, name: true },
    });
    const staleIds = existing
      .filter((row) => !liveKeys.has(`${row.namespace}/${row.name}`))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.workloadRecord.updateMany({
        where: { id: { in: staleIds } },
        data: { state: 'deleted' },
      });
    }
  }

  private async markDeletedNetworkResources(
    clusterId: string,
    kind: string,
    liveKeys: Set<string>,
  ): Promise<void> {
    const existing = await this.prisma.networkResource.findMany({
      where: { clusterId, kind, state: { not: 'deleted' } },
      select: { id: true, namespace: true, name: true },
    });
    const staleIds = existing
      .filter((row) => !liveKeys.has(`${row.namespace}/${row.name}`))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.networkResource.updateMany({
        where: { id: { in: staleIds } },
        data: { state: 'deleted' },
      });
    }
  }

  private async markDeletedConfigResources(
    clusterId: string,
    kind: string,
    liveKeys: Set<string>,
  ): Promise<void> {
    const existing = await this.prisma.configResource.findMany({
      where: { clusterId, kind, state: { not: 'deleted' } },
      select: { id: true, namespace: true, name: true },
    });
    const staleIds = existing
      .filter((row) => !liveKeys.has(`${row.namespace}/${row.name}`))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.configResource.updateMany({
        where: { id: { in: staleIds } },
        data: { state: 'deleted' },
      });
    }
  }

  private async markDeletedStorageResources(
    clusterId: string,
    kind: string,
    liveKeys: Set<string>,
  ): Promise<void> {
    const existing = await this.prisma.storageResource.findMany({
      where: { clusterId, kind, state: { not: 'deleted' } },
      select: { id: true, namespace: true, name: true },
    });
    const staleIds = existing
      .filter(
        (row) => !liveKeys.has(`${row.namespace ?? '_cluster'}/${row.name}`),
      )
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.storageResource.updateMany({
        where: { id: { in: staleIds } },
        data: { state: 'deleted' },
      });
    }
  }
}
