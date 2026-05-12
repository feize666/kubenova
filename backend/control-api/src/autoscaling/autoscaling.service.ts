import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { ClustersService } from '../clusters/clusters.service';
import { ClusterHealthService } from '../clusters/cluster-health.service';
import { K8sClientService } from '../clusters/k8s-client.service';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import type {
  AutoscalingListQuery,
  AutoscalingOverview,
  AutoscalingPolicyItem,
  AutoscalingType,
  CreateAutoscalingPolicyRequest,
  HpaPolicyConfig,
  PolicyState,
  UpdateAutoscalingPolicyRequest,
  VpaPolicyConfig,
} from './dto/autoscaling.dto';

interface Actor {
  username?: string;
  role?: PlatformRole;
}

interface Identity {
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
}

interface AutoscalingResourceSummary {
  id: string;
  type: AutoscalingType;
  state: PolicyState;
  clusterId: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  resourceName: string;
  workloadId: string;
  replicas: number | null;
  readyReplicas: number | null;
  config: HpaPolicyConfig | VpaPolicyConfig;
  createdAt: string;
  updatedAt: string;
  resourceVersion?: string;
}

type K8sObject = Record<string, any>;

const HPA_API_VERSION = 'autoscaling/v2';
const HPA_KIND = 'HorizontalPodAutoscaler';
const VPA_GROUP = 'autoscaling.k8s.io';
const VPA_VERSION = 'v1';
const VPA_KIND = 'VerticalPodAutoscaler';
const VPA_PLURAL = 'verticalpodautoscalers';

@Injectable()
export class AutoscalingService {
  private readonly logger = new Logger(AutoscalingService.name);

  constructor(
    private readonly clustersService: ClustersService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly k8sClientService: K8sClientService,
  ) {}

  async list(query: AutoscalingListQuery): Promise<{
    items: AutoscalingPolicyItem[];
    total: number;
    page: number;
    pageSize: number;
    overview: AutoscalingOverview;
  }> {
    try {
      const page = this.parsePositiveInt(query.page, 1);
      const pageSize = this.parsePositiveInt(query.pageSize, 20);
      const sortBy = query.sortBy?.trim();
      const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
      const clusterIds = await this.resolveClusterIds(query.clusterId);
      if (clusterIds.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
          overview: {
            totalPolicies: 0,
            enabledPolicies: 0,
            hpaPolicies: 0,
            vpaPolicies: 0,
            coveredWorkloads: 0,
            uncoveredWorkloads: 0,
          },
        };
      }

      const summaries = (
        await Promise.allSettled(
          clusterIds.map(async (clusterId) => {
            this.logger.debug(
              `autoscaling list start cluster=${clusterId} namespace=${query.namespace ?? '-'} type=${query.type ?? '-'} kind=${query.kind ?? '-'} keyword=${query.keyword ?? '-'}`,
            );
            const [hpas, vpas] = await this.withTimeout(
              Promise.all([
                this.listHpas(
                  clusterId,
                  query.namespace,
                  query.kind,
                  query.keyword,
                ),
                this.listVpas(
                  clusterId,
                  query.namespace,
                  query.kind,
                  query.keyword,
                ),
              ]),
              8000,
            );
            this.logger.debug(
              `autoscaling list cluster=${clusterId} hpas=${hpas.length} vpas=${vpas.length}`,
            );
            return [...hpas, ...vpas];
          }),
        )
      ).flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );

      const items = summaries
        .filter((item) => (query.type ? item.type === query.type : true))
        .filter((item) => (query.state ? item.state === query.state : true))
        .sort((a, b) => this.compareAutoscalingItems(a, b, sortBy, sortOrder));

      const overview: AutoscalingOverview = {
        totalPolicies: items.length,
        enabledPolicies: items.filter((item) => item.state === 'enabled')
          .length,
        hpaPolicies: items.filter((item) => item.type === 'HPA').length,
        vpaPolicies: items.filter((item) => item.type === 'VPA').length,
        coveredWorkloads: this.countCoveredWorkloads(items),
        uncoveredWorkloads: 0,
      };

      const total = items.length;
      const start = (page - 1) * pageSize;
      return {
        items: items.slice(start, start + pageSize),
        total,
        page,
        pageSize,
        overview,
      };
    } catch (error) {
      this.logger.error(
        `autoscaling list failed reason=${this.extractK8sErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async create(
    actor: Actor | undefined,
    body: CreateAutoscalingPolicyRequest,
  ): Promise<AutoscalingPolicyItem> {
    assertWritePermission(actor);
    const identity = this.normalizeIdentity(body);
    await this.clusterHealthService.assertClusterOnlineForRead(
      identity.clusterId,
    );
    await this.assertWorkloadExists(identity);

    if (this.normalizeType(body.type) === 'HPA') {
      const config = this.buildHpaConfig(body.hpa, body.enabled ?? true);
      const created = await this.createHpa(identity, config);
      this.audit(
        actor,
        'create',
        `${created.metadata.namespace}/${created.metadata.name}`,
        'HPA',
      );
      return this.attachClusterId(
        this.toPolicyItem(created, 'HPA'),
        identity.clusterId,
      );
    }

    const config = this.buildVpaConfig(body.vpa, body.enabled ?? true);
    const created = await this.createVpa(identity, config);
    this.audit(
      actor,
      'create',
      `${created.metadata.namespace}/${created.metadata.name}`,
      'VPA',
    );
    return this.attachClusterId(
      this.toPolicyItem(created, 'VPA'),
      identity.clusterId,
    );
  }

  async update(
    actor: Actor | undefined,
    type: AutoscalingType,
    kind: string,
    name: string,
    query: { clusterId?: string; namespace?: string },
    body: UpdateAutoscalingPolicyRequest,
  ): Promise<AutoscalingPolicyItem> {
    assertWritePermission(actor);
    const identity = await this.resolveResourceIdentity(query, kind, name);
    const normalizedType = this.normalizeType(type);
    await this.clusterHealthService.assertClusterOnlineForRead(
      identity.clusterId,
    );

    if (normalizedType === 'HPA') {
      const current = await this.readHpa(identity);
      if (!current) {
        throw new NotFoundException('HPA 策略不存在');
      }
      const workloadName =
        current.spec?.scaleTargetRef?.name ?? identity.name;
      const config = this.buildHpaConfig(
        {
          minReplicas:
            body.hpa?.minReplicas ??
            this.readNumber(current.spec.minReplicas, 1),
          maxReplicas:
            body.hpa?.maxReplicas ??
            this.readNumber(current.spec.maxReplicas, 1),
          targetCpuUtilizationPercentage:
            body.hpa?.targetCpuUtilizationPercentage ??
            this.readTargetCpu(current.spec.metrics),
          targetMemoryUtilizationPercentage:
            body.hpa?.targetMemoryUtilizationPercentage ??
            this.readTargetMemory(current.spec.metrics),
          metrics:
            body.hpa?.metrics ?? this.readHpaMetrics(current.spec.metrics),
          behavior:
            body.hpa?.behavior ?? this.readHpaBehavior(current.spec.behavior),
        },
        body.enabled ?? this.isHpaEnabled(current),
      );
      const updated = await this.updateHpa(
        identity,
        config,
        current.metadata.resourceVersion,
        workloadName,
      );
      this.audit(
        actor,
        'update',
        `${updated.metadata.namespace}/${updated.metadata.name}`,
        'HPA',
      );
      return this.attachClusterId(
        this.toPolicyItem(updated, 'HPA'),
        identity.clusterId,
      );
    }

    const current = await this.readVpa(identity);
    if (!current) {
      throw new NotFoundException('VPA 策略不存在');
    }
    const workloadName =
      current.spec?.targetRef?.name ?? identity.name;
    const config = this.buildVpaConfig(
      {
        updateMode:
          body.vpa?.updateMode ??
          this.readVpaUpdateMode(current.spec.updatePolicy?.updateMode),
        minAllowedCpu:
          body.vpa?.minAllowedCpu ??
          this.readVpaResourceLimit(current.spec.resourcePolicy, 'cpu', 'min'),
        maxAllowedCpu:
          body.vpa?.maxAllowedCpu ??
          this.readVpaResourceLimit(current.spec.resourcePolicy, 'cpu', 'max'),
        minAllowedMemory:
          body.vpa?.minAllowedMemory ??
          this.readVpaResourceLimit(
            current.spec.resourcePolicy,
            'memory',
            'min',
          ),
        maxAllowedMemory:
          body.vpa?.maxAllowedMemory ??
          this.readVpaResourceLimit(
            current.spec.resourcePolicy,
            'memory',
            'max',
          ),
        controlledResources:
          body.vpa?.controlledResources ??
          this.readVpaControlledResources(current.spec.resourcePolicy),
      },
      body.enabled ?? this.isVpaEnabled(current),
    );
    const updated = await this.updateVpa(
      identity,
      config,
      current.metadata.resourceVersion,
      workloadName,
    );
    this.audit(
      actor,
      'update',
      `${updated.metadata.namespace}/${updated.metadata.name}`,
      'VPA',
    );
    return this.attachClusterId(
      this.toPolicyItem(updated, 'VPA'),
      identity.clusterId,
    );
  }

  async setPolicyState(
    actor: Actor | undefined,
    type: AutoscalingType,
    kind: string,
    name: string,
    query: { clusterId?: string; namespace?: string },
    enabled: boolean,
  ): Promise<AutoscalingPolicyItem> {
    const normalizedType = this.normalizeType(type);
    if (normalizedType === 'HPA') {
      throw new BadRequestException(
        'HPA 不支持启用/停用，请直接编辑或删除策略',
      );
    }
    const current = await this.update(
      actor,
      normalizedType,
      kind,
      name,
      query,
      { enabled, vpa: { updateMode: enabled ? 'Auto' : 'Off' } },
    );
    return current;
  }

  async delete(
    actor: Actor | undefined,
    type: AutoscalingType,
    kind: string,
    name: string,
    query: { clusterId?: string; namespace?: string },
  ): Promise<{
    message: string;
    type: AutoscalingType;
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    timestamp: string;
  }> {
    assertWritePermission(actor);
    const identity = await this.resolveResourceIdentity(query, kind, name);
    const normalizedType = this.normalizeType(type);
    await this.clusterHealthService.assertClusterOnlineForRead(
      identity.clusterId,
    );

    if (normalizedType === 'HPA') {
      const current = await this.readHpa(identity);
      if (!current) {
        throw new NotFoundException('HPA 策略不存在');
      }
      await this.deleteHpa(identity, current.metadata.resourceVersion);
    } else {
      const current = await this.readVpa(identity);
      if (!current) {
        throw new NotFoundException('VPA 策略不存在');
      }
      await this.deleteVpa(identity, current.metadata.resourceVersion);
    }

    this.audit(
      actor,
      'delete',
      `${identity.namespace}/${identity.name}`,
      normalizedType,
    );
    return {
      message: `${normalizedType} 策略删除成功`,
      type: normalizedType,
      clusterId: identity.clusterId,
      namespace: identity.namespace,
      kind,
      name,
      timestamp: new Date().toISOString(),
    };
  }

  async listEvents(query: {
    clusterId?: string;
    namespace?: string;
    kind?: string;
    name?: string;
    hours?: string;
  }): Promise<{
    clusterId: string;
    namespace: string;
    hours: number;
    items: Array<{
      type: string;
      reason: string;
      message: string;
      kind: string;
      name: string;
      namespace: string;
      timestamp: string;
    }>;
    total: number;
    timestamp: string;
  }> {
    const clusterId = query.clusterId?.trim();
    const namespace = query.namespace?.trim();
    const kind = query.kind?.trim();
    const name = query.name?.trim();
    const hours = Math.max(1, Number(query.hours ?? 24) || 24);
    if (!clusterId || !namespace || !kind || !name) {
      throw new BadRequestException(
        'clusterId、namespace、kind、name 不能为空',
      );
    }
    await this.clusterHealthService.assertClusterOnlineForRead(clusterId);
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException('集群 kubeconfig 不可用');
    }
    const coreApi = this.k8sClientService.getCoreApi(kubeconfig);
    const resourceName =
      kind === HPA_KIND
        ? this.resolveAutoscalingResourceName(name, '-hpa')
        : kind === VPA_KIND
          ? this.resolveAutoscalingResourceName(name, '-vpa')
          : name.trim();
    const fieldSelector = `involvedObject.name=${resourceName},involvedObject.namespace=${namespace}`;
    const resp = await coreApi.listNamespacedEvent({
      namespace,
      fieldSelector,
    });
    const threshold = Date.now() - hours * 3600 * 1000;
    const items = (resp.items ?? [])
      .map((event) => ({
        type: event.type ?? 'Normal',
        reason: event.reason ?? '-',
        message: event.message ?? '-',
        kind: event.involvedObject?.kind ?? kind,
        name: event.involvedObject?.name ?? resourceName,
        namespace: event.involvedObject?.namespace ?? namespace,
        timestamp:
          event.lastTimestamp?.toISOString?.() ??
          event.eventTime?.toISOString?.() ??
          event.firstTimestamp?.toISOString?.() ??
          event.metadata?.creationTimestamp?.toString?.() ??
          new Date().toISOString(),
      }))
      .filter((item) => new Date(item.timestamp).getTime() >= threshold)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      clusterId,
      namespace,
      hours,
      items,
      total: items.length,
      timestamp: new Date().toISOString(),
    };
  }

  private async resolveClusterIds(clusterId?: string): Promise<string[]> {
    if (clusterId?.trim()) {
      return [clusterId.trim()];
    }
    const readableClusterIds =
      await this.clusterHealthService.listReadableClusterIdsForResourceRead();
    const pagedClusterIds = await this.listAllReadableClusterIds();
    return [...new Set([...readableClusterIds, ...pagedClusterIds])];
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

  private async resolveResourceIdentity(
    query: { clusterId?: string; namespace?: string },
    kind: string,
    name: string,
  ): Promise<Identity> {
    const clusterId = query.clusterId?.trim();
    const namespace = query.namespace?.trim();
    if (!clusterId || !namespace) {
      throw new BadRequestException('clusterId 和 namespace 不能为空');
    }
    return { clusterId, namespace, kind, name };
  }

  private normalizeIdentity(body: CreateAutoscalingPolicyRequest): Identity {
    const clusterId = body.clusterId?.trim();
    const namespace = body.namespace?.trim();
    const kind = body.kind?.trim();
    const name = body.name?.trim();
    if (!clusterId || !namespace || !kind || !name) {
      throw new BadRequestException(
        'clusterId、namespace、kind、name 不能为空',
      );
    }
    return { clusterId, namespace, kind, name };
  }

  private normalizeType(type: AutoscalingType): AutoscalingType {
    if (type !== 'HPA' && type !== 'VPA') {
      throw new BadRequestException('type 必须是 HPA 或 VPA');
    }
    return type;
  }

  private async getKubeconfig(clusterId: string): Promise<string> {
    const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
    if (!kubeconfig) {
      throw new NotFoundException('集群 kubeconfig 不可用');
    }
    return kubeconfig;
  }

  private async createHpa(
    identity: Identity,
    config: Record<string, unknown>,
  ): Promise<K8sObject> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.AutoscalingV2Api);
    const resourceName = this.resolveAutoscalingResourceName(
      identity.name,
      '-hpa',
    );
    const body: K8sObject = {
      apiVersion: HPA_API_VERSION,
      kind: HPA_KIND,
      metadata: { name: resourceName, namespace: identity.namespace },
      spec: this.toHpaSpec(identity, config),
    };
    try {
      const resp = await api.createNamespacedHorizontalPodAutoscaler({
        namespace: identity.namespace,
        body: body as any,
      });
      return resp as K8sObject;
    } catch (error) {
      if (this.getErrorStatusCode(error) === 404) {
        throw new BadRequestException(
          'HPA 创建失败: 当前集群未安装 autoscaling/v2 HorizontalPodAutoscaler API',
        );
      }
      this.throwConflictIfAlreadyExists(
        error,
        'HPA',
        identity.namespace,
        identity.name,
      );
      throw new BadRequestException(
        `HPA 创建失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async updateHpa(
    identity: Identity,
    config: Record<string, unknown>,
    resourceVersion?: string,
    workloadName?: string,
  ): Promise<K8sObject> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.AutoscalingV2Api);
    const body: K8sObject = {
      apiVersion: HPA_API_VERSION,
      kind: HPA_KIND,
      metadata: {
        name: identity.name.endsWith('-hpa')
          ? identity.name
          : this.resolveAutoscalingResourceName(identity.name, '-hpa'),
        namespace: identity.namespace,
        resourceVersion,
      },
      spec: this.toHpaSpec(identity, config, workloadName),
    };
    try {
      const resp = await api.replaceNamespacedHorizontalPodAutoscaler({
        name: body.metadata.name,
        namespace: identity.namespace,
        body: body as any,
      });
      return resp as K8sObject;
    } catch (error) {
      if (this.isMissingAutoscalingResourceError(error)) {
        throw new BadRequestException(
          `HPA 更新失败: horizontalpodautoscalers.autoscaling "${body.metadata.name}" not found`,
        );
      }
      throw new BadRequestException(
        `HPA 更新失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async deleteHpa(
    identity: Identity,
    resourceVersion?: string,
  ): Promise<void> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.AutoscalingV2Api);
    try {
      await api.deleteNamespacedHorizontalPodAutoscaler({
        name: identity.name,
        namespace: identity.namespace,
        body: {
          apiVersion: 'v1',
          kind: 'DeleteOptions',
          ...(resourceVersion ? { preconditions: { resourceVersion } } : {}),
        } as any,
      });
    } catch (error) {
      throw new BadRequestException(
        `HPA 删除失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async readHpa(identity: Identity): Promise<K8sObject | null> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.AutoscalingV2Api);
    try {
      const resp = await api.readNamespacedHorizontalPodAutoscaler({
        name: identity.name,
        namespace: identity.namespace,
      });
      return resp as K8sObject;
    } catch (error) {
      if (
        (error as { response?: { statusCode?: number } }).response
          ?.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  private async createVpa(
    identity: Identity,
    config: Record<string, unknown>,
  ): Promise<K8sObject> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService.getCustomObjectsApi(kubeconfig);
    const body = this.toVpaObject(
      identity,
      config,
      undefined,
      this.resolveAutoscalingResourceName(identity.name, '-vpa'),
    );
    try {
      const resp = await api.createNamespacedCustomObject({
        group: VPA_GROUP,
        version: VPA_VERSION,
        namespace: identity.namespace,
        plural: VPA_PLURAL,
        body: body as any,
      });
      return resp as K8sObject;
    } catch (error) {
      if (this.getErrorStatusCode(error) === 404) {
        throw new BadRequestException(
          'VPA 创建失败: 当前集群未安装 autoscaling.k8s.io/v1 VerticalPodAutoscaler CRD',
        );
      }
      this.throwConflictIfAlreadyExists(
        error,
        'VPA',
        identity.namespace,
        identity.name,
      );
      throw new BadRequestException(
        `VPA 创建失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private throwConflictIfAlreadyExists(
    error: unknown,
    type: AutoscalingType,
    namespace: string,
    name: string,
  ): never | void {
    if (this.isAlreadyExistsError(error)) {
      throw new ConflictException(`${type} 策略已存在: ${namespace}/${name}`);
    }
  }

  private async updateVpa(
    identity: Identity,
    config: Record<string, unknown>,
    resourceVersion?: string,
    workloadName?: string,
  ): Promise<K8sObject> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService.getCustomObjectsApi(kubeconfig);
    const body = this.toVpaObject(
      identity,
      config,
      resourceVersion,
      workloadName,
    );
    try {
      const resp = await api.replaceNamespacedCustomObject({
        group: VPA_GROUP,
        version: VPA_VERSION,
        namespace: identity.namespace,
      plural: VPA_PLURAL,
        name: body.metadata.name,
        body: body as any,
      });
      return resp as K8sObject;
    } catch (error) {
      if (this.isMissingAutoscalingResourceError(error)) {
        throw new BadRequestException(
          `VPA 更新失败: verticalpodautoscalers.autoscaling.k8s.io "${body.metadata.name}" not found`,
        );
      }
      throw new BadRequestException(
        `VPA 更新失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async deleteVpa(
    identity: Identity,
    resourceVersion?: string,
  ): Promise<void> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService.getCustomObjectsApi(kubeconfig);
    try {
      await api.deleteNamespacedCustomObject({
        group: VPA_GROUP,
        version: VPA_VERSION,
        namespace: identity.namespace,
        plural: VPA_PLURAL,
        name: identity.name,
        body: {
          apiVersion: 'v1',
          kind: 'DeleteOptions',
          ...(resourceVersion ? { preconditions: { resourceVersion } } : {}),
        } as any,
      });
    } catch (error) {
      if (this.getErrorStatusCode(error) === 404) {
        throw new BadRequestException(
          'VPA 删除失败: 当前集群未安装 autoscaling.k8s.io/v1 VerticalPodAutoscaler CRD',
        );
      }
      throw new BadRequestException(
        `VPA 删除失败: ${this.extractK8sErrorMessage(error)}`,
      );
    }
  }

  private async readVpa(identity: Identity): Promise<K8sObject | null> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const api = this.k8sClientService.getCustomObjectsApi(kubeconfig);
    try {
      const resp = await api.getNamespacedCustomObject({
        group: VPA_GROUP,
        version: VPA_VERSION,
        namespace: identity.namespace,
        plural: VPA_PLURAL,
        name: identity.name,
      });
      return resp as K8sObject;
    } catch (error) {
      if (
        (error as { response?: { statusCode?: number } }).response
          ?.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  private toPolicyItem(
    resource: K8sObject,
    type: AutoscalingType,
  ): AutoscalingPolicyItem {
    if (type === 'HPA') {
      return this.hpaToPolicy(resource);
    }
    return this.vpaToPolicy(resource);
  }

  private hpaToPolicy(resource: K8sObject): AutoscalingPolicyItem {
    const spec = resource.spec ?? {};
    const metadata = resource.metadata ?? {};
    const status = resource.status ?? {};
    const workloadName = spec.scaleTargetRef?.name ?? '';
    const workloadKind = spec.scaleTargetRef?.kind ?? '';
    const resourceName = metadata.name ?? '';
    return {
      id: `${metadata.uid ?? metadata.namespace}/${metadata.name}`,
      type: 'HPA',
      state: this.isHpaEnabled(resource) ? 'enabled' : 'disabled',
      clusterId: '',
      namespace: metadata.namespace ?? '',
      workloadKind,
      workloadName,
      resourceName,
      workloadId: `${metadata.namespace}/${workloadKind}/${workloadName}`,
      replicas:
        typeof status.currentReplicas === 'number'
          ? status.currentReplicas
          : null,
      readyReplicas:
        typeof status.desiredReplicas === 'number'
          ? status.desiredReplicas
          : null,
      config: {
        minReplicas: this.readNumber(spec.minReplicas, 1),
        maxReplicas: this.readNumber(spec.maxReplicas, 1),
        targetCpuUtilizationPercentage: this.readTargetCpu(spec.metrics),
        targetMemoryUtilizationPercentage: this.readTargetMemory(spec.metrics),
        metrics: this.readHpaMetrics(spec.metrics),
        behavior: this.readHpaBehavior(spec.behavior),
      },
      createdAt: this.normalizeTimestamp(metadata.creationTimestamp),
      updatedAt: this.normalizeTimestamp(metadata.creationTimestamp),
    };
  }

  private vpaToPolicy(resource: K8sObject): AutoscalingPolicyItem {
    const spec = resource.spec ?? {};
    const metadata = resource.metadata ?? {};
    const workloadName = spec.targetRef?.name ?? '';
    const workloadKind = spec.targetRef?.kind ?? '';
    const resourceName = metadata.name ?? '';
    return {
      id: `${metadata.uid ?? metadata.namespace}/${metadata.name}`,
      type: 'VPA',
      state: this.isVpaEnabled(resource) ? 'enabled' : 'disabled',
      clusterId: '',
      namespace: metadata.namespace ?? '',
      workloadKind,
      workloadName,
      resourceName,
      workloadId: `${metadata.namespace}/${workloadKind}/${workloadName}`,
      replicas: null,
      readyReplicas: null,
      config: {
        updateMode: this.readVpaUpdateMode(spec.updatePolicy?.updateMode),
        minAllowedCpu: this.readVpaResourceLimit(
          spec.resourcePolicy,
          'cpu',
          'min',
        ),
        maxAllowedCpu: this.readVpaResourceLimit(
          spec.resourcePolicy,
          'cpu',
          'max',
        ),
        minAllowedMemory: this.readVpaResourceLimit(
          spec.resourcePolicy,
          'memory',
          'min',
        ),
        maxAllowedMemory: this.readVpaResourceLimit(
          spec.resourcePolicy,
          'memory',
          'max',
        ),
        controlledResources: this.readVpaControlledResources(
          spec.resourcePolicy,
        ),
      },
      createdAt: this.normalizeTimestamp(metadata.creationTimestamp),
      updatedAt: this.normalizeTimestamp(metadata.creationTimestamp),
    };
  }

  private toHpaSpec(
    identity: Identity,
    config: Record<string, unknown>,
    workloadName?: string,
  ): K8sObject {
    const metrics = this.buildHpaMetricsFromConfig(config);
    return {
      scaleTargetRef: {
        apiVersion: this.resolveWorkloadApiVersion(identity.kind),
        kind: identity.kind,
        name: workloadName ?? identity.name,
      },
      minReplicas: this.readNumber(config.minReplicas, 1),
      maxReplicas: this.readNumber(config.maxReplicas, 1),
      ...(metrics.length > 0 ? { metrics } : {}),
      ...(config.behavior ? { behavior: config.behavior } : {}),
    };
  }

  private toVpaObject(
    identity: Identity,
    config: Record<string, unknown>,
    resourceVersion?: string,
    workloadName?: string,
  ): K8sObject {
    const controlledResources = Array.isArray(config.controlledResources)
      ? config.controlledResources
      : ['cpu', 'memory'];
    const resourceName = identity.name.endsWith('-vpa')
      ? identity.name
      : this.resolveAutoscalingResourceName(identity.name, '-vpa');
    return {
      apiVersion: `${VPA_GROUP}/${VPA_VERSION}`,
      kind: VPA_KIND,
      metadata: {
        name: resourceName,
        namespace: identity.namespace,
        ...(resourceVersion ? { resourceVersion } : {}),
      },
      spec: {
        targetRef: {
          apiVersion: this.resolveWorkloadApiVersion(identity.kind),
          kind: identity.kind,
          name: workloadName ?? identity.name,
        },
        updatePolicy: {
          updateMode: this.readVpaUpdateMode(config.updateMode),
        },
        resourcePolicy: {
          containerPolicies: [
            {
              containerName: '*',
              controlledResources,
              minAllowed: this.buildResourceBound(config, 'min'),
              maxAllowed: this.buildResourceBound(config, 'max'),
            },
          ],
        },
      },
    };
  }

  private buildResourceBound(
    config: Record<string, unknown>,
    bound: 'min' | 'max',
  ): Record<string, string> | undefined {
    const cpu = bound === 'min' ? config.minAllowedCpu : config.maxAllowedCpu;
    const memory =
      bound === 'min' ? config.minAllowedMemory : config.maxAllowedMemory;
    const result: Record<string, string> = {};
    if (typeof cpu === 'string' && cpu.trim()) result.cpu = cpu.trim();
    if (typeof memory === 'string' && memory.trim())
      result.memory = memory.trim();
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private buildHpaConfig(
    input: Partial<HpaPolicyConfig> | undefined,
    enabled: boolean,
  ): Record<string, unknown> {
    if (input?.minReplicas === undefined || input.maxReplicas === undefined) {
      throw new BadRequestException('HPA 需要 minReplicas 与 maxReplicas');
    }
    const minReplicas = Number(input.minReplicas);
    const maxReplicas = Number(input.maxReplicas);
    if (
      !Number.isInteger(minReplicas) ||
      !Number.isInteger(maxReplicas) ||
      minReplicas < 1 ||
      maxReplicas < minReplicas
    ) {
      throw new BadRequestException(
        'HPA 参数非法：要求 minReplicas>=1 且 maxReplicas>=minReplicas',
      );
    }
    const config: Record<string, unknown> = {
      minReplicas,
      maxReplicas,
      enabled,
    };
    if (input.targetCpuUtilizationPercentage !== undefined) {
      config.targetCpuUtilizationPercentage = this.normalizePercent(
        input.targetCpuUtilizationPercentage,
        'targetCpuUtilizationPercentage',
      );
    }
    if (input.targetMemoryUtilizationPercentage !== undefined) {
      config.targetMemoryUtilizationPercentage = this.normalizePercent(
        input.targetMemoryUtilizationPercentage,
        'targetMemoryUtilizationPercentage',
      );
    }
    if (input.metrics) config.metrics = this.normalizeHpaMetrics(input.metrics);
    if (input.behavior) config.behavior = input.behavior;
    return config;
  }

  private buildVpaConfig(
    input: Partial<VpaPolicyConfig> | undefined,
    enabled: boolean,
  ): Record<string, unknown> {
    if (
      !input?.updateMode ||
      !['Off', 'Initial', 'Auto'].includes(input.updateMode)
    ) {
      throw new BadRequestException(
        'VPA 需要 updateMode，取值 Off|Initial|Auto',
      );
    }
    return {
      enabled,
      updateMode: input.updateMode,
      minAllowedCpu: input.minAllowedCpu,
      maxAllowedCpu: input.maxAllowedCpu,
      minAllowedMemory: input.minAllowedMemory,
      maxAllowedMemory: input.maxAllowedMemory,
      controlledResources: Array.isArray(input.controlledResources)
        ? input.controlledResources
        : undefined,
    };
  }

  private normalizePercent(value: number, field: string): number {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) {
      throw new BadRequestException(`${field} 需为 1-100 的整数`);
    }
    return normalized;
  }

  private readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private readHpaMetrics(metrics: unknown): HpaPolicyConfig['metrics'] {
    if (!Array.isArray(metrics)) return undefined;
    return metrics as HpaPolicyConfig['metrics'];
  }

  private normalizeHpaMetrics(metrics: HpaPolicyConfig['metrics']): K8sObject[] {
    if (!Array.isArray(metrics)) {
      return [];
    }

    return metrics.flatMap((metric): K8sObject[] => {
      if (!metric || typeof metric !== 'object') {
        return [];
      }

      const sourceType = metric.sourceType;
      const targetType = metric.targetType;
      const targetValue = metric.targetValue;
      if (!sourceType || !targetType || !targetValue) {
        return [];
      }

      if (sourceType === 'Resource') {
        const name = metric.name;
        if (!name) return [];
        return [
          {
            type: 'Resource',
            resource: {
              name,
              target: {
                type: targetType,
                averageUtilization:
                  targetType === 'Utilization' ? Number(targetValue) : undefined,
                averageValue:
                  targetType === 'AverageValue' ? targetValue : undefined,
                value: targetType === 'Value' ? targetValue : undefined,
              },
            },
          },
        ];
      }

      const metricName = metric.metricName;
      if (!metricName) return [];
      const selector = metric.selector;
      return [
        {
          type: sourceType,
          [sourceType === 'Pods' ? 'pods' : 'external']: {
            metric: { name: metricName },
            ...(selector ? { selector } : {}),
            target: {
              type: targetType,
              averageValue:
                targetType === 'AverageValue' ? targetValue : undefined,
              value: targetType === 'Value' ? targetValue : undefined,
            },
          },
        },
      ];
    });
  }

  private readHpaBehavior(behavior: unknown): HpaPolicyConfig['behavior'] {
    if (!behavior || typeof behavior !== 'object') return undefined;
    return behavior as HpaPolicyConfig['behavior'];
  }

  private readTargetCpu(metrics: unknown): number | undefined {
    if (!Array.isArray(metrics)) return undefined;
    const metric = metrics.find((item) => item?.resource?.name === 'cpu');
    return metric?.resource?.target?.averageUtilization;
  }

  private readTargetMemory(metrics: unknown): number | undefined {
    if (!Array.isArray(metrics)) return undefined;
    const metric = metrics.find((item) => item?.resource?.name === 'memory');
    return metric?.resource?.target?.averageUtilization;
  }

  private buildHpaMetricsFromConfig(
    config: Record<string, unknown>,
  ): K8sObject[] {
    const metrics: K8sObject[] = [];
    const cpu = config.targetCpuUtilizationPercentage;
    const memory = config.targetMemoryUtilizationPercentage;
    if (typeof cpu === 'number') {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: { type: 'Utilization', averageUtilization: cpu },
        },
      });
    }
    if (typeof memory === 'number') {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'memory',
          target: { type: 'Utilization', averageUtilization: memory },
        },
      });
    }
    if (Array.isArray(config.metrics) && config.metrics.length > 0) {
      return config.metrics.flatMap((metric) =>
        this.normalizeSingleHpaMetric(metric),
      );
    }
    return metrics;
  }

  private normalizeSingleHpaMetric(metric: unknown): K8sObject[] {
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
      return [];
    }
    const raw = metric as Record<string, unknown>;
    if (typeof raw.type === 'string' && raw.type.trim()) {
      if (
        raw.type === 'Resource' &&
        raw.targetType &&
        (!raw.resource || typeof raw.resource !== 'object')
      ) {
        const resource = raw.resource as Record<string, unknown> | undefined;
        return this.normalizeSingleHpaMetric({
          sourceType: 'Resource',
          name: (raw.name as string | undefined) ?? (resource?.name as string | undefined),
          targetType: raw.targetType,
          targetValue: raw.targetValue,
        });
      }
      return [raw as K8sObject];
    }
    const sourceType = raw.sourceType;
    const targetType = raw.targetType;
    const targetValue = raw.targetValue;
    if (!sourceType || !targetType || !targetValue) {
      return [];
    }
    if (sourceType === 'Resource') {
      const name = raw.name;
      if (!name) return [];
      return [
        {
          type: 'Resource',
          resource: {
            name,
            target: {
              type: targetType,
              averageUtilization:
                targetType === 'Utilization' ? Number(targetValue) : undefined,
              averageValue:
                targetType === 'AverageValue' ? targetValue : undefined,
              value: targetType === 'Value' ? targetValue : undefined,
            },
          },
        },
      ];
    }
    const metricName = raw.metricName ?? raw.name;
    if (!metricName) return [];
    const selector = raw.selector;
    return [
      {
        type: sourceType,
        [sourceType === 'Pods' ? 'pods' : 'external']: {
          metric: { name: metricName },
          ...(selector ? { selector } : {}),
          target: {
            type: targetType,
            averageValue: targetType === 'AverageValue' ? targetValue : undefined,
            value: targetType === 'Value' ? targetValue : undefined,
          },
        },
      },
    ];
  }

  private readVpaUpdateMode(value: unknown): 'Off' | 'Initial' | 'Auto' {
    return value === 'Off' || value === 'Initial' || value === 'Auto'
      ? value
      : 'Auto';
  }

  private readVpaControlledResources(policy: unknown): string[] {
    const containerPolicy = this.toRecord(policy)?.containerPolicies?.[0];
    const list = containerPolicy?.controlledResources;
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string')
      : ['cpu', 'memory'];
  }

  private normalizeTimestamp(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    return new Date(0).toISOString();
  }

  private compareTimestamps(left: string, right: string): number {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
    const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
    return safeLeft - safeRight;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
  }

  private compareAutoscalingItems(
    left: AutoscalingResourceSummary,
    right: AutoscalingResourceSummary,
    sortBy: string | undefined,
    sortOrder: 'asc' | 'desc',
  ): number {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const field = sortBy ?? 'updatedAt';
    if (field === 'name' || field === 'workloadName') {
      const cmp = left.workloadName.localeCompare(right.workloadName);
      if (cmp !== 0) return cmp * direction;
    }
    if (field === 'namespace') {
      const cmp = left.namespace.localeCompare(right.namespace);
      if (cmp !== 0) return cmp * direction;
    }
    if (field === 'clusterId') {
      const cmp = left.clusterId.localeCompare(right.clusterId);
      if (cmp !== 0) return cmp * direction;
    }
    if (field === 'updatedAt' || field === 'createdAt') {
      const cmp = this.compareTimestamps(left.updatedAt, right.updatedAt);
      if (cmp !== 0) return cmp * direction;
    }
    const leftKey = `${left.clusterId}/${left.namespace}/${left.workloadName}`;
    const rightKey = `${right.clusterId}/${right.namespace}/${right.workloadName}`;
    return leftKey.localeCompare(rightKey);
  }

  private readVpaResourceLimit(
    policy: unknown,
    resource: 'cpu' | 'memory',
    bound: 'min' | 'max',
  ): string | undefined {
    const containerPolicy = this.toRecord(policy)?.containerPolicies?.[0];
    const target =
      bound === 'min'
        ? containerPolicy?.minAllowed
        : containerPolicy?.maxAllowed;
    if (!target || typeof target !== 'object') return undefined;
    const value = (target as Record<string, unknown>)[resource];
    return typeof value === 'string' ? value : undefined;
  }

  private isHpaEnabled(resource: K8sObject): boolean {
    return (
      resource?.metadata?.annotations?.['aiops.kubenova.io/disabled'] !== 'true'
    );
  }

  private isVpaEnabled(resource: K8sObject): boolean {
    return (
      this.readVpaUpdateMode(resource?.spec?.updatePolicy?.updateMode) !== 'Off'
    );
  }

  private toRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private normalizeResourceName(kind: string, name: string): string {
    if (kind === 'Pod') return name;
    return name;
  }

  private resolveWorkloadApiVersion(kind: string): string {
    const normalized = kind.trim().toLowerCase();
    if (normalized === 'pod') return 'v1';
    if (normalized === 'job' || normalized === 'cronjob') return 'batch/v1';
    return 'apps/v1';
  }

  private async listHpas(
    clusterId: string,
    namespace?: string,
    kind?: string,
    keyword?: string,
  ): Promise<AutoscalingResourceSummary[]> {
    const kubeconfig = await this.getKubeconfig(clusterId);
    const api = this.k8sClientService
      .createClient(kubeconfig)
      .makeApiClient(k8s.AutoscalingV2Api);
    try {
      const items = await this.listHpasAcrossNamespaces(api);
      return items
        .filter((item: K8sObject) => {
          if (!namespace) return true;
          const itemNamespace = this.toRecord(item.metadata).namespace;
          return itemNamespace === namespace;
        })
        .map((item: K8sObject) => this.hpaToSummary(clusterId, item))
        .filter((item: AutoscalingResourceSummary) =>
          this.filterSummary(item, kind, keyword),
        );
    } catch (error) {
      this.logger.warn(
        `HPA list failed cluster=${clusterId} namespace=${namespace ?? '-'} reason=${this.extractK8sErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async listVpas(
    clusterId: string,
    namespace?: string,
    kind?: string,
    keyword?: string,
  ): Promise<AutoscalingResourceSummary[]> {
    const kubeconfig = await this.getKubeconfig(clusterId);
    const api = this.k8sClientService.getCustomObjectsApi(kubeconfig);
    try {
      const items = await this.listVpasAcrossNamespaces(api);
      return items
        .filter((item: K8sObject) => {
          if (!namespace) return true;
          const itemNamespace = this.toRecord(item.metadata).namespace;
          return itemNamespace === namespace;
        })
        .map((item: K8sObject) => this.vpaToSummary(clusterId, item))
        .filter((item: AutoscalingResourceSummary) =>
          this.filterSummary(item, kind, keyword),
        );
    } catch (error) {
      this.logger.warn(
        `VPA list failed cluster=${clusterId} namespace=${namespace ?? '-'} reason=${this.extractK8sErrorMessage(error)}`,
      );
      return [];
    }
  }

  private hpaToSummary(
    clusterId: string,
    resource: K8sObject,
  ): AutoscalingResourceSummary {
    const item = this.hpaToPolicy(resource);
    return { ...item, clusterId };
  }

  private vpaToSummary(
    clusterId: string,
    resource: K8sObject,
  ): AutoscalingResourceSummary {
    const item = this.vpaToPolicy(resource);
    return { ...item, clusterId };
  }

  private filterSummary(
    item: AutoscalingResourceSummary,
    kind?: string,
    keyword?: string,
  ): boolean {
    if (kind && item.workloadKind !== kind) return false;
    if (
      keyword &&
      !`${item.workloadKind}/${item.workloadName} ${item.resourceName} ${item.namespace}`
        .toLowerCase()
        .includes(keyword.toLowerCase())
    )
      return false;
    return true;
  }

  private countCoveredWorkloads(items: AutoscalingResourceSummary[]): number {
    return new Set(
      items.map(
        (item) =>
          `${item.clusterId}/${item.namespace}/${item.workloadKind}/${item.workloadName}`,
      ),
    ).size;
  }

  private extractListItems(payload: unknown): K8sObject[] {
    const record = this.toRecord(payload);
    if (Array.isArray(record.items)) {
      return record.items as K8sObject[];
    }
    const body = this.toRecord(record.body);
    if (Array.isArray(body.items)) {
      return body.items as K8sObject[];
    }
    return [];
  }

  private async listHpasAcrossNamespaces(
    api: k8s.AutoscalingV2Api,
  ): Promise<K8sObject[]> {
    try {
      const resp = await api.listHorizontalPodAutoscalerForAllNamespaces();
      return this.extractListItems(resp);
    } catch (error) {
      this.logger.warn(
        `HPA cluster list failed reason=${this.extractK8sErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async listVpasAcrossNamespaces(
    api: ReturnType<K8sClientService['getCustomObjectsApi']>,
  ): Promise<K8sObject[]> {
    try {
      const resp = await api.listClusterCustomObject({
        group: VPA_GROUP,
        version: VPA_VERSION,
        plural: VPA_PLURAL,
      });
      return this.extractListItems(resp);
    } catch (error) {
      this.logger.warn(
        `VPA cluster list failed reason=${this.extractK8sErrorMessage(error)}`,
      );
      return [];
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
          timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private attachClusterId(
    item: AutoscalingPolicyItem,
    clusterId: string,
  ): AutoscalingPolicyItem {
    return {
      ...item,
      clusterId,
    };
  }

  private async assertWorkloadExists(identity: Identity): Promise<void> {
    const kubeconfig = await this.getKubeconfig(identity.clusterId);
    const apiVersion = this.resolveWorkloadApiVersion(identity.kind);
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(
      this.k8sClientService.createClient(kubeconfig),
    );
    try {
      await objectApi.read({
        apiVersion,
        kind: identity.kind,
        metadata: {
          namespace: identity.namespace,
          name: identity.name,
        },
      });
    } catch (error) {
      if (
        (error as { response?: { statusCode?: number } }).response
          ?.statusCode === 404
      ) {
        throw new BadRequestException(
          `目标工作负载不存在: ${identity.kind} ${identity.namespace}/${identity.name}`,
        );
      }
      throw error;
    }
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
      const record = this.toRecord(error);
      const responseBody = this.toRecord(record.response?.body);
      const message = responseBody.message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
      return JSON.stringify(error);
    } catch {
      return '未知错误';
    }
  }

  private audit(
    actor: Actor | undefined,
    action: 'create' | 'update' | 'delete',
    resourceId: string,
    type: AutoscalingType,
  ): void {
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action,
      resourceType: `autoscaling-${type.toLowerCase()}`,
      resourceId,
      result: 'success',
    });
  }

  private resolveAutoscalingResourceName(name: string, suffix: '-hpa' | '-vpa'): string {
    const trimmedName = name.trim();
    return trimmedName.endsWith(suffix) ? trimmedName : `${trimmedName}${suffix}`;
  }

  private getErrorStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const typed = error as {
      statusCode?: number;
      response?: { statusCode?: number };
      status?: number;
    };
    return typed.statusCode ?? typed.response?.statusCode ?? typed.status;
  }

  private isMissingAutoscalingResourceError(error: unknown): boolean {
    if (this.getErrorStatusCode(error) !== 404) {
      return false;
    }
    const record = this.toRecord(error);
    const responseBody = this.toRecord(record.response?.body);
    const body = this.toRecord(record.body);
    const text = JSON.stringify([responseBody, body, record, error])
      .toLowerCase()
      .replace(/\s+/g, ' ');
    return (
      text.includes('not found') ||
      text.includes('notfound') ||
      text.includes('could not be found') ||
      text.includes('missing')
    );
  }

  private isAlreadyExistsError(error: unknown): boolean {
    const status = this.getErrorStatusCode(error);
    if (status === 409) {
      return true;
    }
    const record = this.toRecord(error);
    const responseBody = this.toRecord(record.response?.body);
    const body = this.toRecord(record.body);
    return (
      responseBody.reason === 'AlreadyExists' || body.reason === 'AlreadyExists'
    );
  }
}
