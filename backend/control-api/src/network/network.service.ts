import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { Prisma } from '@prisma/client';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { ClusterEventSyncService } from '../clusters/cluster-event-sync.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import { appendAudit, type PlatformRole } from '../common/governance';
import {
  NetworkRepository,
  type NetworkCreateData,
  type NetworkListParams,
  type NetworkResourceKind,
  type NetworkResourceRecord,
  type NetworkUpdateData,
} from './network.repository';

export interface NetworkListQuery {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: string;
  pageSize?: string;
}

export interface NetworkListResult {
  items: NetworkResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
  timestamp: string;
}

export interface NetworkMutationResponse {
  item: NetworkResourceRecord;
  message: string;
  timestamp: string;
}

export interface CreateNetworkResourceRequest {
  clusterId: string;
  namespace: string;
  kind:
    | 'Service'
    | 'Endpoints'
    | 'EndpointSlice'
    | 'Ingress'
    | 'IngressRoute'
    | 'NetworkPolicy';
  name: string;
  spec?: Record<string, unknown>;
  labels?: Record<string, unknown>;
}

export interface UpdateNetworkResourceRequest {
  namespace?: string;
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
  labels?: Record<string, unknown>;
}

export interface NetworkActionRequest {
  action: 'enable' | 'disable' | 'delete';
  reason?: string;
}

@Injectable()
export class NetworkService {
  private static readonly LIVE_ID_PREFIX = 'live:';
  private readonly logger = new Logger(NetworkService.name);
  private readonly networkSyncAt = new Map<string, number>();
  private readonly supportedKinds: readonly NetworkResourceKind[] = [
    'Service',
    'Endpoints',
    'EndpointSlice',
    'Ingress',
    'IngressRoute',
    'NetworkPolicy',
  ];

  constructor(
    private readonly networkRepository: NetworkRepository,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterEventSyncService: ClusterEventSyncService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async list(
    query: NetworkListQuery,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<NetworkListResult> {
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
          pageSize: this.parsePositiveInt(query.pageSize, 20),
          timestamp: new Date().toISOString(),
        };
      }
    }

    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 20);
    const kind = query.kind?.trim();
    if (kind === 'Ingress' || kind === 'IngressRoute') {
      const liveItems = await this.listLiveIngressResources({
        clusterId: normalizedClusterId,
        clusterIds: readableClusterIds,
        namespace: query.namespace?.trim(),
        keyword: query.keyword?.trim(),
        kind,
      });
      const start = (page - 1) * pageSize;
      return {
        items: liveItems.slice(start, start + pageSize),
        total: liveItems.length,
        page,
        pageSize,
        timestamp: new Date().toISOString(),
      };
    }

    void this.refreshNetworkSyncState(normalizedClusterId, readableClusterIds);

    const params: NetworkListParams = {
      clusterId: normalizedClusterId,
      clusterIds: readableClusterIds,
      namespace: query.namespace,
      kind: query.kind,
      keyword: query.keyword,
      page,
      pageSize,
    };
    const result = await this.networkRepository.list(params);
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
  }

  private async refreshNetworkSyncState(
    normalizedClusterId: string | undefined,
    readableClusterIds: string[] | undefined,
  ): Promise<void> {
    if (normalizedClusterId) {
      void this.ensureClusterNetworkSynced(normalizedClusterId);
      return;
    }

    if (readableClusterIds?.length) {
      void Promise.allSettled(
        readableClusterIds.map((clusterId) =>
          this.ensureClusterNetworkSynced(clusterId),
        ),
      );
    }
  }

  private async ensureClusterNetworkSynced(clusterId: string): Promise<void> {
    const now = Date.now();
    const last = this.networkSyncAt.get(clusterId) ?? 0;
    const dirty = this.clusterEventSyncService.consumeClusterDirty(clusterId);
    if (!dirty && now - last < 2_000) {
      return;
    }

    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      return;
    }

    const result = await this.syncNetworkInventory(clusterId, kubeconfig);
    if (result.errors.length > 0) {
      this.logger.warn(
        `network sync failed for cluster ${clusterId}: ${result.errors.join(' | ')}`,
      );
    }
    this.networkSyncAt.set(clusterId, now);
  }

  private async syncNetworkInventory(
    clusterId: string,
    kubeconfig: string,
  ): Promise<{ errors: string[] }> {
    const syncResult = await this.clusterSyncService.syncCluster(
      clusterId,
      kubeconfig,
    );
    const networkErrors = syncResult.errors.filter(
      (item) =>
        item.includes('Service') ||
        item.includes('Endpoints') ||
        item.includes('EndpointSlice') ||
        item.includes('Ingress'),
    );
    return { errors: networkErrors };
  }

  async getById(id: string): Promise<NetworkResourceRecord> {
    const liveRef = this.parseLiveId(id);
    if (liveRef) {
      const item = await this.getLiveNetworkResourceByRef(liveRef);
      if (item) {
        return item;
      }
    }

    const item = await this.networkRepository.findById(id);
    if (!item) {
      throw new NotFoundException(`NetworkResource ${id} 不存在`);
    }
    return item;
  }

  async create(
    body: CreateNetworkResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<NetworkMutationResponse> {
    const clusterId = body.clusterId?.trim();
    const namespace = body.namespace?.trim();
    const name = body.name?.trim();

    if (!clusterId || !namespace || !name) {
      throw new BadRequestException('clusterId/namespace/name 是必填字段');
    }
    if (!this.isSupportedKind(body.kind)) {
      throw new BadRequestException(
        'kind 必须为 Service、Endpoints、EndpointSlice、Ingress、IngressRoute 或 NetworkPolicy',
      );
    }

    const existing = await this.networkRepository.list({
      clusterId,
      namespace,
      kind: body.kind,
      keyword: undefined,
      page: 1,
      pageSize: 1,
    });
    // 精确查名称重复
    const duplicate = existing.items.find((i) => i.name === name);
    if (duplicate) {
      throw new BadRequestException(`${body.kind} ${namespace}/${name} 已存在`);
    }

    const data: NetworkCreateData = {
      clusterId,
      namespace,
      kind: body.kind,
      name,
      state: 'active',
      spec: body.spec as Prisma.InputJsonValue,
      labels: body.labels as Prisma.InputJsonValue,
    };

    await this.createNetworkResourceInCluster(body);

    const item = await this.networkRepository.create(data);
    this.audit(actor, 'create', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 创建成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async update(
    id: string,
    body: UpdateNetworkResourceRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<NetworkMutationResponse> {
    const existing = await this.networkRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`NetworkResource ${id} 不存在`);
    }
    if (existing.state === 'deleted') {
      throw new BadRequestException('已删除的资源不可编辑');
    }

    const data: NetworkUpdateData = {};
    if (body.namespace !== undefined) {
      const ns = body.namespace.trim();
      if (!ns) throw new BadRequestException('namespace 不能为空');
      data.namespace = ns;
    }
    if (body.spec !== undefined) {
      data.spec = body.spec as Prisma.InputJsonValue;
    }
    if (body.statusJson !== undefined) {
      data.statusJson = body.statusJson as Prisma.InputJsonValue;
    }
    if (body.labels !== undefined) {
      data.labels = body.labels as Prisma.InputJsonValue;
    }

    const item = await this.networkRepository.update(id, data);
    this.audit(actor, 'update', item.id, 'success');

    return {
      item,
      message: `${item.kind} ${item.name} 更新成功`,
      timestamp: new Date().toISOString(),
    };
  }

  async applyAction(
    id: string,
    body: NetworkActionRequest,
    actor?: { username?: string; role?: PlatformRole },
  ): Promise<NetworkMutationResponse> {
    const existing = await this.networkRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`NetworkResource ${id} 不存在`);
    }

    const { action, reason } = body;

    if (action === 'delete') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('资源已删除');
      }
      await this.deleteNetworkResourceInCluster(existing);
      const item = await this.networkRepository.setState(id, 'deleted');
      this.audit(actor, 'delete', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已删除`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'disable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的资源不可禁用');
      }
      const item = await this.networkRepository.setState(id, 'disabled');
      this.audit(actor, 'disable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已禁用`,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === 'enable') {
      if (existing.state === 'deleted') {
        throw new BadRequestException('已删除的资源不可启用');
      }
      const item = await this.networkRepository.setState(id, 'active');
      this.audit(actor, 'enable', id, 'success', reason);
      return {
        item,
        message: `${item.kind} ${item.name} 已启用`,
        timestamp: new Date().toISOString(),
      };
    }

    throw new BadRequestException('action 必须为 enable/disable/delete');
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
  }

  private audit(
    actor: { username?: string; role?: PlatformRole } | undefined,
    action: 'create' | 'update' | 'delete' | 'disable' | 'enable',
    resourceId: string,
    result: 'success' | 'failure',
    reason?: string,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType: 'network-resource',
      resourceId,
      result,
      reason,
    });
  }

  private async getApis(clusterId: string): Promise<{
    coreApi: any;
    discoveryApi: any;
    networkingApi: any;
    customObjectsApi: any;
  }> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new BadRequestException('目标集群未配置 kubeconfig');
    }
    return {
      coreApi: this.k8sClientService.getCoreApi(kubeconfig) as any,
      discoveryApi: this.k8sClientService.getDiscoveryApi(kubeconfig) as any,
      networkingApi: this.k8sClientService.getNetworkingApi(kubeconfig) as any,
      customObjectsApi: this.k8sClientService.getCustomObjectsApi(
        kubeconfig,
      ) as any,
    };
  }

  private async createNetworkResourceInCluster(
    body: CreateNetworkResourceRequest,
  ): Promise<void> {
    const { coreApi, discoveryApi, networkingApi, customObjectsApi } =
      await this.getApis(body.clusterId);
    if (body.kind === 'Service') {
      const specInput = body.spec ?? {};
      await coreApi.createNamespacedService({
        namespace: body.namespace,
        body: {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: (body.labels as Record<string, string> | undefined) ?? {},
          },
          spec: {
            type: (specInput.type as string | undefined) ?? 'ClusterIP',
            selector:
              (specInput.selector as Record<string, string> | undefined) ?? {},
            ports: (specInput.ports as unknown[]) ?? [
              {
                name: 'http',
                protocol: 'TCP',
                port: 80,
                targetPort: 80,
              },
            ],
          },
        },
      });
      return;
    }

    if (body.kind === 'Endpoints') {
      const specInput = body.spec ?? {};
      await coreApi.createNamespacedEndpoints({
        namespace: body.namespace,
        body: {
          apiVersion: 'v1',
          kind: 'Endpoints',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: (body.labels as Record<string, string> | undefined) ?? {},
          },
          subsets: Array.isArray(specInput.subsets) ? specInput.subsets : [],
        },
      });
      return;
    }

    if (body.kind === 'EndpointSlice') {
      const specInput = body.spec ?? {};
      const serviceName =
        typeof specInput.serviceName === 'string' &&
        specInput.serviceName.trim().length > 0
          ? specInput.serviceName.trim()
          : undefined;
      await discoveryApi.createNamespacedEndpointSlice({
        namespace: body.namespace,
        body: {
          apiVersion: 'discovery.k8s.io/v1',
          kind: 'EndpointSlice',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: {
              ...((body.labels as Record<string, string> | undefined) ?? {}),
              ...(serviceName
                ? { 'kubernetes.io/service-name': serviceName }
                : {}),
            },
          },
          addressType:
            typeof specInput.addressType === 'string' &&
            specInput.addressType.trim().length > 0
              ? specInput.addressType.trim()
              : 'IPv4',
          endpoints: Array.isArray(specInput.endpoints)
            ? specInput.endpoints
            : [],
          ports: Array.isArray(specInput.ports) ? specInput.ports : [],
        },
      });
      return;
    }

    if (body.kind === 'Ingress') {
      const specInput = (body.spec as Record<string, any> | undefined) ?? {};
      const firstRule = specInput.rules?.[0] ?? {};
      const firstPath = firstRule.http?.paths?.[0] ?? {};
      const backendService = firstPath.backend?.service ?? {};
      await networkingApi.createNamespacedIngress({
        namespace: body.namespace,
        body: {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: (body.labels as Record<string, string> | undefined) ?? {},
          },
          spec: {
            rules: [
              {
                host: firstRule.host,
                http: {
                  paths: [
                    {
                      path: firstPath.path ?? '/',
                      pathType: firstPath.pathType ?? 'Prefix',
                      backend: {
                        service: {
                          name: backendService.name ?? 'kubernetes',
                          port: backendService.port ?? { number: 443 },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      return;
    }

    if (body.kind === 'IngressRoute') {
      const specInput = (body.spec as Record<string, any> | undefined) ?? {};
      const routes = Array.isArray(specInput.routes) ? specInput.routes : [];
      const firstRoute =
        (routes[0] as Record<string, any> | undefined) ??
        ({} as Record<string, any>);
      const services = Array.isArray(firstRoute.services)
        ? firstRoute.services
        : [];
      const firstService =
        (services[0] as Record<string, any> | undefined) ??
        ({} as Record<string, any>);
      const entryPoints = Array.isArray(specInput.entryPoints)
        ? specInput.entryPoints.filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
        : [];
      const middlewares = Array.isArray(firstRoute.middlewares)
        ? firstRoute.middlewares
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              name:
                typeof item.name === 'string' && item.name.trim().length > 0
                  ? item.name.trim()
                  : undefined,
            }))
            .filter((item) => item.name)
        : [];

      await customObjectsApi.createNamespacedCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace: body.namespace,
        plural: 'ingressroutes',
        body: {
          apiVersion: 'traefik.io/v1alpha1',
          kind: 'IngressRoute',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: (body.labels as Record<string, string> | undefined) ?? {},
          },
          spec: {
            entryPoints,
            routes: [
              {
                match: firstRoute.match ?? 'Host(`example.local`)',
                kind: firstRoute.kind ?? 'Rule',
                services: [
                  {
                    name: firstService.name ?? 'kubernetes',
                    port: firstService.port ?? 443,
                  },
                ],
                ...(middlewares.length > 0 ? { middlewares } : {}),
              },
            ],
            ...(specInput.tls &&
            typeof specInput.tls === 'object' &&
            !Array.isArray(specInput.tls)
              ? { tls: specInput.tls }
              : {}),
          },
        },
      });
      return;
    }

    if (body.kind === 'NetworkPolicy') {
      const specInput = body.spec ?? {};
      const podSelector =
        specInput.podSelector &&
        typeof specInput.podSelector === 'object' &&
        !Array.isArray(specInput.podSelector)
          ? specInput.podSelector
          : {};
      const policyTypes = Array.isArray(specInput.policyTypes)
        ? specInput.policyTypes.filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
        : ['Ingress'];
      const ingress = Array.isArray(specInput.ingress) ? specInput.ingress : [];
      const egress = Array.isArray(specInput.egress) ? specInput.egress : [];

      await networkingApi.createNamespacedNetworkPolicy({
        namespace: body.namespace,
        body: {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: {
            name: body.name,
            namespace: body.namespace,
            labels: (body.labels as Record<string, string> | undefined) ?? {},
          },
          spec: {
            podSelector,
            policyTypes,
            ...(ingress.length > 0 ? { ingress } : {}),
            ...(egress.length > 0 ? { egress } : {}),
          },
        },
      });
      return;
    }

    throw new BadRequestException(`暂不支持 kind=${body.kind}`);
  }

  private async deleteNetworkResourceInCluster(
    existing: NetworkResourceRecord,
  ): Promise<void> {
    const { coreApi, discoveryApi, networkingApi, customObjectsApi } =
      await this.getApis(existing.clusterId);
    if (existing.kind === 'Service') {
      await coreApi.deleteNamespacedService({
        name: existing.name,
        namespace: existing.namespace,
      });
      return;
    }
    if (existing.kind === 'Endpoints') {
      await coreApi.deleteNamespacedEndpoints({
        name: existing.name,
        namespace: existing.namespace,
      });
      return;
    }
    if (existing.kind === 'EndpointSlice') {
      await discoveryApi.deleteNamespacedEndpointSlice({
        name: existing.name,
        namespace: existing.namespace,
      });
      return;
    }
    if (existing.kind === 'Ingress') {
      await networkingApi.deleteNamespacedIngress({
        name: existing.name,
        namespace: existing.namespace,
      });
      return;
    }
    if (existing.kind === 'IngressRoute') {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: 'traefik.io',
        version: 'v1alpha1',
        namespace: existing.namespace,
        plural: 'ingressroutes',
        name: existing.name,
      });
      return;
    }
    if (existing.kind === 'NetworkPolicy') {
      await networkingApi.deleteNamespacedNetworkPolicy({
        name: existing.name,
        namespace: existing.namespace,
      });
    }
  }

  private isSupportedKind(kind: string): kind is NetworkResourceKind {
    return this.supportedKinds.includes(kind as NetworkResourceKind);
  }

  private makeLiveId(input: {
    clusterId: string;
    kind: 'Ingress' | 'IngressRoute' | 'NetworkPolicy';
    namespace: string;
    name: string;
  }): string {
    return `${NetworkService.LIVE_ID_PREFIX}${input.clusterId}:${input.kind}:${input.namespace}:${input.name}`;
  }

  private parseLiveId(id: string): {
    clusterId: string;
    kind: 'Ingress' | 'IngressRoute' | 'NetworkPolicy';
    namespace: string;
    name: string;
  } | null {
    if (!id.startsWith(NetworkService.LIVE_ID_PREFIX)) {
      return null;
    }
    const payload = id.slice(NetworkService.LIVE_ID_PREFIX.length);
    const [clusterId, kindRaw, namespace, ...rest] = payload.split(':');
    const name = rest.join(':');
    if (!clusterId || !namespace || !name) {
      return null;
    }
    if (
      kindRaw !== 'Ingress' &&
      kindRaw !== 'IngressRoute' &&
      kindRaw !== 'NetworkPolicy'
    ) {
      return null;
    }
    return { clusterId, kind: kindRaw, namespace, name };
  }

  private sortNetworkItems(
    items: NetworkResourceRecord[],
  ): NetworkResourceRecord[] {
    return items.sort((a, b) => {
      const byTime =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (byTime !== 0) return byTime;
      return a.id.localeCompare(b.id);
    });
  }

  private async listLiveIngressResources(input: {
    clusterId?: string;
    clusterIds?: string[];
    namespace?: string;
    keyword?: string;
    kind: 'Ingress' | 'IngressRoute' | 'NetworkPolicy';
  }): Promise<NetworkResourceRecord[]> {
    const targetClusterIds = input.clusterId
      ? [input.clusterId]
      : (input.clusterIds ?? []);
    if (targetClusterIds.length === 0) {
      return [];
    }

    const allItems = await Promise.all(
      targetClusterIds.map((clusterId) =>
        input.kind === 'Ingress'
          ? this.listLiveIngresses(clusterId, input.namespace)
          : input.kind === 'IngressRoute'
            ? this.listLiveIngressRoutes(clusterId, input.namespace)
            : this.listLiveNetworkPolicies(clusterId, input.namespace),
      ),
    );
    const merged = this.sortNetworkItems(allItems.flat());
    const keyword = input.keyword?.toLowerCase();
    if (!keyword) {
      return merged;
    }
    return merged.filter((item) => item.name.toLowerCase().includes(keyword));
  }

  private async listLiveIngresses(
    clusterId: string,
    namespace?: string,
  ): Promise<NetworkResourceRecord[]> {
    const { networkingApi } = await this.getApis(clusterId);
    const resp = namespace
      ? await networkingApi.listNamespacedIngress({ namespace })
      : await networkingApi.listIngressForAllNamespaces();

    return (resp.items ?? []).flatMap((item: k8s.V1Ingress) => {
      const name = item.metadata?.name?.trim();
      const ns = item.metadata?.namespace?.trim();
      if (!name || !ns) return [];
      const createdAt =
        item.metadata?.creationTimestamp?.toISOString() ??
        new Date().toISOString();
      return [
        {
          id: this.makeLiveId({
            clusterId,
            kind: 'Ingress',
            namespace: ns,
            name,
          }),
          clusterId,
          namespace: ns,
          kind: 'Ingress',
          name,
          state: 'active',
          spec: (item.spec ?? null) as Prisma.JsonValue | null,
          statusJson: ((item as unknown as { status?: unknown }).status ??
            null) as Prisma.JsonValue | null,
          labels: (item.metadata?.labels ?? null) as Prisma.JsonValue | null,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    });
  }

  private async listLiveIngressRoutes(
    clusterId: string,
    namespace?: string,
  ): Promise<NetworkResourceRecord[]> {
    const { customObjectsApi } = await this.getApis(clusterId);
    const response = namespace
      ? await customObjectsApi.listNamespacedCustomObject({
          group: 'traefik.io',
          version: 'v1alpha1',
          namespace,
          plural: 'ingressroutes',
        })
      : await customObjectsApi.listClusterCustomObject({
          group: 'traefik.io',
          version: 'v1alpha1',
          plural: 'ingressroutes',
        });
    const raw = (response as { body?: unknown }).body ?? response;
    const body =
      (raw as { items?: unknown[] }).items ??
      (raw as { body?: { items?: unknown[] } }).body?.items ??
      [];

    return body.flatMap((raw) => {
      const obj = raw as Record<string, any>;
      const metadata = (obj.metadata ?? {}) as Record<string, any>;
      const name =
        typeof metadata.name === 'string' ? metadata.name.trim() : '';
      const ns =
        typeof metadata.namespace === 'string' ? metadata.namespace.trim() : '';
      if (!name || !ns) return [];
      const createdAt =
        typeof metadata.creationTimestamp === 'string'
          ? metadata.creationTimestamp
          : new Date().toISOString();
      return [
        {
          id: this.makeLiveId({
            clusterId,
            kind: 'IngressRoute',
            namespace: ns,
            name,
          }),
          clusterId,
          namespace: ns,
          kind: 'IngressRoute',
          name,
          state: 'active',
          spec: ((obj.spec as Record<string, unknown> | undefined) ??
            null) as Prisma.JsonValue | null,
          statusJson: ((obj.status as Record<string, unknown> | undefined) ??
            null) as Prisma.JsonValue | null,
          labels: ((metadata.labels as Record<string, string> | undefined) ??
            null) as Prisma.JsonValue | null,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    });
  }

  private async listLiveNetworkPolicies(
    clusterId: string,
    namespace?: string,
  ): Promise<NetworkResourceRecord[]> {
    const { networkingApi } = await this.getApis(clusterId);
    const resp = namespace
      ? await networkingApi.listNamespacedNetworkPolicy({ namespace })
      : await networkingApi.listNetworkPolicyForAllNamespaces();

    return (resp.items ?? []).flatMap((item: k8s.V1NetworkPolicy) => {
      const name = item.metadata?.name?.trim();
      const ns = item.metadata?.namespace?.trim();
      if (!name || !ns) return [];
      const createdAt =
        item.metadata?.creationTimestamp?.toISOString() ??
        new Date().toISOString();
      const statusJson = ((item as unknown as { status?: unknown }).status ??
        null) as Prisma.JsonValue | null;
      return [
        {
          id: this.makeLiveId({
            clusterId,
            kind: 'NetworkPolicy',
            namespace: ns,
            name,
          }),
          clusterId,
          namespace: ns,
          kind: 'NetworkPolicy',
          name,
          state: 'active',
          spec: (item.spec ?? null) as Prisma.JsonValue | null,
          statusJson,
          labels: (item.metadata?.labels ?? null) as Prisma.JsonValue | null,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    });
  }

  private async getLiveNetworkResourceByRef(input: {
    clusterId: string;
    kind: 'Ingress' | 'IngressRoute' | 'NetworkPolicy';
    namespace: string;
    name: string;
  }): Promise<NetworkResourceRecord | null> {
    const items =
      input.kind === 'Ingress'
        ? await this.listLiveIngresses(input.clusterId, input.namespace)
        : input.kind === 'IngressRoute'
          ? await this.listLiveIngressRoutes(input.clusterId, input.namespace)
          : await this.listLiveNetworkPolicies(
              input.clusterId,
              input.namespace,
            );
    return items.find((item) => item.name === input.name) ?? null;
  }
}
