import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as k8s from '@kubernetes/client-node';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import { HelmRepositoryStore } from '../helm/helm-repository.store';
import { HelmService } from '../helm/helm.service';
import { PrismaService } from '../platform/database/prisma.service';
import {
  RESOURCE_DETAIL_DESCRIPTOR_VERSION,
  type ResourceAssociation,
  type ResourceDetailConfigUsage,
  type ResourceDetailDescriptor,
  type ResourceDetailMetadata,
  type ResourceDetailNetworkEndpoint,
  type ResourceDetailNetworkPipeline,
  type ResourceDetailNetworkSummary,
  type ResourceDetailOverview,
  type ResourceDetailPvSummary,
  type ResourceDetailPvcSummary,
  type ResourceDetailRelationshipGroup,
  type ResourceDetailRelationshipGroupKey,
  type ResourceDetailRelationshipItem,
  type ResourceDetailRelationshipNode,
  type ResourceDetailResponse,
  type ResourceDetailRuntime,
  type ResourceDetailSection,
  type ResourceDetailStorageSummary,
  type ResourceDetailStorageClassSummary,
  type ResourceDetailStoragePipeline,
  type ResourceDetailVolumeSummary,
  type ResourceDetailMountSummary,
} from './resources-detail.contract';

type DetailSource =
  | 'workload'
  | 'network'
  | 'storage'
  | 'config'
  | 'namespace'
  | 'autoscaling';

type KindMeta = {
  kind: string;
  apiVersion: string;
  namespaced: boolean;
  scalable: boolean;
  imageMutable: boolean;
  detailSource?: DetailSource;
  storageKind?: 'PV' | 'PVC' | 'SC';
};

type DetailResourceRecord = {
  id: string;
  clusterId: string;
  namespace: string | null;
  kind: string;
  name: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  spec: Prisma.JsonValue | null;
  statusJson: Prisma.JsonValue | null;
  labels: Prisma.JsonValue | null;
  annotations: Prisma.JsonValue | null;
  replicas: number | null;
  readyReplicas: number | null;
  storageClass?: string | null;
};

type DetailContext = {
  workloads: DetailResourceRecord[];
  networkResources: DetailResourceRecord[];
  storageResources: DetailResourceRecord[];
  configResources: DetailResourceRecord[];
};

const LIVE_NETWORK_DETAIL_KINDS = new Set([
  'Service',
  'Endpoints',
  'EndpointSlice',
  'Ingress',
  'IngressRoute',
  'GatewayClass',
  'Gateway',
  'HTTPRoute',
  'Middleware',
  'NetworkPolicy',
]);

const RESOURCE_DETAIL_FIELDS_BY_SECTION = {
  overview: [
    'id',
    'clusterId',
    'namespace',
    'kind',
    'name',
    'state',
    'createdAt',
    'updatedAt',
  ],
  runtime: [
    'phase',
    'replicas',
    'readyReplicas',
    'availableReplicas',
    'restartCount',
    'image',
    'images',
    'podIP',
    'nodeName',
  ],
  associations: ['kind', 'name', 'namespace', 'associationType'],
  network: ['clusterIPs', 'podIPs', 'nodeNames', 'endpoints', 'networkPipelines'],
  storage: [
    'storageClasses',
    'persistentVolumeClaims',
    'persistentVolumes',
    'volumes',
    'mounts',
    'storagePipelines',
  ],
  events: ['items'],
  metadata: ['labels', 'annotations', 'ownerReferences', 'configUsages'],
} as const;

const RESOURCE_DETAIL_SECTION_PROFILES: Record<
  string,
  ResourceDetailSection[]
> = {
  pod: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  deployment: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  statefulset: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  daemonset: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  replicaset: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  job: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  cronjob: [
    'overview',
    'runtime',
    'associations',
    'network',
    'storage',
    'events',
    'metadata',
  ],
  service: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  ingress: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  ingressroute: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  gatewayclass: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  gateway: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  httproute: [
    'overview',
    'runtime',
    'associations',
    'network',
    'events',
    'metadata',
  ],
  middleware: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  endpoints: ['overview', 'associations', 'network', 'events', 'metadata'],
  endpointslice: ['overview', 'associations', 'network', 'events', 'metadata'],
  persistentvolume: [
    'overview',
    'runtime',
    'associations',
    'storage',
    'events',
    'metadata',
  ],
  pv: ['overview', 'runtime', 'associations', 'storage', 'events', 'metadata'],
  persistentvolumeclaim: [
    'overview',
    'runtime',
    'associations',
    'storage',
    'events',
    'metadata',
  ],
  pvc: ['overview', 'runtime', 'associations', 'storage', 'events', 'metadata'],
  storageclass: [
    'overview',
    'runtime',
    'associations',
    'storage',
    'events',
    'metadata',
  ],
  sc: ['overview', 'runtime', 'associations', 'storage', 'events', 'metadata'],
  configmap: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  secret: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  serviceaccount: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  horizontalpodautoscaler: [
    'overview',
    'runtime',
    'associations',
    'events',
    'metadata',
  ],
  hpa: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  verticalpodautoscaler: [
    'overview',
    'runtime',
    'associations',
    'events',
    'metadata',
  ],
  vpa: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  helmrelease: ['overview', 'runtime', 'associations', 'events', 'metadata'],
  helmrepository: ['overview', 'runtime', 'associations', 'events', 'metadata'],
};

const RELATIONSHIP_GROUP_META: Record<
  ResourceDetailRelationshipGroupKey,
  { title: string; description: string }
> = {
  control: {
    title: '控制关系',
    description: 'Owner、控制器与被控制对象',
  },
  network: {
    title: '网络关系',
    description: '入口、服务、端点与后端 Pod/IP',
  },
  storage: {
    title: '存储关系',
    description: '容器挂载、Volume、PVC、PV 与 StorageClass',
  },
  config: {
    title: '配置关系',
    description: 'ConfigMap、Secret、ServiceAccount 与使用方',
  },
  other: {
    title: '其他关系',
    description: '未归类但可导航的关联资源',
  },
};

export interface ResourceIdentity {
  clusterId: string;
  namespace?: string;
  kind: string;
  name: string;
}

export interface ResourceYamlUpdateRequest extends ResourceIdentity {
  yaml: string;
  dryRun?: boolean;
}

interface DiscoveryCapabilityItem {
  id: string;
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
  namespaced: boolean;
  verbs: string[];
  lastDiscoveredAt: string;
}

export interface DiscoveryRefreshResponse {
  clusterId: string;
  registered: number;
  timestamp: string;
}

export interface DiscoveryCatalogResponse {
  clusterId: string;
  items: DiscoveryCapabilityItem[];
  total: number;
  stale: boolean;
  refreshError?: string;
  timestamp: string;
}

export interface DynamicResourceQuery {
  clusterId?: string;
  group?: string;
  version?: string;
  resource?: string;
  namespace?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DynamicResourceIdentity {
  clusterId: string;
  group?: string;
  version?: string;
  resource?: string;
  namespace?: string;
  name?: string;
}

export interface DynamicResourceCreateRequest extends DynamicResourceIdentity {
  body: Record<string, unknown>;
}

@Injectable()
export class ResourcesService {
  private static readonly LIVE_NETWORK_ID_PREFIX = 'live:';
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    private readonly clustersService: ClustersService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly k8sClientService: K8sClientService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly kindMap: Record<string, KindMeta> = {
    pod: {
      kind: 'Pod',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'workload',
    },
    deployment: {
      kind: 'Deployment',
      apiVersion: 'apps/v1',
      namespaced: true,
      scalable: true,
      imageMutable: true,
      detailSource: 'workload',
    },
    statefulset: {
      kind: 'StatefulSet',
      apiVersion: 'apps/v1',
      namespaced: true,
      scalable: true,
      imageMutable: true,
      detailSource: 'workload',
    },
    daemonset: {
      kind: 'DaemonSet',
      apiVersion: 'apps/v1',
      namespaced: true,
      scalable: false,
      imageMutable: true,
      detailSource: 'workload',
    },
    replicaset: {
      kind: 'ReplicaSet',
      apiVersion: 'apps/v1',
      namespaced: true,
      scalable: true,
      imageMutable: true,
      detailSource: 'workload',
    },
    job: {
      kind: 'Job',
      apiVersion: 'batch/v1',
      namespaced: true,
      scalable: false,
      imageMutable: true,
      detailSource: 'workload',
    },
    cronjob: {
      kind: 'CronJob',
      apiVersion: 'batch/v1',
      namespaced: true,
      scalable: false,
      imageMutable: true,
      detailSource: 'workload',
    },
    service: {
      kind: 'Service',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    ingress: {
      kind: 'Ingress',
      apiVersion: 'networking.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    ingressroute: {
      kind: 'IngressRoute',
      apiVersion: 'traefik.io/v1alpha1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    gatewayclass: {
      kind: 'GatewayClass',
      apiVersion: 'gateway.networking.k8s.io/v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    gateway: {
      kind: 'Gateway',
      apiVersion: 'gateway.networking.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    httproute: {
      kind: 'HTTPRoute',
      apiVersion: 'gateway.networking.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    'network-policy': {
      kind: 'NetworkPolicy',
      apiVersion: 'networking.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    middleware: {
      kind: 'Middleware',
      apiVersion: 'traefik.io/v1alpha1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    endpoints: {
      kind: 'Endpoints',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    endpointslice: {
      kind: 'EndpointSlice',
      apiVersion: 'discovery.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'network',
    },
    configmap: {
      kind: 'ConfigMap',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'config',
    },
    secret: {
      kind: 'Secret',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'config',
    },
    serviceaccount: {
      kind: 'ServiceAccount',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'config',
    },
    persistentvolumeclaim: {
      kind: 'PersistentVolumeClaim',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'PVC',
    },
    pvc: {
      kind: 'PersistentVolumeClaim',
      apiVersion: 'v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'PVC',
    },
    persistentvolume: {
      kind: 'PersistentVolume',
      apiVersion: 'v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'PV',
    },
    pv: {
      kind: 'PersistentVolume',
      apiVersion: 'v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'PV',
    },
    storageclass: {
      kind: 'StorageClass',
      apiVersion: 'storage.k8s.io/v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'SC',
    },
    sc: {
      kind: 'StorageClass',
      apiVersion: 'storage.k8s.io/v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'storage',
      storageKind: 'SC',
    },
    namespace: {
      kind: 'Namespace',
      apiVersion: 'v1',
      namespaced: false,
      scalable: false,
      imageMutable: false,
      detailSource: 'namespace',
    },
    horizontalpodautoscaler: {
      kind: 'HorizontalPodAutoscaler',
      apiVersion: 'autoscaling/v2',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'autoscaling',
    },
    hpa: {
      kind: 'HorizontalPodAutoscaler',
      apiVersion: 'autoscaling/v2',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'autoscaling',
    },
    verticalpodautoscaler: {
      kind: 'VerticalPodAutoscaler',
      apiVersion: 'autoscaling.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'autoscaling',
    },
    vpa: {
      kind: 'VerticalPodAutoscaler',
      apiVersion: 'autoscaling.k8s.io/v1',
      namespaced: true,
      scalable: false,
      imageMutable: false,
      detailSource: 'autoscaling',
    },
  };

  async getYaml(identity: ResourceIdentity) {
    const meta = this.resolveKind(identity.kind);
    const namespace = this.resolveNamespace(meta, identity.namespace);
    const client = await this.makeObjectClient(identity.clusterId);

    const obj = await client.read({
      apiVersion: meta.apiVersion,
      kind: meta.kind,
      metadata: {
        name: identity.name,
        ...(namespace ? { namespace } : {}),
      },
    });

    const sanitized = this.sanitizeForManifest(obj as Record<string, unknown>);
    return {
      clusterId: identity.clusterId,
      namespace,
      kind: meta.kind,
      name: identity.name,
      yaml: k8s.dumpYaml(sanitized),
      resourceVersion: this.extractResourceVersion(obj),
      updatedAt: new Date().toISOString(),
    };
  }

  async refreshDiscoveryCatalog(
    clusterId: string,
  ): Promise<DiscoveryRefreshResponse> {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    await this.clusterHealthService.assertClusterOnlineForRead(
      normalizedClusterId,
    );
    const discovered = await this.discoverCapabilities(normalizedClusterId);
    const capabilityModel = (this.prisma as any).apiResourceCapability;
    if (!capabilityModel) {
      throw new BadRequestException(
        'ApiResourceCapability 模型未就绪，请先执行 prisma generate',
      );
    }
    await capabilityModel.deleteMany({
      where: { clusterId: normalizedClusterId },
    });
    if (discovered.length > 0) {
      await capabilityModel.createMany({
        data: discovered.map((item) => ({
          clusterId: normalizedClusterId,
          group: item.group,
          version: item.version,
          kind: item.kind,
          resource: item.resource,
          namespaced: item.namespaced,
          verbsJson: item.verbs,
          lastDiscoveredAt: item.lastDiscoveredAt,
        })),
        skipDuplicates: true,
      });
    }

    return {
      clusterId: normalizedClusterId,
      registered: discovered.length,
      timestamp: new Date().toISOString(),
    };
  }

  async getDiscoveryCatalog(
    clusterId: string,
    opts?: { refresh?: boolean },
  ): Promise<DiscoveryCatalogResponse> {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    await this.clusterHealthService.assertClusterOnlineForRead(
      normalizedClusterId,
    );

    let stale = false;
    let refreshError: string | undefined;
    if (opts?.refresh) {
      try {
        await this.refreshDiscoveryCatalog(normalizedClusterId);
      } catch (error) {
        stale = true;
        refreshError = this.errorMessage(error);
      }
    }

    const capabilityModel = (this.prisma as any).apiResourceCapability;
    if (!capabilityModel) {
      throw new BadRequestException(
        'ApiResourceCapability 模型未就绪，请先执行 prisma generate',
      );
    }
    const rows = await capabilityModel.findMany({
      where: { clusterId: normalizedClusterId },
      orderBy: [{ group: 'asc' }, { version: 'asc' }, { resource: 'asc' }],
    });
    const items: DiscoveryCapabilityItem[] = rows.map((row: any) => ({
      id: row.id,
      clusterId: row.clusterId,
      group: row.group,
      version: row.version,
      kind: row.kind,
      resource: row.resource,
      namespaced: row.namespaced,
      verbs: this.parseStringArray(row.verbsJson),
      lastDiscoveredAt: row.lastDiscoveredAt.toISOString(),
    }));

    return {
      clusterId: normalizedClusterId,
      items,
      total: items.length,
      stale,
      ...(refreshError ? { refreshError } : {}),
      timestamp: new Date().toISOString(),
    };
  }

  async listDynamicResources(query: DynamicResourceQuery): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespaced: boolean;
    page: number;
    pageSize: number;
    total: number;
    items: Array<{
      id: string;
      clusterId: string;
      namespace: string;
      name: string;
      kind: string;
      apiVersion: string;
      state: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
    timestamp: string;
  }> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const keyword = query.keyword?.trim().toLowerCase();
    const sortBy = this.normalizeDynamicSortBy(query.sortBy);
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const normalizedQueryClusterId = query.clusterId?.trim();
    if (normalizedQueryClusterId) {
      const capability = await this.findDynamicCapability({
        clusterId: normalizedQueryClusterId,
        group: query.group,
        version: query.version,
        resource: query.resource,
      });
      const namespace =
        capability.namespaced && query.namespace?.trim()
          ? query.namespace.trim()
          : undefined;
      const client = await this.makeObjectClient(normalizedQueryClusterId);
      const list = (await client.list(
        this.toApiVersion(capability.group, capability.version),
        capability.kind,
        namespace,
      )) as { items?: any[] };
      const rawItems = Array.isArray(list.items) ? list.items : [];
      const normalizedItems = rawItems
        .map((item) => {
          const metadata = this.toRecord(item?.metadata);
          const status = this.toRecord(item?.status);
          const name = this.asString(metadata.name);
          const ns = this.asString(metadata.namespace);
          const labels = this.toStringMap(metadata.labels);
          if (!name) {
            return null;
          }
          const state =
            this.asString(status.phase) ||
            this.asString(status.state) ||
            this.asString(status.reason) ||
            'unknown';
          return {
            id: `${normalizedQueryClusterId}/${ns}/${name}`,
            clusterId: normalizedQueryClusterId,
            namespace: ns,
            name,
            kind: capability.kind,
            apiVersion: this.toApiVersion(capability.group, capability.version),
            state,
            labels,
            createdAt: this.asString(metadata.creationTimestamp) || undefined,
            updatedAt: undefined,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const filtered = keyword
        ? normalizedItems.filter((item) =>
            `${item.name} ${item.namespace} ${item.state}`
              .toLowerCase()
              .includes(keyword),
          )
        : normalizedItems;
      const sorted = this.sortDynamicItems(filtered, sortBy, sortOrder);
      const total = sorted.length;
      const start = (page - 1) * pageSize;
      const items = sorted.slice(start, start + pageSize);

      return {
        clusterId: normalizedQueryClusterId,
        group: capability.group,
        version: capability.version,
        resource: capability.resource,
        kind: capability.kind,
        namespaced: capability.namespaced,
        page,
        pageSize,
        total,
        items,
        timestamp: new Date().toISOString(),
      };
    }

    const clusterIds = await this.resolveDynamicClusterIds(undefined);
    if (clusterIds.length === 0) {
      return {
        clusterId: '',
        group: query.group?.trim() ?? '',
        version: query.version?.trim() ?? '',
        resource: query.resource?.trim() ?? '',
        kind: '',
        namespaced: false,
        page,
        pageSize,
        total: 0,
        items: [],
        timestamp: new Date().toISOString(),
      };
    }

    const results = await Promise.allSettled(
      clusterIds.map(async (clusterId) => {
        const capability = await this.findDynamicCapability({
          clusterId,
          group: query.group,
          version: query.version,
          resource: query.resource,
        });
        const namespace =
          capability.namespaced && query.namespace?.trim() && normalizedQueryClusterId
            ? query.namespace.trim()
            : undefined;
        const client = await this.makeObjectClient(clusterId);
        const list = (await client.list(
          this.toApiVersion(capability.group, capability.version),
          capability.kind,
          namespace,
        )) as { items?: any[] };
        const rawItems = Array.isArray(list.items) ? list.items : [];
        const normalizedItems = rawItems
          .map((item) => {
            const metadata = this.toRecord(item?.metadata);
            const status = this.toRecord(item?.status);
            const name = this.asString(metadata.name);
            const ns = this.asString(metadata.namespace);
            const labels = this.toStringMap(metadata.labels);
            if (!name) {
              return null;
            }
            const state =
              this.asString(status.phase) ||
              this.asString(status.state) ||
              this.asString(status.reason) ||
              'unknown';
            return {
              id: `${clusterId}/${ns}/${name}`,
              clusterId,
              namespace: ns,
              name,
              kind: capability.kind,
              apiVersion: this.toApiVersion(
                capability.group,
                capability.version,
              ),
              state,
              labels,
              createdAt: this.asString(metadata.creationTimestamp) || undefined,
              updatedAt: undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        return {
          capability,
          items: normalizedItems,
        };
      }),
    );

    const fulfilled = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const aggregatedItems = fulfilled.flatMap((item) => item.items);
    const firstCapability = fulfilled[0]?.capability;

    const filtered = keyword
      ? aggregatedItems.filter((item) =>
          `${item.name} ${item.namespace} ${item.state}`
            .toLowerCase()
            .includes(keyword),
        )
      : aggregatedItems;
    const sorted = this.sortDynamicItems(filtered, sortBy, sortOrder);
    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);

    return {
      clusterId: normalizedQueryClusterId ?? '',
      group: firstCapability?.group ?? query.group?.trim() ?? '',
      version: firstCapability?.version ?? query.version?.trim() ?? '',
      resource: firstCapability?.resource ?? query.resource?.trim() ?? '',
      kind: firstCapability?.kind ?? '',
      namespaced: firstCapability?.namespaced ?? false,
      page,
      pageSize,
      total,
      items,
      timestamp: new Date().toISOString(),
    };
  }

  private async resolveDynamicClusterIds(clusterId?: string): Promise<string[]> {
    if (clusterId?.trim()) {
      return [clusterId.trim()];
    }
    // 统一仅使用“可读且在线”的集群集合，避免把离线/历史快照集群回流到全站列表。
    return this.clusterHealthService.listReadableClusterIdsForResourceRead();
  }

  private normalizeDynamicSortBy(sortBy?: string): 'name' | 'namespace' | 'clusterId' | 'createdAt' | 'updatedAt' {
    const value = sortBy?.trim();
    if (
      value === 'name' ||
      value === 'namespace' ||
      value === 'clusterId' ||
      value === 'createdAt' ||
      value === 'updatedAt'
    ) {
      return value;
    }
    return 'createdAt';
  }

  private sortDynamicItems<T extends {
    name: string;
    namespace: string;
    clusterId: string;
    createdAt?: string;
    updatedAt?: string;
  }>(
    items: T[],
    sortBy: 'name' | 'namespace' | 'clusterId' | 'createdAt' | 'updatedAt',
    sortOrder: 'asc' | 'desc',
  ): T[] {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const toTime = (value?: string): number => {
      if (!value) return 0;
      const ts = Date.parse(value);
      return Number.isFinite(ts) ? ts : 0;
    };
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        cmp =
          toTime(a[sortBy]) - toTime(b[sortBy]);
      } else {
        cmp = a[sortBy].localeCompare(b[sortBy], 'zh-CN', {
          sensitivity: 'base',
          numeric: true,
        });
      }
      if (cmp !== 0) {
        return cmp * direction;
      }
      return a.name.localeCompare(b.name, 'zh-CN', {
        sensitivity: 'base',
        numeric: true,
      });
    });
  }

  async getDynamicResourceDetail(identity: DynamicResourceIdentity): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespace: string;
    name: string;
    yaml: string;
    raw: unknown;
    timestamp: string;
  }> {
    const { capability, clusterId, namespace, name } =
      await this.resolveDynamicIdentity(identity);
    const client = await this.makeObjectClient(clusterId);
    const obj = await client.read({
      apiVersion: this.toApiVersion(capability.group, capability.version),
      kind: capability.kind,
      metadata: {
        name,
        ...(namespace ? { namespace } : {}),
      },
    });
    return {
      clusterId,
      group: capability.group,
      version: capability.version,
      resource: capability.resource,
      kind: capability.kind,
      namespace,
      name,
      yaml: k8s.dumpYaml(this.sanitizeForManifest(this.toRecord(obj))),
      raw: obj,
      timestamp: new Date().toISOString(),
    };
  }

  async updateDynamicYaml(
    input: DynamicResourceIdentity & { yaml?: string; dryRun?: boolean },
  ): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespace: string;
    name: string;
    dryRun: boolean;
    message: string;
    timestamp: string;
  }> {
    const { capability, clusterId, namespace, name } =
      await this.resolveDynamicIdentity(input);
    const rawYaml = input.yaml?.trim();
    if (!rawYaml) {
      throw new BadRequestException('yaml 不能为空');
    }
    let parsed: any;
    try {
      parsed = k8s.loadYaml(rawYaml);
    } catch (error) {
      throw new BadRequestException(
        `YAML 解析失败：${error instanceof Error ? error.message : '格式错误'}`,
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('YAML 内容无效');
    }
    parsed.apiVersion =
      parsed.apiVersion ||
      this.toApiVersion(capability.group, capability.version);
    parsed.kind = parsed.kind || capability.kind;
    parsed.metadata = parsed.metadata || {};
    parsed.metadata.name = parsed.metadata.name || name;
    if (capability.namespaced) {
      parsed.metadata.namespace = parsed.metadata.namespace || namespace;
    } else if (parsed.metadata.namespace) {
      delete parsed.metadata.namespace;
    }
    if (
      parsed.kind !== capability.kind ||
      parsed.metadata.name !== name ||
      (capability.namespaced && parsed.metadata.namespace !== namespace)
    ) {
      throw new BadRequestException(
        'YAML 的 kind/name/namespace 必须与目标资源一致',
      );
    }
    delete parsed.status;
    const client = await this.makeObjectClient(clusterId);
    await client.patch(
      parsed,
      undefined,
      input.dryRun ? 'All' : undefined,
      'k8s-aiops-manager',
      true,
      k8s.PatchStrategy.ServerSideApply,
    );
    return {
      clusterId,
      group: capability.group,
      version: capability.version,
      resource: capability.resource,
      kind: capability.kind,
      namespace,
      name,
      dryRun: Boolean(input.dryRun),
      message: input.dryRun ? 'YAML 校验通过（dry-run）' : 'YAML 已成功应用',
      timestamp: new Date().toISOString(),
    };
  }

  async createDynamicResource(input: DynamicResourceCreateRequest): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespace: string;
    name: string;
    message: string;
    timestamp: string;
  }> {
    const { capability, clusterId, namespace, name } =
      await this.resolveDynamicIdentity(input);
    const client = await this.makeObjectClient(clusterId);
    const body = input.body ?? {};
    const metadata =
      body.metadata &&
      typeof body.metadata === 'object' &&
      !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};
    const bodyWithoutMeta = { ...body };
    delete (bodyWithoutMeta as Record<string, unknown>).apiVersion;
    delete (bodyWithoutMeta as Record<string, unknown>).kind;
    delete (bodyWithoutMeta as Record<string, unknown>).metadata;
    const manifest = {
      apiVersion:
        body.apiVersion ||
        this.toApiVersion(capability.group, capability.version),
      kind: body.kind || capability.kind,
      metadata: {
        ...metadata,
        name: metadata.name || name,
        ...(capability.namespaced
          ? { namespace: metadata.namespace || namespace }
          : {}),
      },
      ...bodyWithoutMeta,
    } as Record<string, unknown>;
    if (
      !capability.namespaced &&
      manifest.metadata &&
      typeof manifest.metadata === 'object'
    ) {
      const meta = manifest.metadata as Record<string, unknown>;
      delete meta.namespace;
    }
    if (
      manifest.kind !== capability.kind ||
      (manifest.metadata as Record<string, unknown>).name !== name ||
      (capability.namespaced &&
        (manifest.metadata as Record<string, unknown>).namespace !== namespace)
    ) {
      throw new BadRequestException(
        'body 的 kind/name/namespace 必须与目标资源一致',
      );
    }
    await client.create(manifest);
    return {
      clusterId,
      group: capability.group,
      version: capability.version,
      resource: capability.resource,
      kind: capability.kind,
      namespace,
      name,
      message: '资源已创建',
      timestamp: new Date().toISOString(),
    };
  }

  async deleteDynamicResource(identity: DynamicResourceIdentity): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespace: string;
    name: string;
    message: string;
    timestamp: string;
  }> {
    const { capability, clusterId, namespace, name } =
      await this.resolveDynamicIdentity(identity);
    const client = await this.makeObjectClient(clusterId);
    await client.delete({
      apiVersion: this.toApiVersion(capability.group, capability.version),
      kind: capability.kind,
      metadata: {
        name,
        ...(namespace ? { namespace } : {}),
      },
    });
    return {
      clusterId,
      group: capability.group,
      version: capability.version,
      resource: capability.resource,
      kind: capability.kind,
      namespace,
      name,
      message: '资源已删除',
      timestamp: new Date().toISOString(),
    };
  }

  async updateYaml(input: ResourceYamlUpdateRequest) {
    const meta = this.resolveKind(input.kind);
    const namespace = this.resolveNamespace(meta, input.namespace);
    const client = await this.makeObjectClient(input.clusterId);

    let parsed: any;
    try {
      parsed = k8s.loadYaml(input.yaml);
    } catch (error) {
      throw new BadRequestException(
        `YAML 解析失败：${error instanceof Error ? error.message : '格式错误'}`,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('YAML 内容无效');
    }

    parsed.apiVersion = parsed.apiVersion || meta.apiVersion;
    parsed.kind = parsed.kind || meta.kind;
    parsed.metadata = parsed.metadata || {};
    parsed.metadata.name = parsed.metadata.name || input.name;

    if (meta.namespaced) {
      parsed.metadata.namespace = parsed.metadata.namespace || namespace;
    } else if (parsed.metadata.namespace) {
      delete parsed.metadata.namespace;
    }

    if (parsed.kind !== meta.kind || parsed.metadata.name !== input.name) {
      throw new BadRequestException('YAML 的 kind/name 必须与目标资源一致');
    }

    if (meta.namespaced && parsed.metadata.namespace !== namespace) {
      throw new BadRequestException('YAML 的 namespace 必须与目标资源一致');
    }

    delete parsed.status;

    const applied = await client.patch(
      parsed,
      undefined,
      input.dryRun ? 'All' : undefined,
      'k8s-aiops-manager',
      true,
      k8s.PatchStrategy.ServerSideApply,
    );

    return {
      clusterId: input.clusterId,
      namespace,
      kind: meta.kind,
      name: input.name,
      yaml: k8s.dumpYaml(
        this.sanitizeForManifest(applied as Record<string, unknown>),
      ),
      resourceVersion: this.extractResourceVersion(applied),
      dryRun: Boolean(input.dryRun),
      message: input.dryRun ? 'YAML 校验通过（dry-run）' : 'YAML 已成功应用',
      updatedAt: new Date().toISOString(),
    };
  }

  async scaleResource(identity: ResourceIdentity, replicas: number) {
    const meta = this.resolveKind(identity.kind);
    if (!meta.scalable) {
      throw new BadRequestException(`${meta.kind} 不支持副本扩缩容`);
    }
    const namespace = this.resolveNamespace(meta, identity.namespace);
    const client = await this.makeObjectClient(identity.clusterId);

    const patch = {
      apiVersion: meta.apiVersion,
      kind: meta.kind,
      metadata: {
        name: identity.name,
        ...(namespace ? { namespace } : {}),
      },
      spec: {
        replicas,
      },
    };

    await client.patch(
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.MergePatch,
    );

    return {
      clusterId: identity.clusterId,
      namespace,
      kind: meta.kind,
      name: identity.name,
      replicas,
      message: `已提交副本调整：${replicas}`,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateImage(
    identity: ResourceIdentity,
    image: string,
    container?: string,
  ) {
    const meta = this.resolveKind(identity.kind);
    if (!meta.imageMutable) {
      throw new BadRequestException(`${meta.kind} 不支持镜像更新`);
    }
    const namespace = this.resolveNamespace(meta, identity.namespace);
    const client = await this.makeObjectClient(identity.clusterId);

    const current = await client.read({
      apiVersion: meta.apiVersion,
      kind: meta.kind,
      metadata: {
        name: identity.name,
        ...(namespace ? { namespace } : {}),
      },
    });

    const containers = this.getWorkloadContainers(meta.kind, current);
    if (!containers.length) {
      throw new BadRequestException('未找到可更新镜像的容器定义');
    }

    const target = container
      ? containers.find((it) => it.name === container)
      : containers[0];

    if (!target?.name) {
      throw new BadRequestException('未找到目标容器，请检查 container 参数');
    }

    const patch = this.buildImagePatch(
      meta,
      identity.name,
      namespace,
      target.name,
      image,
    );

    await client.patch(
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.StrategicMergePatch,
    );

    return {
      clusterId: identity.clusterId,
      namespace,
      kind: meta.kind,
      name: identity.name,
      container: target.name,
      image,
      message: `已提交镜像更新：${target.name} -> ${image}`,
      updatedAt: new Date().toISOString(),
    };
  }

  async getDetail(
    kindRaw: string,
    id: string,
  ): Promise<ResourceDetailResponse> {
    const normalizedKind = this.normalizeKindKey(kindRaw);
    if (normalizedKind === 'helmrelease') {
      return this.buildHelmReleaseDetail(id);
    }
    if (normalizedKind === 'helmrepository') {
      return this.buildHelmRepositoryDetail(id);
    }

    const meta = this.resolveKind(kindRaw);
    if (!meta.detailSource) {
      throw new BadRequestException(`${meta.kind} 暂不支持详情聚合`);
    }

    const base = await this.findDetailResource(meta, id);
    if (!base) {
      throw new NotFoundException('未找到目标资源详情');
    }
    await this.clusterHealthService.assertClusterOnlineForRead(base.clusterId);

    const [context, events] = await Promise.all([
      this.loadDetailContext(base.clusterId, base.namespace),
      this.buildEventsSummary(base),
    ]);
    const descriptor = this.buildDescriptor(base.kind);
    const overview = this.buildOverview(base);
    const runtime = this.buildRuntime(base);
    const associations = this.buildAssociations(base, context);
    const network = this.buildNetworkSummary(base, runtime, context);
    const storage = this.buildStorageSummary(base, context);
    const metadata = this.buildMetadata(base, context);
    const relationships = this.buildRelationshipGroups(
      base,
      context,
      associations,
      network,
      storage,
      metadata,
    );

    return {
      descriptor,
      overview,
      runtime,
      associations,
      network,
      storage,
      events,
      metadata,
      relationships,
      generatedAt: new Date().toISOString(),
    };
  }

  private async buildHelmReleaseDetail(
    id: string,
  ): Promise<ResourceDetailResponse> {
    const { clusterId, namespace, name } = this.parseHelmReleaseDetailId(id);
    await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    const payload = await this.makeHelmService().getRelease(name, {
      clusterId,
      namespace,
    });
    const detail = this.toObject(payload);
    const info = this.toObject(detail.info);
    const state =
      this.toMaybeString(info.status) ??
      this.toMaybeString(detail.status) ??
      'unknown';
    const createdAt =
      this.normalizeDetailTimestamp(
        this.toMaybeString(info.first_deployed) ??
          this.toMaybeString(info.firstDeployed),
      ) ?? new Date().toISOString();
    const updatedAt =
      this.normalizeDetailTimestamp(
        this.toMaybeString(info.last_deployed) ??
          this.toMaybeString(info.lastDeployed),
      ) ?? createdAt;

    return {
      descriptor: this.buildDescriptor('HelmRelease'),
      overview: {
        id,
        clusterId,
        namespace,
        kind: 'HelmRelease',
        name,
        state,
        createdAt,
        updatedAt,
      },
      runtime: {
        phase: state,
        images: [],
      },
      associations: [],
      network: {
        clusterIPs: [],
        podIPs: [],
        nodeNames: [],
        endpoints: [],
        networkPipelines: [],
      },
      storage: {
        storageClasses: [],
        persistentVolumeClaims: [],
        persistentVolumes: [],
        storageClassDetails: [],
        volumes: [],
        mounts: [],
        storagePipelines: [],
      },
      events: {
        items: [],
      },
      metadata: {
        labels: {},
        annotations: this.compactStringMap({
          chart: this.toMaybeString(detail.chart),
          appVersion:
            this.toMaybeString(detail.app_version) ??
            this.toMaybeString(detail.appVersion),
          revision: this.valueToString(detail.version),
          description: this.toMaybeString(info.description),
        }),
        ownerReferences: [],
        configUsages: [],
      },
      relationships: [],
      generatedAt: new Date().toISOString(),
    };
  }

  private async buildHelmRepositoryDetail(
    id: string,
  ): Promise<ResourceDetailResponse> {
    const { clusterId, name } = this.parseHelmRepositoryDetailId(id);
    await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    const payload = await this.makeHelmService().listRepositories({
      clusterId,
    });
    const items = Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items: unknown[] }).items ?? [])
      : [];
    const repository = items
      .map((item) => this.toObject(item))
      .find((item) => this.toMaybeString(item.name) === name);

    if (!repository) {
      throw new NotFoundException('未找到目标 Helm 仓库详情');
    }

    const state = this.toMaybeString(repository.syncStatus) ?? 'unknown';
    const createdAt =
      this.normalizeDetailTimestamp(this.toMaybeString(repository.createdAt)) ??
      new Date().toISOString();
    const updatedAt =
      this.normalizeDetailTimestamp(this.toMaybeString(repository.updatedAt)) ??
      createdAt;

    return {
      descriptor: this.buildDescriptor('HelmRepository'),
      overview: {
        id,
        clusterId,
        kind: 'HelmRepository',
        name,
        state,
        createdAt,
        updatedAt,
      },
      runtime: {
        phase: state,
        images: [],
      },
      associations: [],
      network: {
        clusterIPs: [],
        podIPs: [],
        nodeNames: [],
        endpoints: [],
        networkPipelines: [],
      },
      storage: {
        storageClasses: [],
        persistentVolumeClaims: [],
        persistentVolumes: [],
        storageClassDetails: [],
        volumes: [],
        mounts: [],
        storagePipelines: [],
      },
      events: {
        items: [],
      },
      metadata: {
        labels: {},
        annotations: this.compactStringMap({
          url: this.toMaybeString(repository.url),
          authType: this.toMaybeString(repository.authType),
          syncStatus: this.toMaybeString(repository.syncStatus),
          lastSyncAt: this.toMaybeString(repository.lastSyncAt),
          message: this.toMaybeString(repository.message),
        }),
        ownerReferences: [],
        configUsages: [],
      },
      relationships: [],
      generatedAt: new Date().toISOString(),
    };
  }

  private buildDescriptor(kind: string): ResourceDetailDescriptor {
    const normalizedKind = this.normalizeKindKey(kind);
    const sections = RESOURCE_DETAIL_SECTION_PROFILES[normalizedKind] ?? [
      'overview',
      'runtime',
      'associations',
      'events',
      'metadata',
    ];
    return {
      resourceKind: kind,
      sections: [...sections],
      fieldsBySection: {
        overview: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.overview],
        runtime: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.runtime],
        associations: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.associations],
        network: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.network],
        storage: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.storage],
        events: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.events],
        metadata: [...RESOURCE_DETAIL_FIELDS_BY_SECTION.metadata],
      },
      version: RESOURCE_DETAIL_DESCRIPTOR_VERSION,
    };
  }

  private buildOverview(base: DetailResourceRecord): ResourceDetailOverview {
    return {
      id: base.id,
      clusterId: base.clusterId,
      namespace: base.namespace ?? undefined,
      kind: base.kind,
      name: base.name,
      state: base.state,
      createdAt: base.createdAt.toISOString(),
      updatedAt: base.updatedAt.toISOString(),
    };
  }

  private buildRuntime(base: DetailResourceRecord): ResourceDetailRuntime {
    const status = this.toObject(base.statusJson);
    const spec = this.toObject(base.spec);
    const podSpec = this.isWorkloadKind(base.kind)
      ? this.extractPodSpec(base.kind, base.spec)
      : {};
    const networkPolicyRuntime =
      base.kind === 'NetworkPolicy'
        ? this.buildNetworkPolicyRuntime(spec, status)
        : {};
    const images = this.toStringArray(status.images ?? status.containerImages);
    const conditions = this.toArray(status.conditions)
      .map((condition) => this.toObject(condition))
      .filter((condition) => Object.keys(condition).length > 0)
      .map((condition) => ({
        type: this.toMaybeString(condition.type),
        status: this.toMaybeString(condition.status),
        reason: this.toMaybeString(condition.reason),
        message: this.toMaybeString(condition.message),
        lastTransitionTime: this.normalizeDetailTimestamp(
          this.toMaybeString(condition.lastTransitionTime),
        ),
      }));
    return {
      phase: this.toMaybeString(status.phase),
      replicas: base.replicas ?? this.toMaybeNumber(status.replicas),
      readyReplicas:
        base.readyReplicas ?? this.toMaybeNumber(status.readyReplicas),
      availableReplicas: this.toMaybeNumber(status.availableReplicas),
      restartCount: this.toMaybeNumber(status.restartCount),
      image: this.toMaybeString(status.image) ?? images[0],
      images,
      podIP: this.toMaybeString(status.podIP),
      nodeName: this.toMaybeString(status.nodeName),
      selector: this.extractSelectorString(base.kind, spec),
      serviceAccountName: this.toMaybeString(podSpec.serviceAccountName),
      restartPolicy: this.toMaybeString(podSpec.restartPolicy),
      dnsPolicy: this.toMaybeString(podSpec.dnsPolicy),
      schedulerName: this.toMaybeString(podSpec.schedulerName),
      priorityClassName: this.toMaybeString(podSpec.priorityClassName),
      nodeSelector: this.toStringMap(podSpec.nodeSelector),
      tolerations: this.summarizeTolerations(podSpec.tolerations),
      containerDetails: this.summarizeContainers(podSpec, status),
      ...networkPolicyRuntime,
      ...(conditions.length > 0 ? { conditions } : {}),
    };
  }

  private buildAssociations(
    base: DetailResourceRecord,
    context: DetailContext,
  ): ResourceAssociation[] {
    const map = new Map<string, ResourceAssociation>();
    const resources = [
      ...context.workloads,
      ...context.networkResources,
      ...context.storageResources,
      ...context.configResources,
    ];
    const add = (
      kind: string,
      name: string,
      namespace: string | undefined,
      associationType: string,
    ) => {
      const key = `${kind}:${namespace ?? ''}:${name}:${associationType}`;
      if (map.has(key)) {
        return;
      }
      const matched = resources.find(
        (item) =>
          item.kind === kind &&
          item.name === name &&
          (item.namespace ?? undefined) === namespace,
      );
      const liveId =
        !matched && namespace
          ? this.buildLiveNetworkId(base.clusterId, kind, namespace, name)
          : undefined;
      map.set(key, {
        ...(matched?.id || liveId ? { id: matched?.id ?? liveId } : {}),
        kind,
        name,
        ...(namespace ? { namespace } : {}),
        associationType,
      });
    };

    const namespace = base.namespace ?? undefined;

    if (this.isWorkloadKind(base.kind)) {
      if (base.kind !== 'Pod') {
        for (const pod of context.workloads) {
          if (pod.kind !== 'Pod' || pod.namespace !== namespace) {
            continue;
          }
          const status = this.toObject(pod.statusJson);
          const ownerReferences = this.toArray(status.ownerReferences);
          const owned = ownerReferences.some((owner) => {
            const ownerObj = this.toObject(owner);
            return (
              this.toMaybeString(ownerObj.kind) === base.kind &&
              this.toMaybeString(ownerObj.name) === base.name
            );
          });
          if (owned) {
            add('Pod', pod.name, pod.namespace ?? undefined, 'owned-pod');
          }
        }
      } else {
        const status = this.toObject(base.statusJson);
        for (const owner of this.toArray(status.ownerReferences)) {
          const ownerObj = this.toObject(owner);
          const kind = this.toMaybeString(ownerObj.kind);
          const name = this.toMaybeString(ownerObj.name);
          if (kind && name) {
            add(kind, name, namespace, 'owner');
          }
        }
      }

      const refs = this.extractWorkloadRefs(base.kind, base.spec);
      for (const pvcName of refs.pvcNames) {
        add('PersistentVolumeClaim', pvcName, namespace, 'mount-claim');
      }
      for (const configMapName of refs.configMapNames) {
        add('ConfigMap', configMapName, namespace, 'config-ref');
      }
      for (const secretName of refs.secretNames) {
        add('Secret', secretName, namespace, 'secret-ref');
      }

      const podSpec = this.extractPodSpec(base.kind, base.spec);
      const volumes = this.toArray(podSpec.volumes).map((item) =>
        this.toObject(item),
      );
      for (const volume of volumes) {
        const projected = this.toObject(volume.projected);
        const projectedSources = this.toArray(projected.sources).map((item) =>
          this.toObject(item),
        );
        for (const source of projectedSources) {
          const configMap = this.toObject(source.configMap);
          const secret = this.toObject(source.secret);
          const configMapName = this.toMaybeString(configMap.name);
          const secretName = this.toMaybeString(secret.name);
          if (configMapName) {
            add('ConfigMap', configMapName, namespace, 'config-ref');
          }
          if (secretName) {
            add('Secret', secretName, namespace, 'secret-ref');
          }
        }
      }
    }

    if (base.kind === 'Service') {
      for (const networkResource of context.networkResources) {
        if (networkResource.namespace !== namespace) {
          continue;
        }
        const serviceNames =
          networkResource.kind === 'Ingress'
            ? this.extractIngressServiceNames(networkResource.spec)
            : networkResource.kind === 'IngressRoute'
              ? this.extractIngressRouteServiceNames(networkResource.spec)
              : networkResource.kind === 'Endpoints'
                ? [networkResource.name]
                : networkResource.kind === 'EndpointSlice'
                  ? this.extractEndpointSliceServiceNames(
                      networkResource.spec,
                      networkResource.statusJson,
                    )
                  : [];
        if (serviceNames.includes(base.name)) {
          add(
            networkResource.kind,
            networkResource.name,
            networkResource.namespace ?? undefined,
            networkResource.kind === 'Ingress'
              ? 'routes-to-service'
              : networkResource.kind === 'IngressRoute'
                ? 'traefik-routes-to-service'
                : 'selects-service',
          );
        }
      }
    }

    if (base.kind === 'Ingress') {
      for (const serviceName of this.extractIngressServiceNames(base.spec)) {
        add('Service', serviceName, namespace, 'backend-service');
      }
      for (const secretName of this.extractIngressTlsSecretNames(base.spec)) {
        add('Secret', secretName, namespace, 'tls-secret');
      }
    }

    if (base.kind === 'IngressRoute') {
      for (const serviceName of this.extractIngressRouteServiceNames(
        base.spec,
      )) {
        add('Service', serviceName, namespace, 'backend-service');
      }
      const specObj = this.toObject(base.spec);
      const tlsObj = this.toObject(specObj.tls);
      const tlsSecretName = this.toMaybeString(tlsObj.secretName);
      if (tlsSecretName) {
        add('Secret', tlsSecretName, namespace, 'tls-secret');
      }
      for (const middlewareRef of this.extractIngressRouteMiddlewares(
        base.spec,
      )) {
        add(
          'Middleware',
          middlewareRef.name,
          middlewareRef.namespace ?? namespace,
          'route-middleware',
        );
      }
    }

    if (base.kind === 'Endpoints') {
      add('Service', base.name, namespace, 'service-endpoints');
    }

    if (base.kind === 'EndpointSlice') {
      for (const serviceName of this.extractEndpointSliceServiceNames(
        base.spec,
        base.statusJson,
      )) {
        add('Service', serviceName, namespace, 'service-endpointslice');
      }
    }

    if (base.kind === 'PersistentVolumeClaim') {
      for (const workload of context.workloads) {
        if (workload.namespace !== namespace) {
          continue;
        }
        const pipelines = this.buildStoragePipelinesForWorkload(
          workload,
          context.storageResources,
        );
        if (pipelines.some((pipeline) => pipeline.pvcName === base.name)) {
          add(
            workload.kind,
            workload.name,
            workload.namespace ?? undefined,
            'uses-claim',
          );
        }
      }
      const spec = this.toObject(base.spec);
      const volumeName = this.toMaybeString(spec.volumeName);
      if (volumeName) {
        add('PersistentVolume', volumeName, undefined, 'bound-volume');
      }
    }

    if (base.kind === 'PersistentVolume') {
      for (const pvc of context.storageResources) {
        if (pvc.kind !== 'PersistentVolumeClaim') {
          continue;
        }
        const spec = this.toObject(pvc.spec);
        if (this.toMaybeString(spec.volumeName) === base.name) {
          add(
            'PersistentVolumeClaim',
            pvc.name,
            pvc.namespace ?? undefined,
            'bound-claim',
          );
        }
      }

      for (const workload of context.workloads) {
        const pipelines = this.buildStoragePipelinesForWorkload(
          workload,
          context.storageResources,
        );
        if (pipelines.some((pipeline) => pipeline.pvName === base.name)) {
          add(
            workload.kind,
            workload.name,
            workload.namespace ?? undefined,
            'uses-volume',
          );
        }
      }
    }

    if (base.kind === 'StorageClass') {
      for (const storage of context.storageResources) {
        const storageClass = this.resolveStorageClass(storage);
        if (storageClass !== base.name) {
          continue;
        }
        add(
          storage.kind,
          storage.name,
          storage.namespace ?? undefined,
          'uses-storageclass',
        );
      }

      for (const workload of context.workloads) {
        const pipelines = this.buildStoragePipelinesForWorkload(
          workload,
          context.storageResources,
        );
        if (
          pipelines.some((pipeline) => pipeline.storageClass === base.name)
        ) {
          add(
            workload.kind,
            workload.name,
            workload.namespace ?? undefined,
            'uses-storageclass',
          );
        }
      }
    }

    if (base.kind === 'ConfigMap' || base.kind === 'Secret') {
      const isConfigMap = base.kind === 'ConfigMap';
      for (const workload of context.workloads) {
        if (workload.namespace !== namespace) {
          continue;
        }
        const refs = this.extractWorkloadRefs(workload.kind, workload.spec);
        const matched = isConfigMap
          ? refs.configMapNames.includes(base.name)
          : refs.secretNames.includes(base.name);
        if (matched) {
          add(
            workload.kind,
            workload.name,
            workload.namespace ?? undefined,
            isConfigMap ? 'uses-configmap' : 'uses-secret',
          );
        }
      }
    }

    return Array.from(map.values());
  }

  private buildRelationshipGroups(
    base: DetailResourceRecord,
    context: DetailContext,
    associations: ResourceAssociation[],
    network: ResourceDetailNetworkSummary,
    storage: ResourceDetailStorageSummary,
    metadata: ResourceDetailMetadata,
  ): ResourceDetailRelationshipGroup[] {
    const groups = new Map<
      ResourceDetailRelationshipGroupKey,
      ResourceDetailRelationshipItem[]
    >();
    const seen = new Set<string>();
    const resolveId = (
      kind: string | undefined,
      name: string | undefined,
      namespace?: string | null,
    ) =>
      this.resolveRelationshipId(
        kind,
        name,
        namespace ?? undefined,
        base,
        context,
        associations,
      );
    const addItem = (
      group: ResourceDetailRelationshipGroupKey,
      item: Omit<ResourceDetailRelationshipItem, 'key'> & { key?: string },
    ) => {
      const chain = item.chain
        .filter((node) => Boolean(node.name))
        .map((node) => this.enrichRelationshipNode(node, base, context, associations));
      if (chain.length === 0) {
        return;
      }
      const key =
        item.key ??
        [
          group,
          item.title,
          item.subtitle ?? '',
          ...chain.map((node) =>
            [
              node.kind ?? '',
              node.namespace ?? '',
              node.name ?? '',
              node.id ?? '',
              node.role ?? '',
            ].join(':'),
          ),
        ].join('|');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      groups.set(group, [
        ...(groups.get(group) ?? []),
        { ...item, key, chain },
      ]);
    };

    for (const association of associations) {
      const group = this.relationshipGroupForAssociation(association);
      addItem(group, {
        key: [
          'assoc',
          association.associationType,
          association.kind,
          association.namespace ?? '',
          association.name,
          association.id ?? '',
        ].join('|'),
        title: this.relationshipAssociationTitle(association.associationType),
        subtitle: association.namespace
          ? `名称空间 ${association.namespace}`
          : '集群级资源',
        tags: [
          {
            label: this.relationshipAssociationTitle(
              association.associationType,
            ),
            color: this.relationshipAssociationColor(
              association.associationType,
            ),
          },
        ],
        chain: [
          {
            kind: association.kind,
            name: association.name,
            namespace: association.namespace,
            id: association.id,
            role: association.associationType,
            color: this.relationshipAssociationColor(
              association.associationType,
            ),
          },
        ],
      });
    }

    network.networkPipelines.forEach((pipeline, index) => {
      addItem('network', {
        key: [
          'network',
          pipeline.sourceKind,
          pipeline.sourceNamespace ?? '',
          pipeline.sourceName,
          pipeline.serviceNamespace ?? '',
          pipeline.serviceName ?? '',
          pipeline.endpointSourceKind ?? '',
          pipeline.endpointSourceName ?? '',
          pipeline.backendPodNamespace ?? '',
          pipeline.backendPodName ?? pipeline.ip ?? '',
          index,
        ].join('|'),
        title: '网络路径',
        subtitle: [pipeline.host, pipeline.path, pipeline.port]
          .filter(Boolean)
          .join(' · '),
        tags: [
          ...(pipeline.servicePort
            ? [{ label: `svc ${pipeline.servicePort}` }]
            : []),
          ...(pipeline.ready === undefined
            ? []
            : [
                {
                  label: pipeline.ready ? 'Ready' : 'NotReady',
                  color: pipeline.ready ? 'success' : 'warning',
                },
              ]),
        ],
        chain: [
          {
            kind: pipeline.sourceKind,
            name: pipeline.sourceName,
            namespace: pipeline.sourceNamespace,
            id:
              pipeline.sourceId ??
              resolveId(
                pipeline.sourceKind,
                pipeline.sourceName,
                pipeline.sourceNamespace,
              ),
            role: 'entry',
            color: 'green',
          },
          {
            kind: 'Service',
            name: pipeline.serviceName,
            namespace: pipeline.serviceNamespace,
            id:
              pipeline.serviceId ??
              resolveId('Service', pipeline.serviceName, pipeline.serviceNamespace),
            role: 'service',
            color: 'blue',
          },
          {
            kind: pipeline.endpointSourceKind || 'Endpoints',
            name: pipeline.endpointSourceName,
            namespace: pipeline.serviceNamespace,
            id:
              pipeline.endpointSourceId ??
              resolveId(
                pipeline.endpointSourceKind || 'Endpoints',
                pipeline.endpointSourceName,
                pipeline.serviceNamespace,
              ),
            role: 'endpoint',
            color:
              pipeline.endpointSourceKind === 'EndpointSlice'
                ? 'volcano'
                : 'gold',
          },
          {
            kind: pipeline.backendPodName ? 'Pod' : 'Pod/IP',
            name: pipeline.backendPodName ?? pipeline.ip,
            namespace: pipeline.backendPodNamespace,
            id:
              pipeline.backendPodId ??
              resolveId('Pod', pipeline.backendPodName, pipeline.backendPodNamespace),
            role: 'backend',
            color: 'cyan',
          },
        ],
      });
    });

    storage.storagePipelines.forEach((pipeline, index) => {
      addItem('storage', {
        key: [
          'storage',
          pipeline.container,
          pipeline.mountPath,
          pipeline.volumeName,
          pipeline.pvcNamespace ?? '',
          pipeline.pvcName ?? '',
          pipeline.pvName ?? '',
          pipeline.storageClass ?? '',
          index,
        ].join('|'),
        title: '存储路径',
        subtitle: [pipeline.mountPath, pipeline.readOnly ? '只读' : null]
          .filter(Boolean)
          .join(' · '),
        tags: [
          ...(pipeline.volumeType ? [{ label: pipeline.volumeType }] : []),
          ...(pipeline.pvcPhase
            ? [{ label: pipeline.pvcPhase, color: 'cyan' }]
            : []),
          ...(pipeline.pvPhase
            ? [{ label: pipeline.pvPhase, color: 'blue' }]
            : []),
        ],
        chain: [
          {
            kind: 'Container',
            name: pipeline.container,
            role: 'container',
            color: 'geekblue',
          },
          {
            kind: 'Volume',
            name: pipeline.volumeName,
            role: 'volume',
            color: 'default',
          },
          {
            kind: 'PersistentVolumeClaim',
            name: pipeline.pvcName,
            namespace: pipeline.pvcNamespace ?? base.namespace ?? undefined,
            id: resolveId(
              'PersistentVolumeClaim',
              pipeline.pvcName,
              pipeline.pvcNamespace ?? base.namespace ?? undefined,
            ),
            role: 'claim',
            color: 'cyan',
          },
          {
            kind: 'PersistentVolume',
            name: pipeline.pvName,
            id: resolveId(
              'PersistentVolume',
              pipeline.pvName,
              undefined,
            ),
            role: 'volume',
            color: 'blue',
          },
          {
            kind: 'StorageClass',
            name: pipeline.storageClass,
            id: resolveId(
              'StorageClass',
              pipeline.storageClass,
              undefined,
            ),
            role: 'class',
            color: 'gold',
          },
        ],
      });
    });

    metadata.configUsages.forEach((usage, index) => {
      addItem('config', {
        key: [
          'config',
          usage.referencedKind,
          usage.referencedNamespace ?? '',
          usage.referencedName,
          usage.consumerKind,
          usage.consumerNamespace ?? '',
          usage.consumerName,
          usage.usageType,
          usage.container ?? '',
          usage.mountPath ?? '',
          usage.key ?? '',
          index,
        ].join('|'),
        title: '配置引用',
        subtitle: [
          usage.container,
          usage.mountPath,
          usage.key ? `key ${usage.key}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        tags: [
          {
            label: this.relationshipConfigUsageTitle(usage.usageType),
            color: this.relationshipConfigUsageColor(usage.usageType),
          },
        ],
        chain: [
          {
            kind: usage.referencedKind,
            name: usage.referencedName,
            namespace: usage.referencedNamespace,
            id:
              usage.referencedId ??
              resolveId(
                usage.referencedKind,
                usage.referencedName,
                usage.referencedNamespace,
              ),
            role: 'referenced',
            color:
              usage.referencedKind === 'Secret' ? 'magenta' : 'blue',
          },
          {
            kind: usage.consumerKind,
            name: usage.consumerName,
            namespace: usage.consumerNamespace,
            id:
              usage.consumerId ??
              resolveId(
                usage.consumerKind,
                usage.consumerName,
                usage.consumerNamespace,
              ),
            role: 'consumer',
            color: 'geekblue',
          },
        ],
      });
    });

    return (
      Object.keys(RELATIONSHIP_GROUP_META) as ResourceDetailRelationshipGroupKey[]
    )
      .map((key) => ({
        key,
        ...RELATIONSHIP_GROUP_META[key],
        items: groups.get(key) ?? [],
      }))
      .filter((group) => group.items.length > 0);
  }

  private buildNetworkSummary(
    base: DetailResourceRecord,
    runtime: ResourceDetailRuntime,
    context: DetailContext,
  ): ResourceDetailNetworkSummary {
    const resolveNetworkTargetId = (
      kind: string,
      name: string,
      namespace?: string | null,
    ): string | undefined => {
      const matchedId = context.networkResources.find(
        (item) =>
          item.kind === kind &&
          item.name === name &&
          (namespace ? item.namespace === namespace : true),
      )?.id;
      if (matchedId) {
        return matchedId;
      }
      if (!namespace) {
        return undefined;
      }
      return this.buildLiveNetworkId(base.clusterId, kind, namespace, name);
    };

    const summary: ResourceDetailNetworkSummary = {
      clusterIPs: [],
      podIPs: [],
      nodeNames: [],
      endpoints: [],
      networkPipelines: [],
    };
    const pipelineKeys = new Set<string>();
    const addPipeline = (pipeline: ResourceDetailNetworkPipeline) => {
      const key = [
        pipeline.sourceKind,
        pipeline.sourceNamespace ?? '',
        pipeline.sourceName,
        pipeline.host ?? '',
        pipeline.path ?? '',
        pipeline.port ?? '',
        pipeline.serviceNamespace ?? '',
        pipeline.serviceName ?? '',
        pipeline.servicePort ?? '',
        pipeline.endpointSourceKind ?? '',
        pipeline.endpointSourceName ?? '',
        pipeline.backendPodNamespace ?? '',
        pipeline.backendPodName ?? '',
        pipeline.ip ?? '',
        pipeline.ready === undefined ? '' : String(pipeline.ready),
      ].join('|');
      if (pipelineKeys.has(key)) {
        return;
      }
      pipelineKeys.add(key);
      summary.networkPipelines.push(pipeline);
    };
    const servicePortsByNsName = new Map<
      string,
      Array<{ port?: number; name?: string; targetPort?: string }>
    >();
    for (const item of context.networkResources) {
      if (item.kind !== 'Service') {
        continue;
      }
      const serviceSpec = this.toObject(item.spec);
      const ports = this.toArray(serviceSpec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0)
        .map((port) => ({
          port: this.toMaybeNumber(port.port) ?? undefined,
          name: this.toMaybeString(port.name) ?? undefined,
          targetPort: this.valueToString(port.targetPort),
        }));
      servicePortsByNsName.set(`${item.namespace ?? ''}/${item.name}`, ports);
    }
    if (base.kind === 'Service') {
      const serviceSpec = this.toObject(base.spec);
      const serviceStatus = this.toObject(base.statusJson);
      const loadBalancer = this.toObject(serviceStatus.loadBalancer);
      summary.service = {
        type: this.toMaybeString(serviceSpec.type),
        selector: this.toSelectorString(serviceSpec.selector),
        externalIPs: this.toStringArray(serviceSpec.externalIPs),
        loadBalancerIPs: this.toArray(loadBalancer.ingress)
          .map((item) => this.toObject(item))
          .map(
            (item) =>
              this.toMaybeString(item.ip) ??
              this.toMaybeString(item.hostname),
          )
          .filter((item): item is string => Boolean(item)),
        sessionAffinity: this.toMaybeString(serviceSpec.sessionAffinity),
        externalTrafficPolicy: this.toMaybeString(
          serviceSpec.externalTrafficPolicy,
        ),
        internalTrafficPolicy: this.toMaybeString(
          serviceSpec.internalTrafficPolicy,
        ),
        publishNotReadyAddresses: this.toMaybeBoolean(
          serviceSpec.publishNotReadyAddresses,
        ),
      };
      const ports = this.toArray(serviceSpec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0)
        .map((port) => ({
          port: this.toMaybeNumber(port.port) ?? undefined,
          name: this.toMaybeString(port.name) ?? undefined,
          targetPort: this.valueToString(port.targetPort),
        }));
      servicePortsByNsName.set(`${base.namespace ?? ''}/${base.name}`, ports);
    }
    const endpointsByServiceNsName = new Map<string, DetailResourceRecord[]>();
    const endpointSlicesByServiceNsName = new Map<string, DetailResourceRecord[]>();
    for (const item of context.networkResources) {
      if (item.kind === 'Endpoints') {
        const key = `${item.namespace ?? ''}/${item.name}`;
        const list = endpointsByServiceNsName.get(key) ?? [];
        list.push(item);
        endpointsByServiceNsName.set(key, list);
      }
      if (item.kind === 'EndpointSlice') {
        const serviceNames = this.extractEndpointSliceServiceNames(
          item.spec,
          item.statusJson,
        );
        for (const serviceName of serviceNames) {
          const key = `${item.namespace ?? ''}/${serviceName}`;
          const list = endpointSlicesByServiceNsName.get(key) ?? [];
          list.push(item);
          endpointSlicesByServiceNsName.set(key, list);
        }
      }
    }
    const resolveServicePortString = (
      serviceName?: string,
      serviceNamespace?: string,
      routePort?: string,
    ): string | undefined => {
      if (routePort) {
        return routePort;
      }
      if (!serviceName) {
        return undefined;
      }
      const key = `${serviceNamespace ?? ''}/${serviceName}`;
      const ports = servicePortsByNsName.get(key) ?? [];
      if (ports.length === 1) {
        const first = ports[0];
        return (
          first.targetPort ??
          first.name ??
          (typeof first.port === 'number' ? String(first.port) : undefined)
        );
      }
      return undefined;
    };
    const addServicePipelines = (params: {
      sourceKind: string;
      sourceName: string;
      sourceNamespace?: string;
      host?: string;
      path?: string;
      port?: number;
      serviceName?: string;
      serviceNamespace?: string;
      servicePort?: string;
    }) => {
      const serviceName = params.serviceName;
      const serviceNamespace =
        params.serviceNamespace ?? params.sourceNamespace ?? base.namespace ?? undefined;
      const servicePort = resolveServicePortString(
        serviceName,
        serviceNamespace,
        params.servicePort,
      );
      const serviceKey = serviceName
        ? `${serviceNamespace ?? ''}/${serviceName}`
        : undefined;

      const addBackendPipeline = (
        endpointSourceKind?: string,
        endpointSourceName?: string,
        backendPodName?: string,
        backendPodNamespace?: string,
        ip?: string,
        ready?: boolean,
      ) => {
        addPipeline({
          sourceKind: params.sourceKind,
          sourceName: params.sourceName,
          ...(params.sourceNamespace ? { sourceNamespace: params.sourceNamespace } : {}),
          ...(params.host ? { host: params.host } : {}),
          ...(params.path ? { path: params.path } : {}),
          ...(typeof params.port === 'number' ? { port: params.port } : {}),
          ...(serviceName ? { serviceName } : {}),
          ...(serviceNamespace ? { serviceNamespace } : {}),
          ...(servicePort ? { servicePort } : {}),
          ...(endpointSourceKind ? { endpointSourceKind } : {}),
          ...(endpointSourceName ? { endpointSourceName } : {}),
          ...(backendPodName ? { backendPodName } : {}),
          ...(backendPodNamespace ? { backendPodNamespace } : {}),
          ...(ip ? { ip } : {}),
          ...(ready !== undefined ? { ready } : {}),
        });
      };

      if (!serviceKey) {
        addBackendPipeline();
        return;
      }

      let hasBackend = false;
      const endpointSlices = endpointSlicesByServiceNsName.get(serviceKey) ?? [];
      for (const endpointSlice of endpointSlices) {
        const sliceSpec = this.toObject(endpointSlice.spec);
        for (const endpoint of this.toArray(sliceSpec.endpoints)) {
          const endpointObj = this.toObject(endpoint);
          const addresses = this.toArray(endpointObj.addresses);
          const targetRef = this.toObject(endpointObj.targetRef);
          const targetKind = this.toMaybeString(targetRef.kind);
          const podName =
            targetKind === 'Pod' ? this.toMaybeString(targetRef.name) ?? undefined : undefined;
          const podNamespace =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.namespace) ??
                endpointSlice.namespace ??
                undefined
              : undefined;
          const ready = this.toMaybeBoolean(
            this.toObject(endpointObj.conditions).ready,
          );
          for (const address of addresses) {
            hasBackend = true;
            addBackendPipeline(
              'EndpointSlice',
              endpointSlice.name,
              podName,
              podNamespace,
              this.valueToString(address) ?? undefined,
              ready ?? undefined,
            );
          }
        }
      }

      const endpoints = endpointsByServiceNsName.get(serviceKey) ?? [];
      for (const endpointResource of endpoints) {
        const endpointSpec = this.toObject(endpointResource.spec);
        for (const subset of this.toArray(endpointSpec.subsets)) {
          const subsetObj = this.toObject(subset);
          const readyAddresses = this.toArray(subsetObj.addresses);
          const notReadyAddresses = this.toArray(subsetObj.notReadyAddresses);
          for (const address of readyAddresses) {
            const addressObj = this.toObject(address);
            const targetRef = this.toObject(addressObj.targetRef);
            const targetKind = this.toMaybeString(targetRef.kind);
            const podName =
              targetKind === 'Pod'
                ? this.toMaybeString(targetRef.name) ?? undefined
                : undefined;
            const podNamespace =
              targetKind === 'Pod'
                ? this.toMaybeString(targetRef.namespace) ??
                  endpointResource.namespace ??
                  undefined
                : undefined;
            hasBackend = true;
            addBackendPipeline(
              'Endpoints',
              endpointResource.name,
              podName,
              podNamespace,
              this.toMaybeString(addressObj.ip) ?? undefined,
              true,
            );
          }
          for (const address of notReadyAddresses) {
            const addressObj = this.toObject(address);
            const targetRef = this.toObject(addressObj.targetRef);
            const targetKind = this.toMaybeString(targetRef.kind);
            const podName =
              targetKind === 'Pod'
                ? this.toMaybeString(targetRef.name) ?? undefined
                : undefined;
            const podNamespace =
              targetKind === 'Pod'
                ? this.toMaybeString(targetRef.namespace) ??
                  endpointResource.namespace ??
                  undefined
                : undefined;
            hasBackend = true;
            addBackendPipeline(
              'Endpoints',
              endpointResource.name,
              podName,
              podNamespace,
              this.toMaybeString(addressObj.ip) ?? undefined,
              false,
            );
          }
        }
      }

      if (!hasBackend) {
        addBackendPipeline();
      }
    };

    if (runtime.podIP) {
      summary.podIPs.push(runtime.podIP);
    }
    if (runtime.nodeName) {
      summary.nodeNames.push(runtime.nodeName);
    }

    if (base.kind === 'Service') {
      const spec = this.toObject(base.spec);
      const clusterIP = this.toMaybeString(spec.clusterIP);
      if (clusterIP) {
        summary.clusterIPs.push(clusterIP);
      }

      const ports = this.toArray(spec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0);
      if (ports.length > 0) {
        const endpoint: ResourceDetailNetworkEndpoint = {
          kind: 'service-port',
          name: base.name,
          namespace: base.namespace ?? undefined,
          sourceId: base.id,
          ports: ports.map((port) => ({
            port: this.toMaybeNumber(port.port) ?? 0,
            protocol: this.toMaybeString(port.protocol) ?? undefined,
            targetPort: this.valueToString(port.targetPort),
          })),
        };
        summary.endpoints.push(endpoint);
      }

      const status = this.toObject(base.statusJson);
      const loadBalancer = this.toObject(status.loadBalancer);
      const ingress = this.toArray(loadBalancer.ingress);
      for (const item of ingress) {
        const ingressObj = this.toObject(item);
        summary.endpoints.push({
          kind: 'service-port',
          name: base.name,
          namespace: base.namespace ?? undefined,
          sourceKind: 'Service',
          sourceName: base.name,
          sourceId: base.id,
          ip: this.toMaybeString(ingressObj.ip),
          hostname: this.toMaybeString(ingressObj.hostname),
        });
      }

      for (const networkResource of context.networkResources) {
        if (
          networkResource.namespace !== base.namespace ||
          (networkResource.kind !== 'Endpoints' &&
            networkResource.kind !== 'EndpointSlice')
        ) {
          continue;
        }

        const serviceNames =
          networkResource.kind === 'Endpoints'
            ? [networkResource.name]
            : this.extractEndpointSliceServiceNames(
                networkResource.spec,
                networkResource.statusJson,
              );
        if (!serviceNames.includes(base.name)) {
          continue;
        }

        if (networkResource.kind === 'Endpoints') {
          const endpointSpec = this.toObject(networkResource.spec);
          const subsets = this.toArray(endpointSpec.subsets);
          for (const subset of subsets) {
            const subsetObj = this.toObject(subset);
            const ports = this.toArray(subsetObj.ports)
              .map((port) => this.toObject(port))
              .filter((port) => Object.keys(port).length > 0);
            const addresses = [
              ...this.toArray(subsetObj.addresses),
              ...this.toArray(subsetObj.notReadyAddresses),
            ];
            for (const address of addresses) {
              const addressObj = this.toObject(address);
              summary.endpoints.push({
                kind: 'service-port',
                name: this.toMaybeString(addressObj.ip) ?? networkResource.name,
                namespace: networkResource.namespace ?? undefined,
                sourceKind: 'Endpoints',
                sourceName: networkResource.name,
                sourceId: networkResource.id,
                ip: this.toMaybeString(addressObj.ip),
                hostname: this.toMaybeString(addressObj.hostname),
                ports: ports.map((port) => ({
                  port: this.toMaybeNumber(port.port) ?? 0,
                  protocol: this.toMaybeString(port.protocol) ?? undefined,
                  targetPort: this.toMaybeString(port.name) ?? undefined,
                })),
              });
            }
          }
        }

        if (networkResource.kind === 'EndpointSlice') {
          const sliceSpec = this.toObject(networkResource.spec);
          const ports = this.toArray(sliceSpec.ports)
            .map((port) => this.toObject(port))
            .filter((port) => Object.keys(port).length > 0);
          const endpoints = this.toArray(sliceSpec.endpoints);
          for (const endpoint of endpoints) {
            const endpointObj = this.toObject(endpoint);
            const addresses = this.toArray(endpointObj.addresses);
            for (const address of addresses) {
              summary.endpoints.push({
                kind: 'service-port',
                name: this.valueToString(address) ?? networkResource.name,
                namespace: networkResource.namespace ?? undefined,
                sourceKind: 'EndpointSlice',
                sourceName: networkResource.name,
                sourceId: networkResource.id,
                ip: this.valueToString(address),
                hostname: this.toMaybeString(endpointObj.hostname),
                ports: ports.map((port) => ({
                  port: this.toMaybeNumber(port.port) ?? 0,
                  protocol: this.toMaybeString(port.protocol) ?? undefined,
                  targetPort: this.toMaybeString(port.name) ?? undefined,
                })),
              });
            }
          }
        }
      }

      for (const networkResource of context.networkResources) {
        if (networkResource.namespace !== base.namespace) {
          continue;
        }
        if (networkResource.kind === 'Ingress') {
          const ingressSpec = this.toObject(networkResource.spec);
          for (const rule of this.toArray(ingressSpec.rules)) {
            const ruleObj = this.toObject(rule);
            const host = this.toMaybeString(ruleObj.host);
            const http = this.toObject(ruleObj.http);
            for (const path of this.toArray(http.paths)) {
              const pathObj = this.toObject(path);
              const backend = this.toObject(pathObj.backend);
              const service = this.toObject(backend.service);
              const serviceName = this.toMaybeString(service.name);
              if (serviceName !== base.name) {
                continue;
              }
              const servicePort = this.valueToString(
                this.toObject(service.port).number ??
                  this.toObject(service.port).name,
              );
              addServicePipelines({
                sourceKind: 'Ingress',
                sourceName: networkResource.name,
                sourceNamespace: networkResource.namespace ?? undefined,
                host,
                path: this.toMaybeString(pathObj.path),
                serviceName: base.name,
                serviceNamespace: base.namespace ?? undefined,
                servicePort,
              });
            }
          }
        }
        if (networkResource.kind === 'IngressRoute') {
          const routeSpec = this.toObject(networkResource.spec);
          const entryPoints = this.toArray(routeSpec.entryPoints)
            .map((item) => this.valueToString(item))
            .filter(Boolean)
            .join(', ');
          for (const route of this.toArray(routeSpec.routes)) {
            const routeObj = this.toObject(route);
            for (const backendService of this.toArray(routeObj.services)) {
              const backendServiceObj = this.toObject(backendService);
              const serviceName = this.toMaybeString(backendServiceObj.name);
              if (serviceName !== base.name) {
                continue;
              }
              addServicePipelines({
                sourceKind: 'IngressRoute',
                sourceName: networkResource.name,
                sourceNamespace: networkResource.namespace ?? undefined,
                host: entryPoints || undefined,
                path: this.toMaybeString(routeObj.match),
                port: this.toMaybeNumber(backendServiceObj.port) ?? undefined,
                serviceName: base.name,
                serviceNamespace: base.namespace ?? undefined,
                servicePort: this.valueToString(backendServiceObj.port),
              });
            }
          }
        }
        if (networkResource.kind === 'HTTPRoute') {
          const routeSpec = this.toObject(networkResource.spec);
          const hostnames = this.toArray(routeSpec.hostnames)
            .map((item) => this.valueToString(item))
            .filter((item): item is string => Boolean(item));
          for (const rule of this.toArray(routeSpec.rules)) {
            const ruleObj = this.toObject(rule);
            const matches = this.toArray(ruleObj.matches);
            const normalizedMatches = matches.length > 0 ? matches : [{}];
            for (const backendRef of this.toArray(ruleObj.backendRefs)) {
              const backendRefObj = this.toObject(backendRef);
              const backendKind = this.toMaybeString(backendRefObj.kind) ?? 'Service';
              const backendName = this.toMaybeString(backendRefObj.name);
              const backendNamespace =
                this.toMaybeString(backendRefObj.namespace) ??
                networkResource.namespace ??
                undefined;
              if (
                backendKind !== 'Service' ||
                backendName !== base.name ||
                backendNamespace !== base.namespace
              ) {
                continue;
              }
              const backendPort = this.valueToString(backendRefObj.port);
              for (const match of normalizedMatches) {
                const matchObj = this.toObject(match);
                const pathObj = this.toObject(matchObj.path);
                const routePath = this.toMaybeString(pathObj.value);
                if (hostnames.length === 0) {
                  addServicePipelines({
                    sourceKind: 'HTTPRoute',
                    sourceName: networkResource.name,
                    sourceNamespace: networkResource.namespace ?? undefined,
                    path: routePath,
                    serviceName: base.name,
                    serviceNamespace: base.namespace ?? undefined,
                    servicePort: backendPort,
                  });
                  continue;
                }
                for (const hostname of hostnames) {
                  addServicePipelines({
                    sourceKind: 'HTTPRoute',
                    sourceName: networkResource.name,
                    sourceNamespace: networkResource.namespace ?? undefined,
                    host: hostname,
                    path: routePath,
                    serviceName: base.name,
                    serviceNamespace: base.namespace ?? undefined,
                    servicePort: backendPort,
                  });
                }
              }
            }
          }
        }
      }

      const servicePorts = this.toArray(spec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0);
      if (servicePorts.length === 0) {
        addServicePipelines({
          sourceKind: 'Service',
          sourceName: base.name,
          sourceNamespace: base.namespace ?? undefined,
          serviceName: base.name,
          serviceNamespace: base.namespace ?? undefined,
        });
      } else {
        for (const servicePort of servicePorts) {
          addServicePipelines({
            sourceKind: 'Service',
            sourceName: base.name,
            sourceNamespace: base.namespace ?? undefined,
            port: this.toMaybeNumber(servicePort.port) ?? undefined,
            serviceName: base.name,
            serviceNamespace: base.namespace ?? undefined,
            servicePort:
              this.valueToString(servicePort.targetPort) ??
              this.valueToString(servicePort.port) ??
              undefined,
          });
        }
      }
    }

    if (base.kind === 'Ingress') {
      const spec = this.toObject(base.spec);
      const rules = this.toArray(spec.rules);
      for (const rule of rules) {
        const ruleObj = this.toObject(rule);
        const host = this.toMaybeString(ruleObj.host);
        const http = this.toObject(ruleObj.http);
        const paths = this.toArray(http.paths);
        for (const path of paths) {
          const pathObj = this.toObject(path);
          const backend = this.toObject(pathObj.backend);
          const service = this.toObject(backend.service);
          const serviceName = this.toMaybeString(service.name);
          const servicePort = this.valueToString(
            this.toObject(service.port).number ??
              this.toObject(service.port).name,
          );
          summary.endpoints.push({
            kind: 'ingress-rule',
            name: serviceName ?? base.name,
            namespace: base.namespace ?? undefined,
            sourceKind: 'Ingress',
            sourceName: base.name,
            sourceId: serviceName
              ? resolveNetworkTargetId('Service', serviceName, base.namespace)
              : undefined,
            host,
            path: this.toMaybeString(pathObj.path),
            ports: [],
          });
          addServicePipelines({
            sourceKind: 'Ingress',
            sourceName: base.name,
            sourceNamespace: base.namespace ?? undefined,
            host,
            path: this.toMaybeString(pathObj.path),
            serviceName: serviceName ?? undefined,
            serviceNamespace: base.namespace ?? undefined,
            servicePort,
          });
        }
      }

      const status = this.toObject(base.statusJson);
      const loadBalancer = this.toObject(status.loadBalancer);
      const ingress = this.toArray(loadBalancer.ingress);
      for (const item of ingress) {
        const ingressObj = this.toObject(item);
        summary.endpoints.push({
          kind: 'ingress-rule',
          name: base.name,
          namespace: base.namespace ?? undefined,
          sourceKind: 'Ingress',
          sourceName: base.name,
          ip: this.toMaybeString(ingressObj.ip),
          hostname: this.toMaybeString(ingressObj.hostname),
          ports: [],
        });
      }
    }

    if (base.kind === 'IngressRoute') {
      const spec = this.toObject(base.spec);
      const entryPoints = this.toArray(spec.entryPoints)
        .map((item) => this.valueToString(item))
        .filter(Boolean);
      const routes = this.toArray(spec.routes);
      for (const route of routes) {
        const routeObj = this.toObject(route);
        const services = this.toArray(routeObj.services);
        for (const service of services) {
          const serviceObj = this.toObject(service);
          const serviceName = this.toMaybeString(serviceObj.name) ?? undefined;
          const servicePort = this.valueToString(serviceObj.port);
          summary.endpoints.push({
            kind: 'ingress-rule',
            name: serviceName ?? base.name,
            namespace: base.namespace ?? undefined,
            sourceKind: 'IngressRoute',
            sourceName: base.name,
            sourceId: serviceName
              ? resolveNetworkTargetId(
                  'Service',
                  serviceName,
                  base.namespace,
                )
              : undefined,
            host: entryPoints.join(', ') || undefined,
            path: this.toMaybeString(routeObj.match),
            ports: this.toMaybeNumber(serviceObj.port)
              ? [{ port: this.toMaybeNumber(serviceObj.port) ?? 0 }]
              : [],
          });
          addServicePipelines({
            sourceKind: 'IngressRoute',
            sourceName: base.name,
            sourceNamespace: base.namespace ?? undefined,
            host: entryPoints.join(', ') || undefined,
            path: this.toMaybeString(routeObj.match),
            port: this.toMaybeNumber(serviceObj.port) ?? undefined,
            serviceName,
            serviceNamespace: base.namespace ?? undefined,
            servicePort,
          });
        }
      }
    }

    if (base.kind === 'HTTPRoute') {
      const spec = this.toObject(base.spec);
      const hostnames = this.toArray(spec.hostnames)
        .map((hostname) => this.valueToString(hostname))
        .filter((hostname): hostname is string => Boolean(hostname));
      const rules = this.toArray(spec.rules);
      for (const rule of rules) {
        const ruleObj = this.toObject(rule);
        const matches = this.toArray(ruleObj.matches);
        const normalizedMatches = matches.length > 0 ? matches : [{}];
        const backendRefs = this.toArray(ruleObj.backendRefs);
        for (const backendRef of backendRefs) {
          const backendRefObj = this.toObject(backendRef);
          const backendKind = this.toMaybeString(backendRefObj.kind) ?? 'Service';
          if (backendKind !== 'Service') {
            continue;
          }
          const serviceName = this.toMaybeString(backendRefObj.name);
          if (!serviceName) {
            continue;
          }
          const serviceNamespace =
            this.toMaybeString(backendRefObj.namespace) ??
            base.namespace ??
            undefined;
          const servicePort = this.valueToString(backendRefObj.port);
          for (const match of normalizedMatches) {
            const matchObj = this.toObject(match);
            const pathObj = this.toObject(matchObj.path);
            const routePath = this.toMaybeString(pathObj.value);
            if (hostnames.length === 0) {
              addServicePipelines({
                sourceKind: 'HTTPRoute',
                sourceName: base.name,
                sourceNamespace: base.namespace ?? undefined,
                path: routePath,
                serviceName,
                serviceNamespace,
                servicePort,
              });
              continue;
            }
            for (const hostname of hostnames) {
              addServicePipelines({
                sourceKind: 'HTTPRoute',
                sourceName: base.name,
                sourceNamespace: base.namespace ?? undefined,
                host: hostname,
                path: routePath,
                serviceName,
                serviceNamespace,
                servicePort,
              });
            }
          }
        }
      }
    }

    if (base.kind === 'Gateway') {
      const spec = this.toObject(base.spec);
      for (const listener of this.toArray(spec.listeners)) {
        const listenerObj = this.toObject(listener);
        const allowedRoutes = this.toObject(listenerObj.allowedRoutes);
        const namespaces = this.toObject(allowedRoutes.namespaces);
        addPipeline({
          sourceKind: 'Gateway',
          sourceName: base.name,
          ...(base.namespace ? { sourceNamespace: base.namespace } : {}),
          ...(this.toMaybeString(listenerObj.hostname)
            ? { host: this.toMaybeString(listenerObj.hostname) ?? undefined }
            : {}),
          ...(this.toMaybeNumber(listenerObj.port) !== undefined
            ? { port: this.toMaybeNumber(listenerObj.port) ?? undefined }
            : {}),
          ...(this.toMaybeString(namespaces.from)
            ? { path: `allowedRoutes:${this.toMaybeString(namespaces.from)}` }
            : {}),
        });
      }
      const gatewayNamespace = base.namespace ?? undefined;
      const gatewayName = base.name;
      for (const route of context.networkResources) {
        if (route.kind !== 'HTTPRoute') {
          continue;
        }
        const routeSpec = this.toObject(route.spec);
        const parentRefs = this.toArray(routeSpec.parentRefs);
        const attachedToGateway = parentRefs.some((parentRef) => {
          const parentRefObj = this.toObject(parentRef);
          const parentKind = this.toMaybeString(parentRefObj.kind) ?? 'Gateway';
          const parentName = this.toMaybeString(parentRefObj.name);
          const parentNamespace =
            this.toMaybeString(parentRefObj.namespace) ??
            route.namespace ??
            undefined;
          return (
            parentKind === 'Gateway' &&
            parentName === gatewayName &&
            parentNamespace === gatewayNamespace
          );
        });
        if (!attachedToGateway) {
          continue;
        }
        const hostnames = this.toArray(routeSpec.hostnames)
          .map((hostname) => this.valueToString(hostname))
          .filter((hostname): hostname is string => Boolean(hostname));
        const rules = this.toArray(routeSpec.rules);
        for (const rule of rules) {
          const ruleObj = this.toObject(rule);
          const matches = this.toArray(ruleObj.matches);
          const normalizedMatches = matches.length > 0 ? matches : [{}];
          const backendRefs = this.toArray(ruleObj.backendRefs);
          for (const backendRef of backendRefs) {
            const backendRefObj = this.toObject(backendRef);
            const backendKind = this.toMaybeString(backendRefObj.kind) ?? 'Service';
            if (backendKind !== 'Service') {
              continue;
            }
            const serviceName = this.toMaybeString(backendRefObj.name);
            if (!serviceName) {
              continue;
            }
            const serviceNamespace =
              this.toMaybeString(backendRefObj.namespace) ??
              route.namespace ??
              undefined;
            const servicePort = this.valueToString(backendRefObj.port);
            for (const match of normalizedMatches) {
              const matchObj = this.toObject(match);
              const pathObj = this.toObject(matchObj.path);
              const routePath = this.toMaybeString(pathObj.value);
              if (hostnames.length === 0) {
                addServicePipelines({
                  sourceKind: 'Gateway',
                  sourceName: base.name,
                  sourceNamespace: gatewayNamespace,
                  path: routePath,
                  serviceName,
                  serviceNamespace,
                  servicePort,
                });
                continue;
              }
              for (const hostname of hostnames) {
                addServicePipelines({
                  sourceKind: 'Gateway',
                  sourceName: base.name,
                  sourceNamespace: gatewayNamespace,
                  host: hostname,
                  path: routePath,
                  serviceName,
                  serviceNamespace,
                  servicePort,
                });
              }
            }
          }
        }
      }
    }

    if (base.kind === 'Endpoints') {
      const spec = this.toObject(base.spec);
      const subsets = this.toArray(spec.subsets);
      for (const subset of subsets) {
        const subsetObj = this.toObject(subset);
        const ports = this.toArray(subsetObj.ports)
          .map((port) => this.toObject(port))
          .filter((port) => Object.keys(port).length > 0);
        const addresses = this.toArray(subsetObj.addresses);
        for (const address of addresses) {
          const addressObj = this.toObject(address);
          summary.endpoints.push({
            kind: 'service-port',
            name: base.name,
            namespace: base.namespace ?? undefined,
            sourceKind: 'Endpoints',
            sourceName: base.name,
            sourceId: base.id,
            ip: this.toMaybeString(addressObj.ip),
            hostname: this.toMaybeString(addressObj.hostname),
            ports: ports.map((port) => ({
              port: this.toMaybeNumber(port.port) ?? 0,
              protocol: this.toMaybeString(port.protocol) ?? undefined,
              targetPort: this.toMaybeString(port.name) ?? undefined,
            })),
          });
          const targetRef = this.toObject(addressObj.targetRef);
          const targetKind = this.toMaybeString(targetRef.kind);
          const podName =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.name) ?? undefined
              : undefined;
          const podNamespace =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.namespace) ??
                base.namespace ??
                undefined
              : undefined;
          addPipeline({
            sourceKind: 'Service',
            sourceName: base.name,
            ...(base.namespace ? { sourceNamespace: base.namespace } : {}),
            serviceName: base.name,
            ...(base.namespace ? { serviceNamespace: base.namespace } : {}),
            endpointSourceKind: 'Endpoints',
            endpointSourceName: base.name,
            ...(podName ? { backendPodName: podName } : {}),
            ...(podNamespace ? { backendPodNamespace: podNamespace } : {}),
            ...(this.toMaybeString(addressObj.ip)
              ? { ip: this.toMaybeString(addressObj.ip) ?? undefined }
              : {}),
            ready: true,
          });
        }
        const notReadyAddresses = this.toArray(subsetObj.notReadyAddresses);
        for (const address of notReadyAddresses) {
          const addressObj = this.toObject(address);
          const targetRef = this.toObject(addressObj.targetRef);
          const targetKind = this.toMaybeString(targetRef.kind);
          const podName =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.name) ?? undefined
              : undefined;
          const podNamespace =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.namespace) ??
                base.namespace ??
                undefined
              : undefined;
          addPipeline({
            sourceKind: 'Service',
            sourceName: base.name,
            ...(base.namespace ? { sourceNamespace: base.namespace } : {}),
            serviceName: base.name,
            ...(base.namespace ? { serviceNamespace: base.namespace } : {}),
            endpointSourceKind: 'Endpoints',
            endpointSourceName: base.name,
            ...(podName ? { backendPodName: podName } : {}),
            ...(podNamespace ? { backendPodNamespace: podNamespace } : {}),
            ...(this.toMaybeString(addressObj.ip)
              ? { ip: this.toMaybeString(addressObj.ip) ?? undefined }
              : {}),
            ready: false,
          });
        }
      }
    }

    if (base.kind === 'EndpointSlice') {
      const spec = this.toObject(base.spec);
      const ports = this.toArray(spec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0);
      const endpoints = this.toArray(spec.endpoints);
      const serviceNames = this.extractEndpointSliceServiceNames(
        base.spec,
        base.statusJson,
      );
      for (const endpoint of endpoints) {
        const endpointObj = this.toObject(endpoint);
        const addresses = this.toArray(endpointObj.addresses);
        for (const address of addresses) {
          summary.endpoints.push({
            kind: 'service-port',
            name: base.name,
            namespace: base.namespace ?? undefined,
            sourceKind: 'EndpointSlice',
            sourceName: base.name,
            sourceId: base.id,
            ip: this.valueToString(address),
            hostname: this.toMaybeString(endpointObj.hostname),
            ports: ports.map((port) => ({
              port: this.toMaybeNumber(port.port) ?? 0,
              protocol: this.toMaybeString(port.protocol) ?? undefined,
              targetPort: this.toMaybeString(port.name) ?? undefined,
            })),
          });
          const targetRef = this.toObject(endpointObj.targetRef);
          const targetKind = this.toMaybeString(targetRef.kind);
          const podName =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.name) ?? undefined
              : undefined;
          const podNamespace =
            targetKind === 'Pod'
              ? this.toMaybeString(targetRef.namespace) ??
                base.namespace ??
                undefined
              : undefined;
          const ready = this.toMaybeBoolean(
            this.toObject(endpointObj.conditions).ready,
          );
          for (const serviceName of serviceNames) {
            addPipeline({
              sourceKind: 'Service',
              sourceName: serviceName,
              ...(base.namespace ? { sourceNamespace: base.namespace } : {}),
              serviceName,
              ...(base.namespace ? { serviceNamespace: base.namespace } : {}),
              endpointSourceKind: 'EndpointSlice',
              endpointSourceName: base.name,
              ...(podName ? { backendPodName: podName } : {}),
              ...(podNamespace ? { backendPodNamespace: podNamespace } : {}),
              ...(this.valueToString(address)
                ? { ip: this.valueToString(address) ?? undefined }
                : {}),
              ...(ready !== undefined ? { ready } : {}),
            });
          }
        }
      }
    }

    return summary;
  }

  private relationshipGroupForAssociation(
    association: ResourceAssociation,
  ): ResourceDetailRelationshipGroupKey {
    if (
      association.associationType === 'owner' ||
      association.associationType === 'owned-pod'
    ) {
      return 'control';
    }
    if (
      [
        'routes-to-service',
        'traefik-routes-to-service',
        'selects-service',
        'service-endpoints',
        'service-endpointslice',
        'backend-service',
        'route-middleware',
      ].includes(association.associationType)
    ) {
      return 'network';
    }
    if (
      [
        'mount-claim',
        'bound-volume',
        'bound-claim',
        'uses-volume',
        'uses-claim',
        'uses-storageclass',
      ].includes(association.associationType)
    ) {
      return 'storage';
    }
    if (
      [
        'config-ref',
        'secret-ref',
        'uses-configmap',
        'uses-secret',
        'tls-secret',
      ].includes(association.associationType)
    ) {
      return 'config';
    }
    return 'other';
  }

  private relationshipAssociationTitle(associationType: string): string {
    const labels: Record<string, string> = {
      'routes-to-service': 'Ingress 转发',
      'traefik-routes-to-service': 'IngressRoute 转发',
      'selects-service': '后端发现',
      'service-endpoints': '服务端点',
      'service-endpointslice': '端点切片',
      'backend-service': '后端服务',
      'tls-secret': 'TLS 证书',
      'route-middleware': '路由中间件',
      'owned-pod': '拥有 Pod',
      owner: '上级控制器',
      'uses-configmap': '使用 ConfigMap',
      'uses-secret': '使用 Secret',
      'secret-ref': 'Secret 引用',
      'config-ref': '配置引用',
      'mount-claim': '挂载 PVC',
      'bound-volume': '绑定 PV',
      'bound-claim': '绑定 PVC',
      'uses-volume': '使用 PV',
      'uses-claim': '使用 PVC',
      'uses-storageclass': '使用 StorageClass',
    };
    return labels[associationType] ?? associationType;
  }

  private relationshipAssociationColor(associationType: string): string {
    const colors: Record<string, string> = {
      'routes-to-service': 'green',
      'traefik-routes-to-service': 'cyan',
      'selects-service': 'orange',
      'service-endpoints': 'gold',
      'service-endpointslice': 'volcano',
      'backend-service': 'blue',
      'tls-secret': 'magenta',
      'route-middleware': 'geekblue',
      'owned-pod': 'purple',
      owner: 'purple',
      'uses-configmap': 'blue',
      'uses-secret': 'magenta',
      'secret-ref': 'purple',
      'config-ref': 'blue',
      'mount-claim': 'cyan',
      'bound-volume': 'blue',
      'bound-claim': 'cyan',
      'uses-volume': 'blue',
      'uses-claim': 'cyan',
      'uses-storageclass': 'gold',
    };
    return colors[associationType] ?? 'default';
  }

  private relationshipConfigUsageTitle(usageType: string): string {
    const labels: Record<string, string> = {
      volume: 'Volume',
      env: 'Env',
      envFrom: 'EnvFrom',
      projected: 'Projected',
      imagePullSecret: 'ImagePullSecret',
      token: 'Token',
      tls: 'TLS',
      unknown: 'Unknown',
    };
    return labels[usageType] ?? usageType;
  }

  private relationshipConfigUsageColor(usageType: string): string {
    const colors: Record<string, string> = {
      volume: 'blue',
      env: 'cyan',
      envFrom: 'geekblue',
      projected: 'purple',
      imagePullSecret: 'magenta',
      token: 'gold',
      tls: 'red',
      unknown: 'default',
    };
    return colors[usageType] ?? 'default';
  }

  private enrichRelationshipNode(
    node: ResourceDetailRelationshipNode,
    base: DetailResourceRecord,
    context: DetailContext,
    associations: ResourceAssociation[],
  ): ResourceDetailRelationshipNode {
    const kind = node.kind;
    const name = node.name;
    const namespace = node.namespace;
    const apiVersion = kind ? this.resolveRelationshipApiVersion(kind) : undefined;
    const clusterId = this.resolveRelationshipClusterId(
      kind,
      name,
      namespace,
      base,
      context,
    );
    const id =
      node.id ??
      this.resolveRelationshipId(
        kind,
        name,
        namespace,
        base,
        context,
        associations,
      );

    return {
      ...node,
      ...(id ? { id } : {}),
      ...(clusterId ? { clusterId } : {}),
      ...(apiVersion ? { apiVersion } : {}),
    };
  }

  private resolveRelationshipApiVersion(kind: string): string | undefined {
    try {
      return this.resolveKind(kind).apiVersion;
    } catch {
      return undefined;
    }
  }

  private resolveRelationshipClusterId(
    kind: string | undefined,
    name: string | undefined,
    namespace: string | undefined,
    base: DetailResourceRecord,
    context: DetailContext,
  ): string | undefined {
    if (!kind || !name || kind === 'Container' || kind === 'Volume' || kind === 'Pod/IP') {
      return undefined;
    }
    if (
      base.kind === kind &&
      base.name === name &&
      (!namespace || !base.namespace || base.namespace === namespace)
    ) {
      return base.clusterId;
    }

    const pools = [
      context.workloads,
      context.networkResources,
      context.storageResources,
      context.configResources,
    ];
    for (const pool of pools) {
      const matched = pool.find(
        (item) =>
          item.kind === kind &&
          item.name === name &&
          (!namespace || !item.namespace || item.namespace === namespace),
      );
      if (matched) {
        return matched.clusterId;
      }
    }
    return base.clusterId;
  }

  private resolveRelationshipId(
    kind: string | undefined,
    name: string | undefined,
    namespace: string | undefined,
    base: DetailResourceRecord,
    context: DetailContext,
    associations: ResourceAssociation[],
  ): string | undefined {
    if (!kind || !name || kind === 'Container' || kind === 'Volume' || kind === 'Pod/IP') {
      return undefined;
    }
    const association = associations.find(
      (item) =>
        item.kind === kind &&
        item.name === name &&
        (!namespace || !item.namespace || item.namespace === namespace) &&
        item.id,
    );
    if (association?.id) {
      return association.id;
    }
    if (
      base.kind === kind &&
      base.name === name &&
      (!namespace || !base.namespace || base.namespace === namespace)
    ) {
      return base.id;
    }

    const pools = [
      context.workloads,
      context.networkResources,
      context.storageResources,
      context.configResources,
    ];
    for (const pool of pools) {
      const matched = pool.find(
        (item) =>
          item.kind === kind &&
          item.name === name &&
          (!namespace || !item.namespace || item.namespace === namespace),
      );
      if (matched?.id) {
        return matched.id;
      }
    }
    if (namespace) {
      return this.buildLiveNetworkId(base.clusterId, kind, namespace, name);
    }
    return undefined;
  }

  private buildStorageSummary(
    base: DetailResourceRecord,
    context: DetailContext,
  ): ResourceDetailStorageSummary {
    const storageClasses = new Set<string>();
    const pvcMap = new Map<string, ResourceDetailPvcSummary>();
    const pvMap = new Map<string, ResourceDetailPvSummary>();
    const storageClassMap = new Map<string, ResourceDetailStorageClassSummary>();
    const volumes: ResourceDetailVolumeSummary[] = [];
    const mounts: ResourceDetailMountSummary[] = [];
    const storagePipelines: ResourceDetailStoragePipeline[] = [];

    const addPvc = (
      name: string,
      namespace: string | undefined,
      phase?: string,
      storageClass?: string,
      volumeName?: string,
      detail?: DetailResourceRecord,
    ) => {
      if (!name) {
        return;
      }
      const key = `${namespace ?? ''}/${name}`;
      if (pvcMap.has(key)) {
        return;
      }
      pvcMap.set(key, {
        name,
        ...(namespace ? { namespace } : {}),
        ...(phase ? { phase } : {}),
        ...(storageClass ? { storageClass } : {}),
        ...(volumeName ? { volumeName } : {}),
        ...this.summarizePvcDetail(detail),
      });
      if (storageClass) {
        storageClasses.add(storageClass);
      }
    };

    const addPv = (
      name: string,
      phase?: string,
      storageClass?: string,
      detail?: DetailResourceRecord,
    ) => {
      if (!name || pvMap.has(name)) {
        return;
      }
      pvMap.set(name, {
        name,
        ...(phase ? { phase } : {}),
        ...(storageClass ? { storageClass } : {}),
        ...this.summarizePvDetail(detail),
      });
      if (storageClass) {
        storageClasses.add(storageClass);
      }
    };
    const addStorageClassDetail = (detail?: DetailResourceRecord | null) => {
      if (!detail || detail.kind !== 'StorageClass') {
        return;
      }
      storageClassMap.set(detail.name, this.summarizeStorageClassDetail(detail));
    };

    if (this.isWorkloadKind(base.kind)) {
      const refs = this.extractWorkloadRefs(base.kind, base.spec);
      for (const volume of refs.volumes) {
        volumes.push(volume);
      }
      for (const mount of refs.mounts) {
        mounts.push(mount);
      }
      for (const pipeline of this.buildStoragePipelinesForWorkload(
        base,
        context.storageResources,
      )) {
        storagePipelines.push(pipeline);
      }
      for (const pvcName of refs.pvcNames) {
        const pvc = context.storageResources.find(
          (item) =>
            item.kind === 'PersistentVolumeClaim' &&
            item.name === pvcName &&
            item.namespace === base.namespace,
        );
        if (pvc) {
          const pvcSpec = this.toObject(pvc.spec);
          const pvcStatus = this.toObject(pvc.statusJson);
          addPvc(
            pvc.name,
            pvc.namespace ?? undefined,
            this.toMaybeString(pvcStatus.phase),
            this.resolveStorageClass(pvc),
            this.toMaybeString(pvcSpec.volumeName),
            pvc,
          );
        } else {
          addPvc(pvcName, base.namespace ?? undefined);
        }
      }

      for (const pipeline of storagePipelines) {
        if (!pipeline.pvcName) {
          continue;
        }
        addPvc(
          pipeline.pvcName,
          pipeline.pvcNamespace,
          pipeline.pvcPhase,
          pipeline.storageClass,
          pipeline.pvName,
          context.storageResources.find(
            (item) =>
              item.kind === 'PersistentVolumeClaim' &&
              item.name === pipeline.pvcName &&
              item.namespace === pipeline.pvcNamespace,
          ),
        );
        if (pipeline.pvName) {
          addPv(
            pipeline.pvName,
            pipeline.pvPhase,
            pipeline.storageClass,
            context.storageResources.find(
              (item) =>
                item.kind === 'PersistentVolume' &&
                item.name === pipeline.pvName,
            ),
          );
        }
      }
    }

    if (base.kind === 'PersistentVolumeClaim') {
      const spec = this.toObject(base.spec);
      const status = this.toObject(base.statusJson);
      const storageClass = this.resolveStorageClass(base);
      const volumeName = this.toMaybeString(spec.volumeName);
      addPvc(
        base.name,
        base.namespace ?? undefined,
        this.toMaybeString(status.phase),
        storageClass,
        volumeName,
        base,
      );
      if (volumeName) {
        const pv = context.storageResources.find(
          (item) =>
            item.kind === 'PersistentVolume' && item.name === volumeName,
        );
        const pvStatus = this.toObject(pv?.statusJson ?? null);
        addPv(
          volumeName,
          this.toMaybeString(pvStatus.phase),
          this.resolveStorageClass(pv),
          pv,
        );
      }
    }

    if (base.kind === 'PersistentVolume') {
      const status = this.toObject(base.statusJson);
      addPv(
        base.name,
        this.toMaybeString(status.phase),
        this.resolveStorageClass(base),
        base,
      );
      for (const pvc of context.storageResources) {
        if (pvc.kind !== 'PersistentVolumeClaim') {
          continue;
        }
        const pvcSpec = this.toObject(pvc.spec);
        if (this.toMaybeString(pvcSpec.volumeName) !== base.name) {
          continue;
        }
        const pvcStatus = this.toObject(pvc.statusJson);
        addPvc(
          pvc.name,
          pvc.namespace ?? undefined,
          this.toMaybeString(pvcStatus.phase),
          this.resolveStorageClass(pvc),
          this.toMaybeString(pvcSpec.volumeName),
          pvc,
        );
      }
    }

    if (base.kind === 'StorageClass') {
      storageClasses.add(base.name);
      addStorageClassDetail(base);
      for (const storage of context.storageResources) {
        const storageClass = this.resolveStorageClass(storage);
        if (storageClass !== base.name) {
          continue;
        }
        if (storage.kind === 'PersistentVolumeClaim') {
          const spec = this.toObject(storage.spec);
          const status = this.toObject(storage.statusJson);
          addPvc(
            storage.name,
            storage.namespace ?? undefined,
            this.toMaybeString(status.phase),
            storageClass,
            this.toMaybeString(spec.volumeName),
            storage,
          );
          continue;
        }
        if (storage.kind === 'PersistentVolume') {
          const status = this.toObject(storage.statusJson);
          addPv(
            storage.name,
            this.toMaybeString(status.phase),
            storageClass,
            storage,
          );
        }
      }

      for (const workload of context.workloads) {
        const pipelines = this.buildStoragePipelinesForWorkload(
          workload,
          context.storageResources,
        );
        if (
          pipelines.some((pipeline) => pipeline.storageClass === base.name)
        ) {
          storagePipelines.push(
            ...pipelines.filter(
              (pipeline) => pipeline.storageClass === base.name,
            ),
          );
        }
      }
    }

    return {
      storageClasses: Array.from(storageClasses),
      persistentVolumeClaims: Array.from(pvcMap.values()),
      persistentVolumes: Array.from(pvMap.values()),
      storageClassDetails: Array.from(storageClassMap.values()),
      volumes,
      mounts,
      storagePipelines,
    };
  }

  private buildMetadata(
    base: DetailResourceRecord,
    context: DetailContext,
  ): ResourceDetailMetadata {
    const status = this.toObject(base.statusJson);
    const ownerReferences = this.toArray(status.ownerReferences).map((item) => {
      const ref = this.toObject(item);
      return {
        kind: this.toMaybeString(ref.kind),
        name: this.toMaybeString(ref.name),
        uid: this.toMaybeString(ref.uid),
        controller: this.toMaybeBoolean(ref.controller),
      };
    });
    const configUsages: ResourceDetailConfigUsage[] = [];
    const addConfigUsage = (usage: ResourceDetailConfigUsage) => {
      const key = [
        usage.referencedKind,
        usage.referencedNamespace ?? '',
        usage.referencedName,
        usage.consumerKind,
        usage.consumerNamespace ?? '',
        usage.consumerName,
        usage.usageType,
        usage.container ?? '',
        usage.mountPath ?? '',
        usage.key ?? '',
      ].join('|');
      if (configUsageKeys.has(key)) {
        return;
      }
      configUsageKeys.add(key);
      configUsages.push(usage);
    };
    const configUsageKeys = new Set<string>();
    const appendConfigUsagesForWorkload = (
      workload: Pick<DetailResourceRecord, 'kind' | 'name' | 'namespace' | 'spec'>,
    ) => {
      const refs = this.extractWorkloadRefs(workload.kind, workload.spec);
      for (const usage of refs.configUsages) {
        addConfigUsage({
          ...usage,
          consumerKind: workload.kind,
          consumerName: workload.name,
          consumerNamespace: workload.namespace ?? undefined,
          referencedNamespace:
            usage.referencedNamespace ??
            workload.namespace ??
            undefined,
        });
      }
    };

    if (this.isWorkloadKind(base.kind)) {
      appendConfigUsagesForWorkload(base);
    }
    if (base.kind === 'ConfigMap' || base.kind === 'Secret') {
      const referencedKind = base.kind;
      for (const workload of context.workloads) {
        if (workload.namespace !== base.namespace) {
          continue;
        }
        const refs = this.extractWorkloadRefs(workload.kind, workload.spec);
        for (const usage of refs.configUsages) {
          if (
            usage.referencedKind !== referencedKind ||
            usage.referencedName !== base.name
          ) {
            continue;
          }
          addConfigUsage({
            ...usage,
            consumerKind: workload.kind,
            consumerName: workload.name,
            consumerNamespace: workload.namespace ?? undefined,
            referencedNamespace:
              usage.referencedNamespace ??
              workload.namespace ??
              undefined,
          });
        }
      }
      for (const networkResource of context.networkResources) {
        if (networkResource.namespace !== base.namespace) {
          continue;
        }
        if (
          (base.kind === 'Secret' && networkResource.kind === 'Ingress') ||
          (base.kind === 'Secret' && networkResource.kind === 'IngressRoute')
        ) {
          const secretNames =
            networkResource.kind === 'Ingress'
              ? this.extractIngressTlsSecretNames(networkResource.spec)
              : (() => {
                  const tls = this.toObject(this.toObject(networkResource.spec).tls);
                  const secretName = this.toMaybeString(tls.secretName);
                  return secretName ? [secretName] : [];
                })();
          if (!secretNames.includes(base.name)) {
            continue;
          }
          addConfigUsage({
            referencedKind: 'Secret',
            referencedName: base.name,
            referencedNamespace: base.namespace ?? undefined,
            consumerKind: networkResource.kind,
            consumerName: networkResource.name,
            consumerNamespace: networkResource.namespace ?? undefined,
            usageType: 'tls',
          });
        }
      }
    }
    if (base.kind === 'Ingress') {
      for (const secretName of this.extractIngressTlsSecretNames(base.spec)) {
        addConfigUsage({
          referencedKind: 'Secret',
          referencedName: secretName,
          referencedNamespace: base.namespace ?? undefined,
          consumerKind: 'Ingress',
          consumerName: base.name,
          consumerNamespace: base.namespace ?? undefined,
          usageType: 'tls',
        });
      }
    }
    if (base.kind === 'IngressRoute') {
      const tls = this.toObject(this.toObject(base.spec).tls);
      const secretName = this.toMaybeString(tls.secretName);
      if (secretName) {
        addConfigUsage({
          referencedKind: 'Secret',
          referencedName: secretName,
          referencedNamespace: base.namespace ?? undefined,
          consumerKind: 'IngressRoute',
          consumerName: base.name,
          consumerNamespace: base.namespace ?? undefined,
          usageType: 'tls',
        });
      }
    }

    return {
      labels: this.toStringMap(base.labels),
      annotations: this.toStringMap(base.annotations),
      ownerReferences,
      configUsages,
    };
  }

  private async buildEventsSummary(
    base: DetailResourceRecord,
  ): Promise<ResourceDetailResponse['events']> {
    try {
      const kubeconfig = await this.clustersService.getKubeconfig(
        base.clusterId,
      );
      if (!kubeconfig) {
        return { items: [] };
      }
      const coreApi = this.k8sClientService.getCoreApi(kubeconfig) as unknown as {
        listNamespacedEvent?: (param: {
          namespace: string;
          fieldSelector?: string;
          limit?: number;
        }) => Promise<{ items?: unknown[] }>;
        listEventForAllNamespaces?: (param?: {
          fieldSelector?: string;
          limit?: number;
        }) => Promise<{ items?: unknown[] }>;
      };
      const selectors = [
        `involvedObject.kind=${base.kind}`,
        `involvedObject.name=${base.name}`,
        base.namespace ? `involvedObject.namespace=${base.namespace}` : null,
      ].filter((item): item is string => Boolean(item));
      const fieldSelector = selectors.join(',');
      const response = base.namespace
        ? await coreApi.listNamespacedEvent?.({
            namespace: base.namespace,
            fieldSelector,
            limit: 30,
          })
        : await coreApi.listEventForAllNamespaces?.({
            fieldSelector,
            limit: 30,
          });
      const items = Array.isArray(response?.items) ? response.items : [];
      return {
        items: items
          .map((event) => this.normalizeDetailEvent(event))
          .filter(
            (event): event is Record<string, unknown> =>
              Object.keys(event).length > 0,
          )
          .sort(
            (left, right) =>
              this.eventTimestampMs(right) - this.eventTimestampMs(left),
          ),
      };
    } catch (error) {
      this.logger.warn(
        `detail events degraded: ${base.kind}/${base.name}: ${(error as Error).message}`,
      );
      return { items: [] };
    }
  }

  private normalizeDetailEvent(event: unknown): Record<string, unknown> {
    const item = this.toObject(event);
    if (Object.keys(item).length === 0) {
      return {};
    }
    const metadata = this.toObject(item.metadata);
    const involvedObject = this.toObject(item.involvedObject);
    const related = this.toObject(item.related);
    const source = this.toObject(item.source);
    const normalized = {
      id: this.toMaybeString(metadata.uid) ?? this.toMaybeString(metadata.name),
      name: this.toMaybeString(metadata.name),
      namespace: this.toMaybeString(metadata.namespace),
      type: this.toMaybeString(item.type),
      reason: this.toMaybeString(item.reason),
      message: this.toMaybeString(item.message),
      action: this.toMaybeString(item.action),
      count: this.toMaybeNumber(item.count),
      firstTimestamp: this.timestampToIso(item.firstTimestamp),
      lastTimestamp:
        this.timestampToIso(item.lastTimestamp) ??
        this.timestampToIso(item.eventTime) ??
        this.timestampToIso(metadata.creationTimestamp),
      eventTime: this.timestampToIso(item.eventTime),
      source:
        this.toMaybeString(source.component) ??
        this.toMaybeString(item.reportingComponent),
      sourceHost: this.toMaybeString(source.host),
      reportingComponent: this.toMaybeString(item.reportingComponent),
      reportingInstance: this.toMaybeString(item.reportingInstance),
      involvedObject: this.compactStringMap({
        kind: this.toMaybeString(involvedObject.kind),
        name: this.toMaybeString(involvedObject.name),
        namespace: this.toMaybeString(involvedObject.namespace),
        fieldPath: this.toMaybeString(involvedObject.fieldPath),
        uid: this.toMaybeString(involvedObject.uid),
      }),
      related:
        Object.keys(related).length > 0
          ? this.compactStringMap({
              kind: this.toMaybeString(related.kind),
              name: this.toMaybeString(related.name),
              namespace: this.toMaybeString(related.namespace),
              fieldPath: this.toMaybeString(related.fieldPath),
              uid: this.toMaybeString(related.uid),
            })
          : undefined,
    };
    return Object.fromEntries(
      Object.entries(normalized).filter(([, value]) =>
        Array.isArray(value)
          ? value.length > 0
          : value !== undefined &&
            value !== null &&
            !(typeof value === 'object' && Object.keys(value).length === 0),
      ),
    );
  }

  private eventTimestampMs(event: Record<string, unknown>): number {
    const timestamp =
      this.toMaybeString(event.lastTimestamp) ??
      this.toMaybeString(event.eventTime) ??
      this.toMaybeString(event.firstTimestamp);
    if (!timestamp) {
      return 0;
    }
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private async findDetailResource(
    meta: KindMeta,
    id: string,
  ): Promise<DetailResourceRecord | null> {
    const detailSource = meta.detailSource;
    if (!detailSource) {
      return null;
    }

    if (detailSource === 'workload') {
      const row = await this.prisma.workloadRecord.findUnique({
        where: { id },
      });
      if (!row || row.state === 'deleted' || row.kind !== meta.kind) {
        return null;
      }
      return this.mapWorkloadRow(row);
    }

    if (detailSource === 'network') {
      const liveResource = await this.findLiveNetworkDetailResource(meta, id);
      if (liveResource) {
        return liveResource;
      }
      const row = await this.prisma.networkResource.findUnique({
        where: { id },
      });
      if (!row || row.state === 'deleted' || row.kind !== meta.kind) {
        return null;
      }
      return this.mapNetworkRow(row);
    }

    if (detailSource === 'config') {
      const row = await this.prisma.configResource.findUnique({
        where: { id },
      });
      if (!row || row.state === 'deleted' || row.kind !== meta.kind) {
        return null;
      }
      return this.mapConfigRow(row);
    }

    if (detailSource === 'namespace') {
      const row = await this.prisma.namespaceRecord.findUnique({
        where: { id },
      });
      if (!row || row.state === 'deleted') {
        return null;
      }
      return this.mapNamespaceRow(row);
    }

    if (detailSource === 'autoscaling') {
      const liveResource = await this.findLiveAutoscalingDetailResource(
        meta,
        id,
      );
      if (!liveResource) {
        return null;
      }
      return liveResource;
    }

    const storageRow = await this.prisma.storageResource.findUnique({
      where: { id },
    });
    if (
      !storageRow ||
      storageRow.state === 'deleted' ||
      storageRow.kind !== meta.storageKind
    ) {
      return null;
    }
    return this.mapStorageRow(storageRow);
  }

  private async findLiveNetworkDetailResource(
    meta: KindMeta,
    id: string,
  ): Promise<DetailResourceRecord | null> {
    const ref = this.parseLiveNetworkId(id);
    if (!ref || ref.kind !== meta.kind) {
      return null;
    }
    const apis = await this.getClusterApis(ref.clusterId);
    if (!apis) {
      return null;
    }

    let spec: unknown = null;
    let statusJson: unknown = null;
    let labels: Record<string, string> | null = null;
    let annotations: Record<string, string> | null = null;
    let createdAt = new Date();

    if (ref.kind === 'Ingress') {
      const item = await apis.networkingApi.readNamespacedIngress({
        namespace: ref.namespace,
        name: ref.name,
      });
      spec = item.spec ?? null;
      statusJson = item.status ?? null;
      labels = item.metadata?.labels ?? null;
      annotations = item.metadata?.annotations ?? null;
      createdAt = item.metadata?.creationTimestamp ?? createdAt;
    } else if (ref.kind === 'IngressRoute') {
      const response = await apis.customObjectsApi.getNamespacedCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace: ref.namespace,
        plural: 'ingressroutes',
        name: ref.name,
      });
      const body = this.toObject(
        (response as { body?: unknown }).body ?? response,
      );
      const metadata = this.toObject(body.metadata);
      spec = this.toObject(body.spec);
      statusJson = this.toObject(body.status);
      labels = this.toStringMap(metadata.labels);
      annotations = this.toStringMap(metadata.annotations);
      createdAt =
        this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
        createdAt;
    } else if (ref.kind === 'GatewayClass') {
      const response = await apis.customObjectsApi.getClusterCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        plural: 'gatewayclasses',
        name: ref.name,
      });
      const body = this.toObject(
        (response as { body?: unknown }).body ?? response,
      );
      const metadata = this.toObject(body.metadata);
      spec = this.toObject(body.spec);
      statusJson = this.toObject(body.status);
      labels = this.toStringMap(metadata.labels);
      annotations = this.toStringMap(metadata.annotations);
      createdAt =
        this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
        createdAt;
    } else if (ref.kind === 'Gateway') {
      const response = await apis.customObjectsApi.getNamespacedCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        namespace: ref.namespace,
        plural: 'gateways',
        name: ref.name,
      });
      const body = this.toObject(
        (response as { body?: unknown }).body ?? response,
      );
      const metadata = this.toObject(body.metadata);
      spec = this.toObject(body.spec);
      statusJson = this.toObject(body.status);
      labels = this.toStringMap(metadata.labels);
      annotations = this.toStringMap(metadata.annotations);
      createdAt =
        this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
        createdAt;
    } else if (ref.kind === 'HTTPRoute') {
      const response = await apis.customObjectsApi.getNamespacedCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        namespace: ref.namespace,
        plural: 'httproutes',
        name: ref.name,
      });
      const body = this.toObject(
        (response as { body?: unknown }).body ?? response,
      );
      const metadata = this.toObject(body.metadata);
      spec = this.toObject(body.spec);
      statusJson = this.toObject(body.status);
      labels = this.toStringMap(metadata.labels);
      annotations = this.toStringMap(metadata.annotations);
      createdAt =
        this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
        createdAt;
    } else if (ref.kind === 'Middleware') {
      const response = await apis.customObjectsApi.getNamespacedCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace: ref.namespace,
        plural: 'middlewares',
        name: ref.name,
      });
      const body = this.toObject(
        (response as { body?: unknown }).body ?? response,
      );
      const metadata = this.toObject(body.metadata);
      spec = this.toObject(body.spec);
      statusJson = this.toObject(body.status);
      labels = this.toStringMap(metadata.labels);
      annotations = this.toStringMap(metadata.annotations);
      createdAt =
        this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
        createdAt;
    } else if (ref.kind === 'NetworkPolicy') {
      const item = await apis.networkingApi.readNamespacedNetworkPolicy({
        namespace: ref.namespace,
        name: ref.name,
      });
      const specObj = this.toObject(item.spec);
      const policyTypes = this.toStringArray(specObj.policyTypes);
      const ingressRules = this.toArray(specObj.ingress).map((rule) =>
        this.summarizeNetworkPolicyRule(this.toObject(rule), 'ingress'),
      );
      const egressRules = this.toArray(specObj.egress).map((rule) =>
        this.summarizeNetworkPolicyRule(this.toObject(rule), 'egress'),
      );
      const podSelector = this.toSelectorString(
        this.toObject(this.toObject(item.spec).podSelector).matchLabels,
      );
      spec = item.spec ?? null;
      statusJson = {
        phase: item.metadata?.deletionTimestamp ? 'Terminating' : 'Active',
        policyTypes,
        podSelector,
        ingressRules,
        egressRules,
      };
      labels = item.metadata?.labels ?? null;
      annotations = item.metadata?.annotations ?? null;
      createdAt = item.metadata?.creationTimestamp ?? createdAt;
    } else if (ref.kind === 'Service') {
      const item = await apis.coreApi.readNamespacedService({
        namespace: ref.namespace,
        name: ref.name,
      });
      spec = item.spec ?? null;
      statusJson = item.status ?? null;
      labels = item.metadata?.labels ?? null;
      annotations = item.metadata?.annotations ?? null;
      createdAt = item.metadata?.creationTimestamp ?? createdAt;
    } else if (ref.kind === 'Endpoints') {
      const item = await apis.coreApi.readNamespacedEndpoints({
        namespace: ref.namespace,
        name: ref.name,
      });
      spec = { subsets: item.subsets ?? [] };
      statusJson = item as unknown;
      labels = item.metadata?.labels ?? null;
      annotations = item.metadata?.annotations ?? null;
      createdAt = item.metadata?.creationTimestamp ?? createdAt;
    } else if (ref.kind === 'EndpointSlice') {
      const item = await apis.discoveryApi.readNamespacedEndpointSlice({
        namespace: ref.namespace,
        name: ref.name,
      });
      spec = {
        addressType: item.addressType,
        ports: item.ports,
        endpoints: item.endpoints,
        metadataLabels: item.metadata?.labels ?? null,
      };
      statusJson = item as unknown;
      labels = item.metadata?.labels ?? null;
      annotations = item.metadata?.annotations ?? null;
      createdAt = item.metadata?.creationTimestamp ?? createdAt;
    }

    return {
      id,
      clusterId: ref.clusterId,
      namespace: ref.namespace,
      kind: ref.kind,
      name: ref.name,
      state: 'active',
      createdAt,
      updatedAt: createdAt,
      spec: (spec as Prisma.JsonValue | null) ?? null,
      statusJson: (statusJson as Prisma.JsonValue | null) ?? null,
      labels: (labels as Prisma.JsonValue | null) ?? null,
      annotations: (annotations as Prisma.JsonValue | null) ?? null,
      replicas: null,
      readyReplicas: null,
      storageClass: null,
    };
  }

  private async findLiveAutoscalingDetailResource(
    meta: KindMeta,
    id: string,
  ): Promise<DetailResourceRecord | null> {
    const [clusterId, namespace, ...rest] = id.split('/');
    const name = rest.join('/');
    if (!clusterId || !namespace || !name) {
      throw new BadRequestException(
        'autoscaling 详情 id 必须为 clusterId/namespace/name',
      );
    }
    const client = await this.makeObjectClient(clusterId);
    try {
      const obj = await client.read({
        apiVersion: meta.apiVersion,
        kind: meta.kind,
        metadata: {
          name,
          namespace,
        },
      });
      const resource = this.toObject(obj);
      const metadata = this.toObject(resource.metadata);
      const status = this.toObject(resource.status);
      const spec = this.toObject(resource.spec);
      return {
        id,
        clusterId,
        namespace,
        kind: meta.kind,
        name,
        state: this.resolveAutoscalingState(resource),
        createdAt:
          this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
          new Date(),
        updatedAt:
          this.parseDateSafe(this.toMaybeString(metadata.creationTimestamp)) ??
          new Date(),
        spec: spec as Prisma.JsonValue,
        statusJson: status as Prisma.JsonValue,
        labels: this.toObject(metadata.labels) as Prisma.JsonValue,
        annotations: this.toObject(metadata.annotations) as Prisma.JsonValue,
        replicas:
          typeof status.currentReplicas === 'number'
            ? status.currentReplicas
            : typeof status.desiredReplicas === 'number'
              ? status.desiredReplicas
              : null,
        readyReplicas:
          typeof status.currentReplicas === 'number'
            ? status.currentReplicas
            : null,
        storageClass: null,
      };
    } catch (error) {
      const statusCode = (error as { response?: { statusCode?: number } })
        .response?.statusCode;
      if (statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  private parseLiveNetworkId(id: string): {
    clusterId: string;
    kind:
      | 'Service'
      | 'Endpoints'
      | 'EndpointSlice'
      | 'Ingress'
      | 'IngressRoute'
      | 'Middleware'
      | 'GatewayClass'
      | 'Gateway'
      | 'HTTPRoute'
      | 'NetworkPolicy';
    namespace: string;
    name: string;
  } | null {
    if (!id.startsWith(ResourcesService.LIVE_NETWORK_ID_PREFIX)) {
      return null;
    }
    const payload = id.slice(ResourcesService.LIVE_NETWORK_ID_PREFIX.length);
    const [clusterId, kindRaw, namespace, ...rest] = payload.split(':');
    const name = rest.join(':');
    if (!clusterId || !namespace || !name) {
      return null;
    }
    if (
      kindRaw !== 'Service' &&
      kindRaw !== 'Endpoints' &&
      kindRaw !== 'EndpointSlice' &&
      kindRaw !== 'Ingress' &&
      kindRaw !== 'IngressRoute' &&
      kindRaw !== 'GatewayClass' &&
      kindRaw !== 'Gateway' &&
      kindRaw !== 'HTTPRoute' &&
      kindRaw !== 'Middleware' &&
      kindRaw !== 'NetworkPolicy'
    ) {
      return null;
    }
    return {
      clusterId,
      kind: kindRaw,
      namespace,
      name,
    };
  }

  private isLiveNetworkRecord(base: DetailResourceRecord): boolean {
    return (
      base.id.startsWith(ResourcesService.LIVE_NETWORK_ID_PREFIX) &&
      LIVE_NETWORK_DETAIL_KINDS.has(base.kind)
    );
  }

  private buildLiveNetworkId(
    clusterId: string,
    kind: string,
    namespace: string,
    name: string,
  ): string | undefined {
    if (!LIVE_NETWORK_DETAIL_KINDS.has(kind)) {
      return undefined;
    }
    return `${ResourcesService.LIVE_NETWORK_ID_PREFIX}${clusterId}:${kind}:${namespace}:${name}`;
  }

  private async getClusterApis(clusterId: string): Promise<{
    coreApi: k8s.CoreV1Api;
    discoveryApi: k8s.DiscoveryV1Api;
    networkingApi: k8s.NetworkingV1Api;
    customObjectsApi: k8s.CustomObjectsApi;
  } | null> {
    await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return null;
    }
    return {
      coreApi: this.k8sClientService.getCoreApi(kubeconfig),
      discoveryApi: this.k8sClientService.getDiscoveryApi(kubeconfig),
      networkingApi: this.k8sClientService.getNetworkingApi(kubeconfig),
      customObjectsApi: this.k8sClientService.getCustomObjectsApi(kubeconfig),
    };
  }

  private parseDateSafe(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async loadDetailContext(
    clusterId: string,
    namespace: string | null,
  ): Promise<DetailContext> {
    const whereWithNamespace = namespace
      ? { clusterId, namespace, state: { not: 'deleted' as const } }
      : { clusterId, state: { not: 'deleted' as const } };

    const [workloads, networkResources, storageResources, configResources] =
      await Promise.all([
        this.prisma.workloadRecord.findMany({ where: whereWithNamespace }),
        this.prisma.networkResource.findMany({ where: whereWithNamespace }),
        this.prisma.storageResource.findMany({
          where: { clusterId, state: { not: 'deleted' } },
        }),
        this.prisma.configResource.findMany({ where: whereWithNamespace }),
      ]);

    return {
      workloads: workloads.map((row) => this.mapWorkloadRow(row)),
      networkResources: networkResources.map((row) => this.mapNetworkRow(row)),
      storageResources: storageResources.map((row) => this.mapStorageRow(row)),
      configResources: configResources.map((row) => this.mapConfigRow(row)),
    };
  }

  private mapWorkloadRow(row: {
    id: string;
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    state: string;
    spec: Prisma.JsonValue | null;
    statusJson: Prisma.JsonValue | null;
    labels: Prisma.JsonValue | null;
    annotations: Prisma.JsonValue | null;
    replicas: number | null;
    readyReplicas: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): DetailResourceRecord {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      spec: row.spec,
      statusJson: row.statusJson,
      labels: row.labels,
      annotations: row.annotations,
      replicas: row.replicas,
      readyReplicas: row.readyReplicas,
      storageClass: null,
    };
  }

  private mapNetworkRow(row: {
    id: string;
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    state: string;
    spec: Prisma.JsonValue | null;
    statusJson: Prisma.JsonValue | null;
    labels: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): DetailResourceRecord {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      spec: row.spec,
      statusJson: row.statusJson,
      labels: row.labels,
      annotations: null,
      replicas: null,
      readyReplicas: null,
      storageClass: null,
    };
  }

  private mapStorageRow(row: {
    id: string;
    clusterId: string;
    namespace: string | null;
    kind: string;
    name: string;
    state: string;
    storageClass: string | null;
    capacity: string | null;
    accessModes: Prisma.JsonValue | null;
    bindingMode: string | null;
    spec: Prisma.JsonValue | null;
    statusJson: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): DetailResourceRecord {
    const kind =
      row.kind === 'PVC'
        ? 'PersistentVolumeClaim'
        : row.kind === 'PV'
          ? 'PersistentVolume'
          : row.kind === 'SC'
            ? 'StorageClass'
            : row.kind;
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind,
      name: row.name,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      spec: row.spec,
      statusJson: row.statusJson,
      labels: null,
      annotations: null,
      replicas: null,
      readyReplicas: null,
      storageClass: row.storageClass,
    };
  }

  private mapConfigRow(row: {
    id: string;
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    state: string;
    labels: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): DetailResourceRecord {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      spec: null,
      statusJson: null,
      labels: row.labels,
      annotations: null,
      replicas: null,
      readyReplicas: null,
      storageClass: null,
    };
  }

  private mapNamespaceRow(row: {
    id: string;
    clusterId: string;
    name: string;
    state: string;
    labels: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): DetailResourceRecord {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.name,
      kind: 'Namespace',
      name: row.name,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      spec: null,
      statusJson: null,
      labels: row.labels,
      annotations: null,
      replicas: null,
      readyReplicas: null,
      storageClass: null,
    };
  }

  private resolveStorageClass(
    item?: DetailResourceRecord | null,
  ): string | undefined {
    if (!item) {
      return undefined;
    }
    const spec = this.toObject(item.spec);
    const direct = this.toMaybeString(
      (item as unknown as { storageClass?: unknown }).storageClass,
    );
    return (
      direct ??
      this.toMaybeString(spec.storageClassName) ??
      this.toMaybeString(spec.storageClass)
    );
  }

  private extractIngressServiceNames(spec: Prisma.JsonValue | null): string[] {
    const specObj = this.toObject(spec);
    const rules = this.toArray(specObj.rules);
    const names = new Set<string>();
    for (const rule of rules) {
      const ruleObj = this.toObject(rule);
      const http = this.toObject(ruleObj.http);
      const paths = this.toArray(http.paths);
      for (const path of paths) {
        const pathObj = this.toObject(path);
        const backend = this.toObject(pathObj.backend);
        const service = this.toObject(backend.service);
        const name = this.toMaybeString(service.name);
        if (name) {
          names.add(name);
        }
      }
    }
    return Array.from(names);
  }

  private extractIngressTlsSecretNames(
    spec: Prisma.JsonValue | null,
  ): string[] {
    const specObj = this.toObject(spec);
    const tls = this.toArray(specObj.tls);
    return Array.from(
      new Set(
        tls
          .map((entry) => this.toObject(entry))
          .map((entry) => this.toMaybeString(entry.secretName))
          .filter((name): name is string => Boolean(name && name.trim())),
      ),
    );
  }

  private extractIngressRouteServiceNames(
    spec: Prisma.JsonValue | null,
  ): string[] {
    const specObj = this.toObject(spec);
    const routes = this.toArray(specObj.routes);
    const names = new Set<string>();
    for (const route of routes) {
      const routeObj = this.toObject(route);
      const services = this.toArray(routeObj.services);
      for (const service of services) {
        const serviceObj = this.toObject(service);
        const name = this.toMaybeString(serviceObj.name);
        if (name) {
          names.add(name);
        }
      }
    }
    return Array.from(names);
  }

  private extractIngressRouteMiddlewares(
    spec: Prisma.JsonValue | null,
  ): Array<{ name: string; namespace?: string }> {
    const specObj = this.toObject(spec);
    const routes = this.toArray(specObj.routes);
    const names = new Map<string, { name: string; namespace?: string }>();
    for (const route of routes) {
      const routeObj = this.toObject(route);
      const middlewares = this.toArray(routeObj.middlewares);
      for (const middleware of middlewares) {
        const middlewareObj = this.toObject(middleware);
        const name = this.toMaybeString(middlewareObj.name);
        const namespace = this.toMaybeString(middlewareObj.namespace);
        if (name) {
          const key = `${namespace ?? ''}:${name}`;
          names.set(key, { name, ...(namespace ? { namespace } : {}) });
        }
      }
    }
    return Array.from(names.values());
  }

  private extractEndpointSliceServiceNames(
    spec: Prisma.JsonValue | null,
    statusJson: Prisma.JsonValue | null,
  ): string[] {
    const names = new Set<string>();
    const specObj = this.toObject(spec);
    const statusObj = this.toObject(statusJson);

    const serviceNameFromSpec = this.toMaybeString(specObj.serviceName);
    if (serviceNameFromSpec) {
      names.add(serviceNameFromSpec);
    }

    const serviceNameFromStatus = this.toMaybeString(statusObj.serviceName);
    if (serviceNameFromStatus) {
      names.add(serviceNameFromStatus);
    }

    const metadataLabels = this.toObject(specObj.metadataLabels);
    const serviceNameFromLabels = this.toMaybeString(
      metadataLabels['kubernetes.io/service-name'],
    );
    if (serviceNameFromLabels) {
      names.add(serviceNameFromLabels);
    }

    return Array.from(names);
  }

  private extractWorkloadRefs(
    kind: string,
    spec: Prisma.JsonValue | null,
  ): {
    pvcNames: string[];
    configMapNames: string[];
    secretNames: string[];
    volumes: ResourceDetailVolumeSummary[];
    mounts: ResourceDetailMountSummary[];
    configUsages: Omit<
      ResourceDetailConfigUsage,
      'consumerKind' | 'consumerName' | 'consumerNamespace'
    >[];
  } {
    const podSpec = this.extractPodSpec(kind, spec);
    const volumes = this.toArray(podSpec.volumes);
    const containers = [
      ...this.toArray(podSpec.containers),
      ...this.toArray(podSpec.initContainers),
    ];

    const pvcNames = new Set<string>();
    const configMapNames = new Set<string>();
    const secretNames = new Set<string>();
    const volumeSummaries: ResourceDetailVolumeSummary[] = [];
    const mountSummaries: ResourceDetailMountSummary[] = [];
    const configUsages: Omit<
      ResourceDetailConfigUsage,
      'consumerKind' | 'consumerName' | 'consumerNamespace'
    >[] = [];
    const configUsageKeys = new Set<string>();
    const addConfigUsage = (
      usage: Omit<
        ResourceDetailConfigUsage,
        'consumerKind' | 'consumerName' | 'consumerNamespace'
      >,
    ) => {
      const key = [
        usage.referencedKind,
        usage.referencedNamespace ?? '',
        usage.referencedName,
        usage.usageType,
        usage.container ?? '',
        usage.mountPath ?? '',
        usage.key ?? '',
      ].join('|');
      if (configUsageKeys.has(key)) {
        return;
      }
      configUsageKeys.add(key);
      configUsages.push(usage);
    };

    for (const volume of volumes) {
      const vol = this.toObject(volume);
      const volumeName = this.toMaybeString(vol.name);
      if (!volumeName) {
        continue;
      }
      const pvc = this.toObject(vol.persistentVolumeClaim);
      const configMap = this.toObject(vol.configMap);
      const secret = this.toObject(vol.secret);
      const hostPath = this.toObject(vol.hostPath);
      const projected = this.toObject(vol.projected);

      let type = 'other';
      let source: string | undefined;

      const claimName = this.toMaybeString(pvc.claimName);
      if (claimName) {
        type = 'persistentVolumeClaim';
        source = claimName;
        pvcNames.add(claimName);
      }

      const configMapName = this.toMaybeString(configMap.name);
      if (configMapName) {
        type = 'configMap';
        source = configMapName;
        configMapNames.add(configMapName);
        addConfigUsage({
          referencedKind: 'ConfigMap',
          referencedName: configMapName,
          usageType: 'volume',
        });
      }

      const secretName = this.toMaybeString(secret.secretName);
      if (secretName) {
        type = 'secret';
        source = secretName;
        secretNames.add(secretName);
        addConfigUsage({
          referencedKind: 'Secret',
          referencedName: secretName,
          usageType: 'volume',
        });
      }

      if (hostPath.path && typeof hostPath.path === 'string') {
        type = 'hostPath';
        source = hostPath.path;
      }

      if (type === 'other') {
        if (vol.emptyDir !== undefined) {
          type = 'emptyDir';
        }
        if (vol.projected !== undefined) {
          type = 'projected';
          for (const source of this.toArray(projected.sources)) {
            const sourceObj = this.toObject(source);
            const projectedConfigMap = this.toObject(sourceObj.configMap);
            const projectedSecret = this.toObject(sourceObj.secret);
            const projectedConfigMapName = this.toMaybeString(
              projectedConfigMap.name,
            );
            const projectedSecretName = this.toMaybeString(
              projectedSecret.name,
            );
            if (projectedConfigMapName) {
              configMapNames.add(projectedConfigMapName);
              addConfigUsage({
                referencedKind: 'ConfigMap',
                referencedName: projectedConfigMapName,
                usageType: 'projected',
              });
            }
            if (projectedSecretName) {
              secretNames.add(projectedSecretName);
              addConfigUsage({
                referencedKind: 'Secret',
                referencedName: projectedSecretName,
                usageType: 'projected',
              });
            }
            const serviceAccountToken = this.toObject(
              sourceObj.serviceAccountToken,
            );
            if (Object.keys(serviceAccountToken).length > 0) {
              const serviceAccountName =
                this.toMaybeString(podSpec.serviceAccountName) ?? 'default';
              addConfigUsage({
                referencedKind: 'ServiceAccount',
                referencedName: serviceAccountName,
                usageType: 'token',
                key: this.toMaybeString(serviceAccountToken.path) ?? undefined,
              });
            }
          }
        }
      }

      volumeSummaries.push({
        name: volumeName,
        type,
        ...(source ? { source } : {}),
      });
    }

    for (const container of containers) {
      const containerObj = this.toObject(container);
      const containerName =
        this.toMaybeString(containerObj.name) ?? 'container';
      const volumeMounts = this.toArray(containerObj.volumeMounts);
      for (const mount of volumeMounts) {
        const mountObj = this.toObject(mount);
        const volume = this.toMaybeString(mountObj.name);
        const mountPath = this.toMaybeString(mountObj.mountPath);
        if (!volume || !mountPath) {
          continue;
        }
        mountSummaries.push({
          container: containerName,
          volume,
          mountPath,
          readOnly: Boolean(this.toMaybeBoolean(mountObj.readOnly)),
        });
        const referencedFromVolume = volumeSummaries.find((item) => item.name === volume);
        if (referencedFromVolume?.type === 'configMap' && referencedFromVolume.source) {
          addConfigUsage({
            referencedKind: 'ConfigMap',
            referencedName: referencedFromVolume.source,
            usageType: 'volume',
            container: containerName,
            mountPath,
          });
        }
        if (referencedFromVolume?.type === 'secret' && referencedFromVolume.source) {
          addConfigUsage({
            referencedKind: 'Secret',
            referencedName: referencedFromVolume.source,
            usageType: 'volume',
            container: containerName,
            mountPath,
          });
        }
      }

      const envFromList = this.toArray(containerObj.envFrom);
      for (const envFrom of envFromList) {
        const envFromObj = this.toObject(envFrom);
        const cmRef = this.toObject(envFromObj.configMapRef);
        const secretRef = this.toObject(envFromObj.secretRef);
        const cmName = this.toMaybeString(cmRef.name);
        const secretName = this.toMaybeString(secretRef.name);
        if (cmName) {
          configMapNames.add(cmName);
          addConfigUsage({
            referencedKind: 'ConfigMap',
            referencedName: cmName,
            usageType: 'envFrom',
            container: containerName,
          });
        }
        if (secretName) {
          secretNames.add(secretName);
          addConfigUsage({
            referencedKind: 'Secret',
            referencedName: secretName,
            usageType: 'envFrom',
            container: containerName,
          });
        }
      }

      const envList = this.toArray(containerObj.env);
      for (const env of envList) {
        const envObj = this.toObject(env);
        const valueFrom = this.toObject(envObj.valueFrom);
        const cmRef = this.toObject(valueFrom.configMapKeyRef);
        const secretRef = this.toObject(valueFrom.secretKeyRef);
        const cmName = this.toMaybeString(cmRef.name);
        const secretName = this.toMaybeString(secretRef.name);
        const envKey = this.toMaybeString(envObj.name);
        if (cmName) {
          configMapNames.add(cmName);
          addConfigUsage({
            referencedKind: 'ConfigMap',
            referencedName: cmName,
            usageType: 'env',
            container: containerName,
            key: envKey ?? this.toMaybeString(cmRef.key),
          });
        }
        if (secretName) {
          secretNames.add(secretName);
          addConfigUsage({
            referencedKind: 'Secret',
            referencedName: secretName,
            usageType: 'env',
            container: containerName,
            key: envKey ?? this.toMaybeString(secretRef.key),
          });
        }
      }
    }

    for (const imagePullSecret of this.toArray(podSpec.imagePullSecrets)) {
      const imagePullSecretObj = this.toObject(imagePullSecret);
      const name = this.toMaybeString(imagePullSecretObj.name);
      if (!name) {
        continue;
      }
      secretNames.add(name);
      addConfigUsage({
        referencedKind: 'Secret',
        referencedName: name,
        usageType: 'imagePullSecret',
      });
    }

    return {
      pvcNames: Array.from(pvcNames),
      configMapNames: Array.from(configMapNames),
      secretNames: Array.from(secretNames),
      volumes: volumeSummaries,
      mounts: mountSummaries,
      configUsages,
    };
  }

  private buildStoragePipelinesForWorkload(
    workload: Pick<DetailResourceRecord, 'kind' | 'spec' | 'namespace'>,
    storageResources: DetailResourceRecord[],
  ): ResourceDetailStoragePipeline[] {
    if (!this.isWorkloadKind(workload.kind)) {
      return [];
    }
    const podSpec = this.extractPodSpec(workload.kind, workload.spec);
    const volumeMap = new Map<string, Record<string, unknown>>();
    for (const volume of this.toArray(podSpec.volumes)) {
      const volumeObj = this.toObject(volume);
      const volumeName = this.toMaybeString(volumeObj.name);
      if (!volumeName) {
        continue;
      }
      volumeMap.set(volumeName, volumeObj);
    }

    const pvcLookup = new Map<string, DetailResourceRecord>();
    const pvLookup = new Map<string, DetailResourceRecord>();
    for (const item of storageResources) {
      if (item.kind === 'PersistentVolumeClaim') {
        pvcLookup.set(`${item.namespace ?? ''}/${item.name}`, item);
      } else if (item.kind === 'PersistentVolume') {
        pvLookup.set(item.name, item);
      }
    }

    const containers = [
      ...this.toArray(podSpec.containers),
      ...this.toArray(podSpec.initContainers),
    ];
    const pipelines: ResourceDetailStoragePipeline[] = [];

    for (const container of containers) {
      const containerObj = this.toObject(container);
      const containerName =
        this.toMaybeString(containerObj.name) ?? 'container';
      for (const mount of this.toArray(containerObj.volumeMounts)) {
        const mountObj = this.toObject(mount);
        const volumeName = this.toMaybeString(mountObj.name);
        const mountPath = this.toMaybeString(mountObj.mountPath);
        if (!volumeName || !mountPath) {
          continue;
        }

        const volume = volumeMap.get(volumeName) ?? {};
        const volumeType = this.resolveVolumeType(volume);
        const volumeSource = this.resolveVolumeSource(volume, volumeType);
        const pvcObj = this.toObject(volume.persistentVolumeClaim);
        const claimName = this.toMaybeString(pvcObj.claimName);
        const claimNamespace = workload.namespace ?? undefined;
        const pvc = claimName
          ? pvcLookup.get(`${claimNamespace ?? ''}/${claimName}`)
          : undefined;
        const pvcSpec = this.toObject(pvc?.spec ?? null);
        const pvcStatus = this.toObject(pvc?.statusJson ?? null);
        const pvName = this.toMaybeString(pvcSpec.volumeName);
        const pv = pvName ? pvLookup.get(pvName) : undefined;
        const pvStatus = this.toObject(pv?.statusJson ?? null);
        const pvcPhase = this.toMaybeString(pvcStatus.phase);
        const pvPhase = this.toMaybeString(pvStatus.phase);
        const storageClass =
          this.resolveStorageClass(pvc) ??
          this.resolveStorageClass(pv) ??
          this.resolveStorageClassFromVolume(volume);

        pipelines.push({
          container: containerName,
          mountPath,
          readOnly: Boolean(this.toMaybeBoolean(mountObj.readOnly)),
          volumeName,
          ...(volumeType ? { volumeType } : {}),
          ...(volumeSource ? { volumeSource } : {}),
          ...(claimName ? { pvcName: claimName } : {}),
          ...(claimName && claimNamespace ? { pvcNamespace: claimNamespace } : {}),
          ...(pvcPhase ? { pvcPhase } : {}),
          ...(pvName ? { pvName } : {}),
          ...(pvPhase ? { pvPhase } : {}),
          ...(storageClass ? { storageClass } : {}),
        });
      }
    }

    return pipelines;
  }

  private resolveStorageClassFromVolume(
    volume: Record<string, unknown>,
  ): string | undefined {
    const pvc = this.toObject(volume.persistentVolumeClaim);
    return this.toMaybeString(pvc.storageClassName);
  }

  private resolveVolumeType(volume: Record<string, unknown>): string | undefined {
    if (this.toMaybeString(this.toObject(volume.persistentVolumeClaim).claimName)) {
      return 'persistentVolumeClaim';
    }
    if (this.toMaybeString(this.toObject(volume.configMap).name)) {
      return 'configMap';
    }
    if (this.toMaybeString(this.toObject(volume.secret).secretName)) {
      return 'secret';
    }
    if (this.toMaybeString(this.toObject(volume.hostPath).path)) {
      return 'hostPath';
    }
    if (volume.emptyDir !== undefined) {
      return 'emptyDir';
    }
    if (volume.projected !== undefined) {
      return 'projected';
    }
    if (this.toMaybeString(this.toObject(volume.csi).driver)) {
      return 'csi';
    }
    if (this.toMaybeString(this.toObject(volume.nfs).server)) {
      return 'nfs';
    }
    if (volume.downwardAPI !== undefined) {
      return 'downwardAPI';
    }
    if (volume.ephemeral !== undefined) {
      return 'ephemeral';
    }
    if (this.toMaybeString(this.toObject(volume.awsElasticBlockStore).volumeID)) {
      return 'awsElasticBlockStore';
    }
    return 'other';
  }

  private resolveVolumeSource(
    volume: Record<string, unknown>,
    volumeType?: string,
  ): string | undefined {
    if (!volumeType) {
      return undefined;
    }
    if (volumeType === 'persistentVolumeClaim') {
      return this.toMaybeString(
        this.toObject(volume.persistentVolumeClaim).claimName,
      );
    }
    if (volumeType === 'configMap') {
      return this.toMaybeString(this.toObject(volume.configMap).name);
    }
    if (volumeType === 'secret') {
      return this.toMaybeString(this.toObject(volume.secret).secretName);
    }
    if (volumeType === 'hostPath') {
      return this.toMaybeString(this.toObject(volume.hostPath).path);
    }
    if (volumeType === 'projected') {
      const projected = this.toObject(volume.projected);
      const sourceNames = new Set<string>();
      for (const source of this.toArray(projected.sources)) {
        const sourceObj = this.toObject(source);
        const configMapName = this.toMaybeString(
          this.toObject(sourceObj.configMap).name,
        );
        const secretName = this.toMaybeString(this.toObject(sourceObj.secret).name);
        const serviceAccountTokenPath = this.toMaybeString(
          this.toObject(sourceObj.serviceAccountToken).path,
        );
        const downwardPath = sourceObj.downwardAPI !== undefined
          ? 'items'
          : undefined;
        if (configMapName) {
          sourceNames.add(`configMap:${configMapName}`);
        }
        if (secretName) {
          sourceNames.add(`secret:${secretName}`);
        }
        if (serviceAccountTokenPath) {
          sourceNames.add(`serviceAccountToken:${serviceAccountTokenPath}`);
        }
        if (downwardPath) {
          sourceNames.add(`downwardAPI:${downwardPath}`);
        }
      }
      return Array.from(sourceNames).join(', ') || undefined;
    }
    if (volumeType === 'csi') {
      return this.toMaybeString(this.toObject(volume.csi).driver);
    }
    if (volumeType === 'nfs') {
      const nfs = this.toObject(volume.nfs);
      return this.toMaybeString(nfs.path) ?? this.toMaybeString(nfs.server);
    }
    if (volumeType === 'awsElasticBlockStore') {
      return this.toMaybeString(
        this.toObject(volume.awsElasticBlockStore).volumeID,
      );
    }
    return undefined;
  }

  private extractPodSpec(
    kind: string,
    spec: Prisma.JsonValue | null,
  ): Record<string, unknown> {
    const specObj = this.toObject(spec);
    if (kind === 'Pod') {
      return specObj;
    }
    if (kind === 'CronJob') {
      const jobTemplate = this.toObject(specObj.jobTemplate);
      const jobSpec = this.toObject(jobTemplate.spec);
      const template = this.toObject(jobSpec.template);
      return this.toObject(template.spec);
    }
    const template = this.toObject(specObj.template);
    return this.toObject(template.spec);
  }

  private resolveKind(rawKind: string): KindMeta {
    const normalized = this.normalizeKindKey(rawKind);
    const meta = this.kindMap[normalized];
    if (!meta) {
      throw new BadRequestException(`不支持的资源类型：${rawKind}`);
    }
    return meta;
  }

  private normalizeKindKey(rawKind: string): string {
    const key = rawKind
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
    const aliasMap: Record<string, string> = {
      pods: 'pod',
      deployments: 'deployment',
      statefulsets: 'statefulset',
      daemonsets: 'daemonset',
      replicasets: 'replicaset',
      jobs: 'job',
      cronjobs: 'cronjob',
      services: 'service',
      ingresses: 'ingress',
      ingressroutes: 'ingressroute',
      gatewayclass: 'gatewayclass',
      gatewayclasses: 'gatewayclass',
      gateway: 'gateway',
      gateways: 'gateway',
      httproute: 'httproute',
      httproutes: 'httproute',
      networkpolicy: 'network-policy',
      configmaps: 'configmap',
      secrets: 'secret',
      serviceaccounts: 'serviceaccount',
      middlewares: 'middleware',
      persistentvolumeclaims: 'persistentvolumeclaim',
      pvcs: 'pvc',
      persistentvolumes: 'persistentvolume',
      pvs: 'pv',
      storageclasses: 'storageclass',
      scs: 'sc',
      namespaces: 'namespace',
      helmapplications: 'helmrelease',
      helmreleases: 'helmrelease',
      helmrepositories: 'helmrepository',
      horizontalpodautoscaler: 'horizontalpodautoscaler',
      horizontalpodautoscalers: 'horizontalpodautoscaler',
      vpa: 'verticalpodautoscaler',
      vpas: 'verticalpodautoscaler',
      verticalpodautoscaler: 'verticalpodautoscaler',
      verticalpodautoscalers: 'verticalpodautoscaler',
    };
    return aliasMap[key] ?? key;
  }

  private resolveAutoscalingState(resource: Record<string, any>): string {
    const annotations = this.toObject(resource?.metadata?.annotations);
    if (annotations['aiops.kubenova.io/disabled'] === 'true') {
      return 'disabled';
    }
    if (resource?.spec?.updatePolicy?.updateMode === 'Off') {
      return 'disabled';
    }
    return 'enabled';
  }

  private parseHelmReleaseDetailId(id: string): {
    clusterId: string;
    namespace: string;
    name: string;
  } {
    const parts = id
      .split('/')
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.length < 3) {
      throw new BadRequestException(
        'HelmRelease 详情 id 必须为 clusterId/namespace/name',
      );
    }
    const [clusterId, namespace, ...rest] = parts;
    const name = rest.join('/');
    if (!clusterId || !namespace || !name) {
      throw new BadRequestException(
        'HelmRelease 详情 id 必须为 clusterId/namespace/name',
      );
    }
    return { clusterId, namespace, name };
  }

  private parseHelmRepositoryDetailId(id: string): {
    clusterId: string;
    name: string;
  } {
    const parts = id
      .split('/')
      .map((item) => item.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      throw new BadRequestException(
        'HelmRepository 详情 id 必须为 clusterId/name',
      );
    }
    const [clusterId, ...rest] = parts;
    const name = rest.join('/');
    if (!clusterId || !name) {
      throw new BadRequestException(
        'HelmRepository 详情 id 必须为 clusterId/name',
      );
    }
    return { clusterId, name };
  }

  private makeHelmService(): HelmService {
    return new HelmService(this.clustersService, new HelmRepositoryStore());
  }

  private resolveNamespace(meta: KindMeta, namespace?: string): string {
    if (!meta.namespaced) {
      return '';
    }
    const ns = namespace?.trim();
    if (!ns) {
      throw new BadRequestException(`${meta.kind} 必须提供 namespace`);
    }
    return ns;
  }

  private async makeObjectClient(
    clusterId: string,
  ): Promise<k8s.KubernetesObjectApi> {
    await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException(
        '目标集群未配置 kubeconfig，无法执行资源操作',
      );
    }
    const kc = this.k8sClientService.createClient(kubeconfig);
    return k8s.KubernetesObjectApi.makeApiClient(kc);
  }

  private async listAllReadableClusterIds(): Promise<string[]> {
    const pageSize = 200;
    let page = 1;
    const clusterIds: string[] = [];

    while (true) {
      const clusters = await this.clustersService.list({
        state: 'active',
        page: String(page),
        pageSize: String(pageSize),
      });
      const readable = clusters.items
        .filter(
          (item) => item.state === 'active' && item.hasKubeconfig !== false,
        )
        .map((item) => item.id);
      clusterIds.push(...readable);

      if (clusters.items.length < pageSize) {
        break;
      }

      page += 1;
    }

    return [...new Set(clusterIds)];
  }

  private async discoverCapabilities(clusterId: string): Promise<
    Array<{
      group: string;
      version: string;
      kind: string;
      resource: string;
      namespaced: boolean;
      verbs: string[];
      lastDiscoveredAt: Date;
    }>
  > {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException(
        '目标集群未配置 kubeconfig，无法执行 discovery',
      );
    }
    const kc = this.k8sClientService.createClient(kubeconfig);
    const coreV1Api = kc.makeApiClient(k8s.CoreV1Api as never);
    const apisApi = kc.makeApiClient(k8s.ApisApi as never);
    const customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi as never);
    const lastDiscoveredAt = new Date();

    const capabilities: Array<{
      group: string;
      version: string;
      kind: string;
      resource: string;
      namespaced: boolean;
      verbs: string[];
      lastDiscoveredAt: Date;
    }> = [];

    const append = (
      group: string,
      version: string,
      resources: Array<{
        name?: string;
        kind?: string;
        namespaced?: boolean;
        verbs?: string[];
      }>,
    ) => {
      for (const resource of resources) {
        const resourceName = resource.name?.trim();
        if (!resourceName || resourceName.includes('/')) {
          continue;
        }
        const kind = resource.kind?.trim();
        if (!kind) {
          continue;
        }
        const verbs = Array.isArray(resource.verbs)
          ? Array.from(
              new Set(
                resource.verbs
                  .filter((verb): verb is string => typeof verb === 'string')
                  .map((verb) => verb.trim())
                  .filter(Boolean),
              ),
            )
          : [];
        if (!verbs.includes('list') || !verbs.includes('get')) {
          continue;
        }
        capabilities.push({
          group,
          version,
          kind,
          resource: resourceName,
          namespaced: Boolean(resource.namespaced),
          verbs,
          lastDiscoveredAt,
        });
      }
    };

    const coreList = await (coreV1Api as any).getAPIResources();
    append('', 'v1', coreList.resources ?? []);

    const apiGroupList = (await (apisApi as any).getAPIVersions()) as {
      groups?: Array<{
        name?: string;
        preferredVersion?: { version?: string };
        versions?: Array<{ version?: string }>;
      }>;
    };
    for (const group of apiGroupList.groups ?? []) {
      const groupName = group.name?.trim();
      if (!groupName) {
        continue;
      }
      const preferredVersion =
        group.preferredVersion?.version?.trim() ||
        group.versions?.[0]?.version?.trim();
      if (!preferredVersion) {
        continue;
      }
      try {
        const list = await (customObjectsApi as any).getAPIResources({
          group: groupName,
          version: preferredVersion,
        });
        append(groupName, preferredVersion, list.resources ?? []);
      } catch {
        // ignore single group discovery failure
      }
    }

    const dedup = new Map<string, (typeof capabilities)[number]>();
    for (const item of capabilities) {
      const key = `${item.group}/${item.version}/${item.resource}`;
      if (!dedup.has(key)) {
        dedup.set(key, item);
      }
    }
    return Array.from(dedup.values());
  }

  private parseStringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object') {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') {
          return message;
        }
        if (Array.isArray(message) && typeof message[0] === 'string') {
          return message[0];
        }
      }
    }
    return error instanceof Error ? error.message : '未知错误';
  }

  private requireCapabilityModel() {
    const model = (this.prisma as any).apiResourceCapability;
    if (!model) {
      throw new BadRequestException(
        'ApiResourceCapability 模型未就绪，请先执行 prisma generate',
      );
    }
    return model as {
      findFirst(args: unknown): Promise<any | null>;
      deleteMany(args: unknown): Promise<unknown>;
      createMany(args: unknown): Promise<unknown>;
    };
  }

  private async findDynamicCapability(input: {
    clusterId: string;
    group?: string;
    version?: string;
    resource?: string;
  }): Promise<{
    clusterId: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespaced: boolean;
  }> {
    const group = input.group?.trim() ?? '';
    const version = input.version?.trim();
    const resource = input.resource?.trim();
    if (!version || !resource) {
      throw new BadRequestException('version/resource 不能为空');
    }
    const model = this.requireCapabilityModel();
    const row = await model.findFirst({
      where: {
        clusterId: input.clusterId,
        group,
        version,
        resource,
      },
    });
    if (!row) {
      throw new NotFoundException(
        '未找到资源能力缓存，请先执行 discovery refresh',
      );
    }
    return {
      clusterId: row.clusterId,
      group: row.group,
      version: row.version,
      resource: row.resource,
      kind: row.kind,
      namespaced: row.namespaced,
    };
  }

  private async resolveDynamicIdentity(
    identity: DynamicResourceIdentity,
  ): Promise<{
    capability: {
      clusterId: string;
      group: string;
      version: string;
      resource: string;
      kind: string;
      namespaced: boolean;
    };
    clusterId: string;
    namespace: string;
    name: string;
  }> {
    const clusterId = identity.clusterId?.trim();
    const name = identity.name?.trim();
    if (!clusterId || !name) {
      throw new BadRequestException('clusterId/name 不能为空');
    }
    const capability = await this.findDynamicCapability({
      clusterId,
      group: identity.group,
      version: identity.version,
      resource: identity.resource,
    });
    const namespace = capability.namespaced ? identity.namespace?.trim() : '';
    if (capability.namespaced && !namespace) {
      throw new BadRequestException('该资源为 namespaced，namespace 不能为空');
    }
    return { capability, clusterId, namespace: namespace ?? '', name };
  }

  private toApiVersion(group: string, version: string): string {
    return group ? `${group}/${version}` : version;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private sanitizeForManifest(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(obj)) as Record<string, any>;
    if (clone.status) {
      delete clone.status;
    }
    if (clone.metadata && typeof clone.metadata === 'object') {
      delete clone.metadata.managedFields;
      delete clone.metadata.creationTimestamp;
      delete clone.metadata.uid;
      delete clone.metadata.generation;
      delete clone.metadata.selfLink;
    }
    return clone;
  }

  private extractResourceVersion(obj: unknown): string | undefined {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    const metadata = (obj as { metadata?: { resourceVersion?: unknown } })
      .metadata;
    return typeof metadata?.resourceVersion === 'string'
      ? metadata.resourceVersion
      : undefined;
  }

  private getWorkloadContainers(
    kind: string,
    obj: k8s.KubernetesObject,
  ): Array<{ name?: string; image?: string }> {
    const source = obj as Record<string, unknown>;
    const spec = (source.spec ?? {}) as Record<string, unknown>;
    if (kind === 'CronJob') {
      const jobTemplate = (spec.jobTemplate ?? {}) as Record<string, unknown>;
      const jobSpec = (jobTemplate.spec ?? {}) as Record<string, unknown>;
      const template = (jobSpec.template ?? {}) as Record<string, unknown>;
      const podSpec = (template.spec ?? {}) as Record<string, unknown>;
      const containers = podSpec.containers;
      return Array.isArray(containers)
        ? (containers as Array<{ name?: string; image?: string }>)
        : [];
    }

    const template = (spec.template ?? {}) as Record<string, unknown>;
    const podSpec = (template.spec ?? {}) as Record<string, unknown>;
    const containers = podSpec.containers;
    return Array.isArray(containers)
      ? (containers as Array<{ name?: string; image?: string }>)
      : [];
  }

  private buildImagePatch(
    meta: KindMeta,
    name: string,
    namespace: string,
    containerName: string,
    image: string,
  ): Record<string, unknown> {
    if (meta.kind === 'CronJob') {
      return {
        apiVersion: meta.apiVersion,
        kind: meta.kind,
        metadata: {
          name,
          ...(namespace ? { namespace } : {}),
        },
        spec: {
          jobTemplate: {
            spec: {
              template: {
                spec: {
                  containers: [{ name: containerName, image }],
                },
              },
            },
          },
        },
      };
    }

    return {
      apiVersion: meta.apiVersion,
      kind: meta.kind,
      metadata: {
        name,
        ...(namespace ? { namespace } : {}),
      },
      spec: {
        template: {
          spec: {
            containers: [{ name: containerName, image }],
          },
        },
      },
    };
  }

  private isWorkloadKind(kind: string): boolean {
    return (
      kind === 'Pod' ||
      kind === 'Deployment' ||
      kind === 'StatefulSet' ||
      kind === 'DaemonSet' ||
      kind === 'ReplicaSet' ||
      kind === 'Job' ||
      kind === 'CronJob'
    );
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private toMaybeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private toMaybeBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  private toMaybeNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return undefined;
    }
    return value;
  }

  private valueToString(value: unknown): string | undefined {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    return undefined;
  }

  private compactStringMap(
    input: Record<string, string | undefined>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.trim()) {
        result[key] = value;
      }
    }
    return result;
  }

  private normalizeDetailTimestamp(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  }

  private timestampToIso(value: unknown): string | undefined {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    return this.normalizeDetailTimestamp(this.toMaybeString(value));
  }

  private toStringArray(value: unknown): string[] {
    return this.toArray(value).filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  }

  private toStringMap(value: unknown): Record<string, string> {
    const obj = this.toObject(value);
    const result: Record<string, string> = {};
    for (const [key, inner] of Object.entries(obj)) {
      if (typeof inner === 'string') {
        result[key] = inner;
      }
    }
    return result;
  }

  private extractSelectorString(
    kind: string,
    spec: Record<string, unknown>,
  ): string | undefined {
    if (kind === 'Service') {
      return this.toSelectorString(spec.selector);
    }
    const selector = this.toObject(spec.selector);
    return (
      this.toSelectorString(selector.matchLabels) ??
      this.toSelectorString(selector)
    );
  }

  private summarizeContainers(
    podSpec: Record<string, unknown>,
    status: Record<string, unknown> = {},
  ): ResourceDetailRuntime['containerDetails'] {
    const fromSpec = [
      ...this.toArray(podSpec.initContainers),
      ...this.toArray(podSpec.containers),
    ]
      .map((item) => this.toObject(item))
      .map((container) => {
        const name = this.toMaybeString(container.name);
        if (!name) {
          return null;
        }
        const env = this.toArray(container.env)
          .map((envItem) => this.toObject(envItem))
          .map((envItem) => this.toMaybeString(envItem.name))
          .filter((item): item is string => Boolean(item));
        const envFrom = this.toArray(container.envFrom)
          .map((envFromItem) => this.toObject(envFromItem))
          .map((envFromItem) => {
            const configMap = this.toMaybeString(
              this.toObject(envFromItem.configMapRef).name,
            );
            const secret = this.toMaybeString(
              this.toObject(envFromItem.secretRef).name,
            );
            return configMap
              ? `ConfigMap/${configMap}`
              : secret
                ? `Secret/${secret}`
                : undefined;
          })
          .filter((item): item is string => Boolean(item));
        const ports = this.toArray(container.ports)
          .map((portItem) => this.toObject(portItem))
          .map((port) => ({
            name: this.toMaybeString(port.name),
            containerPort: this.toMaybeNumber(port.containerPort),
            protocol: this.toMaybeString(port.protocol),
          }))
          .filter((port) => typeof port.containerPort === 'number');
        const probes = [
          container.livenessProbe !== undefined ? 'liveness' : undefined,
          container.readinessProbe !== undefined ? 'readiness' : undefined,
          container.startupProbe !== undefined ? 'startup' : undefined,
        ].filter((item): item is string => Boolean(item));
        const resources = this.toObject(container.resources);
        const summary = {
          name,
          image: this.toMaybeString(container.image),
          ports,
          env: [...env, ...envFrom],
          probes,
          resources: {
            requests: this.toStringMap(resources.requests),
            limits: this.toStringMap(resources.limits),
          },
        };
        return summary;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (fromSpec.length > 0) {
      return fromSpec;
    }
    const names = this.toStringArray(status.containerNames);
    const images = this.toStringArray(status.containerImages);
    return names.map((name, index) => ({
      name,
      ...(images[index] ? { image: images[index] } : {}),
    }));
  }

  private summarizeTolerations(value: unknown): Array<Record<string, string>> {
    return this.toArray(value)
      .map((item) => this.toObject(item))
      .map((item) =>
        this.compactStringMap({
          key: this.toMaybeString(item.key),
          operator: this.toMaybeString(item.operator),
          value: this.toMaybeString(item.value),
          effect: this.toMaybeString(item.effect),
          tolerationSeconds: this.valueToString(item.tolerationSeconds),
        }),
      )
      .filter((item) => Object.keys(item).length > 0);
  }

  private buildNetworkPolicyRuntime(
    spec: Record<string, unknown>,
    status: Record<string, unknown>,
  ): Pick<
    ResourceDetailRuntime,
    'policyTypes' | 'podSelector' | 'ingressRules' | 'egressRules'
  > {
    const policyTypes = this.toStringArray(
      spec.policyTypes ?? status.policyTypes,
    );
    const ingressRules = this.toArray(spec.ingress ?? status.ingressRules).map(
      (rule) => this.summarizeNetworkPolicyRule(this.toObject(rule), 'ingress'),
    );
    const egressRules = this.toArray(spec.egress ?? status.egressRules).map(
      (rule) => this.summarizeNetworkPolicyRule(this.toObject(rule), 'egress'),
    );
    const podSelector =
      this.toSelectorString(this.toObject(this.toObject(spec.podSelector).matchLabels)) ??
      this.toMaybeString(status.podSelector);

    return {
      policyTypes,
      podSelector,
      ingressRules,
      egressRules,
    };
  }

  private summarizePvcDetail(
    detail?: DetailResourceRecord,
  ): Partial<ResourceDetailPvcSummary> {
    if (!detail) {
      return {};
    }
    const spec = this.toObject(detail.spec);
    const status = this.toObject(detail.statusJson);
    return {
      capacity: this.valueToString(this.toObject(status.capacity).storage),
      accessModes: this.toStringArray(status.accessModes ?? spec.accessModes),
      volumeMode: this.toMaybeString(spec.volumeMode),
    };
  }

  private summarizePvDetail(
    detail?: DetailResourceRecord,
  ): Partial<ResourceDetailPvSummary> {
    if (!detail) {
      return {};
    }
    const spec = this.toObject(detail.spec);
    const status = this.toObject(detail.statusJson);
    const claimRef = this.toObject(spec.claimRef);
    const claimRefText =
      this.toMaybeString(claimRef.name) &&
      `${this.toMaybeString(claimRef.namespace) ?? 'default'}/${this.toMaybeString(claimRef.name)}`;
    return {
      capacity: this.valueToString(this.toObject(spec.capacity).storage),
      accessModes: this.toStringArray(spec.accessModes),
      volumeMode: this.toMaybeString(spec.volumeMode),
      reclaimPolicy: this.toMaybeString(spec.persistentVolumeReclaimPolicy),
      claimRef: claimRefText || undefined,
      phase: this.toMaybeString(status.phase),
    };
  }

  private summarizeStorageClassDetail(
    detail: DetailResourceRecord,
  ): ResourceDetailStorageClassSummary {
    const spec = this.toObject(detail.spec);
    return {
      name: detail.name,
      provisioner: this.toMaybeString(spec.provisioner),
      reclaimPolicy: this.toMaybeString(spec.reclaimPolicy),
      bindingMode:
        this.toMaybeString(spec.volumeBindingMode) ??
        this.toMaybeString((detail as unknown as { bindingMode?: unknown }).bindingMode),
      allowVolumeExpansion: this.toMaybeBoolean(spec.allowVolumeExpansion),
      parameters: this.toStringMap(spec.parameters),
      mountOptions: this.toStringArray(spec.mountOptions),
    };
  }

  private summarizeNetworkPolicyRule(
    rule: Record<string, unknown>,
    direction: 'ingress' | 'egress',
  ): Record<string, unknown> {
    const peers = this.toArray(direction === 'ingress' ? rule.from : rule.to)
      .map((item) => this.toObject(item))
      .map((peer) => ({
        namespaceSelector: this.toSelectorString(
          this.toObject(this.toObject(peer.namespaceSelector).matchLabels),
        ),
        podSelector: this.toSelectorString(
          this.toObject(this.toObject(peer.podSelector).matchLabels),
        ),
        ipBlock: this.toMaybeString(this.toObject(peer.ipBlock).cidr),
      }));
    const ports = this.toArray(rule.ports)
      .map((item) => this.toObject(item))
      .map((port) => ({
        protocol: this.toMaybeString(port.protocol),
        port: this.valueToString(port.port),
      }));
    return {
      peers,
      ports,
    };
  }

  private toSelectorString(value: unknown): string | undefined {
    const map = this.toStringMap(value);
    const entries = Object.entries(map);
    if (entries.length === 0) {
      return undefined;
    }
    return entries.map(([key, val]) => `${key}=${val}`).join(', ');
  }
}
