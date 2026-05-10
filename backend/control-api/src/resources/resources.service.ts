import {
  BadRequestException,
  Injectable,
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
  type ResourceDetailDescriptor,
  type ResourceDetailMetadata,
  type ResourceDetailNetworkEndpoint,
  type ResourceDetailNetworkSummary,
  type ResourceDetailOverview,
  type ResourceDetailPvSummary,
  type ResourceDetailPvcSummary,
  type ResourceDetailResponse,
  type ResourceDetailRuntime,
  type ResourceDetailSection,
  type ResourceDetailStorageSummary,
  type ResourceDetailVolumeSummary,
  type ResourceDetailMountSummary,
} from './resources-detail.contract';

type DetailSource =
  | 'workload'
  | 'network'
  | 'storage'
  | 'config'
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
  network: ['clusterIPs', 'podIPs', 'nodeNames', 'endpoints'],
  storage: [
    'storageClasses',
    'persistentVolumeClaims',
    'persistentVolumes',
    'volumes',
    'mounts',
  ],
  events: ['items'],
  metadata: ['labels', 'annotations', 'ownerReferences'],
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
  clusterId: string;
  group?: string;
  version?: string;
  resource?: string;
  namespace?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
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
    const clusterId = query.clusterId?.trim();
    if (!clusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    const capability = await this.findDynamicCapability({
      clusterId,
      group: query.group,
      version: query.version,
      resource: query.resource,
    });
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const keyword = query.keyword?.trim().toLowerCase();
    const namespace =
      capability.namespaced && query.namespace?.trim()
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
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      clusterId,
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

    const context = await this.loadDetailContext(
      base.clusterId,
      base.namespace,
    );
    const descriptor = this.buildDescriptor(base.kind);
    const overview = this.buildOverview(base);
    const runtime = this.buildRuntime(base);
    const associations = this.buildAssociations(base, context);
    const network = this.buildNetworkSummary(base, runtime, context);
    const storage = this.buildStorageSummary(base, context);
    const metadata = this.buildMetadata(base);

    return {
      descriptor,
      overview,
      runtime,
      associations,
      network,
      storage,
      events: {
        items: [],
      },
      metadata,
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
      },
      storage: {
        storageClasses: [],
        persistentVolumeClaims: [],
        persistentVolumes: [],
        volumes: [],
        mounts: [],
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
      },
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
      },
      storage: {
        storageClasses: [],
        persistentVolumeClaims: [],
        persistentVolumes: [],
        volumes: [],
        mounts: [],
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
      },
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
        const refs = this.extractWorkloadRefs(workload.kind, workload.spec);
        if (refs.pvcNames.includes(base.name)) {
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
          summary.endpoints.push({
            kind: 'ingress-rule',
            name: this.toMaybeString(serviceObj.name) ?? base.name,
            namespace: base.namespace ?? undefined,
            sourceKind: 'IngressRoute',
            sourceName: base.name,
            sourceId: this.toMaybeString(serviceObj.name)
              ? resolveNetworkTargetId(
                  'Service',
                  this.toMaybeString(serviceObj.name) ?? '',
                  base.namespace,
                )
              : undefined,
            host: entryPoints.join(', ') || undefined,
            path: this.toMaybeString(routeObj.match),
            ports: this.toMaybeNumber(serviceObj.port)
              ? [{ port: this.toMaybeNumber(serviceObj.port) ?? 0 }]
              : [],
          });
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
        }
      }
    }

    if (base.kind === 'EndpointSlice') {
      const spec = this.toObject(base.spec);
      const ports = this.toArray(spec.ports)
        .map((port) => this.toObject(port))
        .filter((port) => Object.keys(port).length > 0);
      const endpoints = this.toArray(spec.endpoints);
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
        }
      }
    }

    return summary;
  }

  private buildStorageSummary(
    base: DetailResourceRecord,
    context: DetailContext,
  ): ResourceDetailStorageSummary {
    const storageClasses = new Set<string>();
    const pvcMap = new Map<string, ResourceDetailPvcSummary>();
    const pvMap = new Map<string, ResourceDetailPvSummary>();
    const volumes: ResourceDetailVolumeSummary[] = [];
    const mounts: ResourceDetailMountSummary[] = [];

    const addPvc = (
      name: string,
      namespace: string | undefined,
      phase?: string,
      storageClass?: string,
      volumeName?: string,
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
      });
      if (storageClass) {
        storageClasses.add(storageClass);
      }
    };

    const addPv = (name: string, phase?: string, storageClass?: string) => {
      if (!name || pvMap.has(name)) {
        return;
      }
      pvMap.set(name, {
        name,
        ...(phase ? { phase } : {}),
        ...(storageClass ? { storageClass } : {}),
      });
      if (storageClass) {
        storageClasses.add(storageClass);
      }
    };

    if (this.isWorkloadKind(base.kind)) {
      const refs = this.extractWorkloadRefs(base.kind, base.spec);
      for (const volume of refs.volumes) {
        volumes.push(volume);
      }
      for (const mount of refs.mounts) {
        mounts.push(mount);
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
          );
        } else {
          addPvc(pvcName, base.namespace ?? undefined);
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
        );
      }
    }

    if (base.kind === 'PersistentVolume') {
      const status = this.toObject(base.statusJson);
      addPv(
        base.name,
        this.toMaybeString(status.phase),
        this.resolveStorageClass(base),
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
        );
      }
    }

    if (base.kind === 'StorageClass') {
      storageClasses.add(base.name);
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
          );
          continue;
        }
        if (storage.kind === 'PersistentVolume') {
          const status = this.toObject(storage.statusJson);
          addPv(storage.name, this.toMaybeString(status.phase), storageClass);
        }
      }
    }

    return {
      storageClasses: Array.from(storageClasses),
      persistentVolumeClaims: Array.from(pvcMap.values()),
      persistentVolumes: Array.from(pvMap.values()),
      volumes,
      mounts,
    };
  }

  private buildMetadata(base: DetailResourceRecord): ResourceDetailMetadata {
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

    return {
      labels: this.toStringMap(base.labels),
      annotations: this.toStringMap(base.annotations),
      ownerReferences,
    };
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
      | 'HTTPRoute';
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
      kindRaw !== 'Middleware'
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
      }

      const secretName = this.toMaybeString(secret.secretName);
      if (secretName) {
        type = 'secret';
        source = secretName;
        secretNames.add(secretName);
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
        }
        if (secretName) {
          secretNames.add(secretName);
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
        if (cmName) {
          configMapNames.add(cmName);
        }
        if (secretName) {
          secretNames.add(secretName);
        }
      }
    }

    return {
      pvcNames: Array.from(pvcNames),
      configMapNames: Array.from(configMapNames),
      secretNames: Array.from(secretNames),
      volumes: volumeSummaries,
      mounts: mountSummaries,
    };
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
}
