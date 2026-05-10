import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  type ClusterRecord,
  type ClusterState,
  ClustersRepository,
  type ClusterListParams,
} from './clusters.repository';
import { PrismaService } from '../platform/database/prisma.service';
import { K8sClientService } from './k8s-client.service';

export type { ClusterState };

export interface ClustersListQuery {
  keyword?: string;
  provider?: string;
  state?: ClusterState;
  page?: string;
  pageSize?: string;
  // Keep compatibility for existing frontend filters.
  environment?: string;
  status?: string;
}

export interface ClusterMutationInput {
  name?: string;
  environment?: string;
  status?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  storageUsage?: number;
  provider?: string;
  kubernetesVersion?: string;
  /**
   * kubeconfig YAML 原文，用于接入真实 Kubernetes 集群。
   * 非必填——允许先创建集群记录，后续再通过编辑接口补充。
   * 建议通过 `kubectl config view --raw` 或 `kubectl config view --minify --flatten` 获取。
   */
  kubeconfig?: string;
}

export type ClusterEnvironmentType =
  | 'on-prem'
  | 'private-cloud'
  | 'public-cloud'
  | 'edge';

export interface ClusterProfileMutationInput {
  environmentType?: ClusterEnvironmentType;
  provider?: string;
  region?: string;
  labels?: Record<string, string>;
}

export interface ClusterProfileResponse {
  clusterId: string;
  environmentType: ClusterEnvironmentType;
  provider: string;
  region?: string;
  labels?: Record<string, string>;
  updatedAt: string;
  createdAt: string;
}

export interface ClusterBatchStateRequest {
  action: 'enable' | 'disable';
  ids: string[];
  reason?: string;
}

export interface ClusterItemResponse {
  id: string;
  name: string;
  environment: string;
  status: string;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage: number;
  provider: string;
  kubernetesVersion: string;
  state: ClusterState;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** kubeconfig 是否已配置，true 表示已接入真实集群，不直接返回原文（敏感信息） */
  hasKubeconfig: boolean;
  profile?: ClusterProfileResponse;
}

export interface ClusterDetailNodeItem {
  name: string;
  role: string;
  ready: boolean;
  kubeletVersion?: string;
}

export interface ClusterDetailResponse {
  id: string;
  name: string;
  displayName: string;
  runtimeStatus:
    | 'running'
    | 'offline'
    | 'checking'
    | 'disabled'
    | 'offline-mode';
  lastSyncTime: string | null;
  nodeSummary: {
    total: number;
    ready: number;
    notReady: number;
    items: ClusterDetailNodeItem[];
  };
  platform: {
    cniPlugin: string | null;
    criRuntime: string | null;
    kubernetesVersion: string | null;
  };
  metadata: {
    environment: string;
    provider: string;
    region: string | null;
    environmentType: ClusterEnvironmentType | null;
  };
}

export interface ClustersListResponse {
  items: ClusterItemResponse[];
  page: number;
  pageSize: number;
  total: number;
  timestamp: string;
}

export interface BatchStateItemResult {
  id: string;
  action: 'enable' | 'disable';
  status: 'success' | 'failure';
  state?: ClusterState;
  version?: number;
  message?: string;
}

export interface BatchStateResponse {
  status: 'success' | 'partial_success' | 'failure';
  result: BatchStateItemResult[];
  timestamp: string;
}

@Injectable()
export class ClustersService implements OnModuleInit {
  private readonly repository: ClustersRepository;
  private readonly prisma: PrismaService;
  private readonly k8sClientService: K8sClientService;
  private readonly logger = new Logger(ClustersService.name);

  constructor(
    prismaService: PrismaService,
    k8sClientService: K8sClientService,
  ) {
    this.prisma = prismaService;
    this.k8sClientService = k8sClientService;
    this.repository = new ClustersRepository(prismaService);
  }

  async onModuleInit(): Promise<void> {
    const now = new Date();
    const fixed = await this.prisma.clusterRegistry.updateMany({
      where: {
        deletedAt: null,
        status: 'deleted',
      },
      data: {
        deletedAt: now,
      },
    });
    if (fixed.count > 0) {
      this.logger.warn(
        `backfilled deletedAt for ${fixed.count} legacy deleted clusters`,
      );
    }
  }

  async findById(id: string): Promise<ClusterItemResponse | null> {
    const normalizedId = id?.trim();
    if (!normalizedId) return null;
    const record = await this.repository.findById(normalizedId);
    if (!record || record.state === 'deleted') {
      return null;
    }
    return this.toResponse(record, await this.getProfileByClusterId(record.id));
  }

  async getDetail(id: string): Promise<ClusterDetailResponse> {
    const record = await this.mustFind(id);
    if (record.state === 'deleted') {
      throw new BadRequestException('已删除的集群不可查看详情');
    }

    const profile = await this.getProfileByClusterId(record.id);
    const healthSnapshot = await this.prisma.clusterHealthSnapshot.findUnique({
      where: { clusterId: record.id },
      select: {
        checkedAt: true,
        status: true,
        ok: true,
        reason: true,
        detailJson: true,
      },
    });
    const kubeconfig = await this.getKubeconfig(record.id);
    const runtimeStatus =
      healthSnapshot?.status === 'running'
        ? 'running'
        : healthSnapshot?.status === 'offline'
          ? 'offline'
          : healthSnapshot?.status === 'disabled'
            ? 'disabled'
            : !kubeconfig
              ? 'offline-mode'
              : 'checking';

    const nodeInventory = await this.fetchNodeInventory(kubeconfig);
    const detailJson = this.parseClusterHealthDetail(
      healthSnapshot?.detailJson,
    );
    const lastSyncTime = healthSnapshot?.checkedAt?.toISOString() ?? null;

    return {
      id: record.id,
      name: record.name,
      displayName: profile?.labels?.['displayName'] ?? record.name,
      runtimeStatus,
      lastSyncTime,
      nodeSummary: {
        total: nodeInventory.items.length,
        ready: nodeInventory.items.filter((item) => item.ready).length,
        notReady: nodeInventory.items.filter((item) => !item.ready).length,
        items: nodeInventory.items,
      },
      platform: {
        cniPlugin: this.pickClusterPlatformValue(detailJson, 'cniPlugin'),
        criRuntime: this.pickClusterPlatformValue(detailJson, 'criRuntime'),
        kubernetesVersion:
          this.pickClusterPlatformValue(detailJson, 'version') ??
          record.kubernetesVersion ??
          null,
      },
      metadata: {
        environment: record.environment,
        provider: record.provider,
        region: profile?.region ?? null,
        environmentType: profile?.environmentType ?? null,
      },
    };
  }

  /** 返回集群的 kubeconfig 原文（内部使用，不对外暴露） */
  async getKubeconfig(id: string): Promise<string | null> {
    const normalizedId = id?.trim();
    if (!normalizedId) return null;
    const record = await this.repository.findById(normalizedId);
    if (!record || record.state === 'deleted') {
      return null;
    }
    return record?.kubeconfig ?? null;
  }

  async list(query: ClustersListQuery): Promise<ClustersListResponse> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = this.parsePositiveInt(query.pageSize, 10);
    const targetState = query.state
      ? this.ensureValidState(query.state)
      : undefined;

    const params: ClusterListParams = {
      keyword: query.keyword?.trim() || undefined,
      provider: query.provider?.trim() || undefined,
      environment: query.environment?.trim() || undefined,
      status: query.status?.trim() || undefined,
      state: targetState,
      page,
      pageSize,
    };

    const result = await this.repository.list(params);

    const clusterProfileModel = this.requireClusterProfileModel();
    const profiles = await clusterProfileModel.findMany({
      where: { clusterId: { in: result.items.map((item) => item.id) } },
    });
    const profileMap = new Map<string, ClusterProfileResponse>(
      profiles.map((row: any) => [row.clusterId, this.toProfileResponse(row)]),
    );

    return {
      items: result.items.map((item) =>
        this.toResponse(item, profileMap.get(item.id)),
      ),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      timestamp: new Date().toISOString(),
    };
  }

  async create(input: ClusterMutationInput): Promise<ClusterItemResponse> {
    const payload = this.validateCreate(input);
    await this.ensureNameAvailable(payload.name);
    const now = new Date().toISOString();

    // id 留空，由 repository.toCreateInput 判断后让 Prisma @default(cuid()) 生成
    const record: ClusterRecord = {
      id: '',
      state: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...payload,
    };

    const created = await this.repository.create(record);
    return this.toResponse(created, null);
  }

  async update(
    id: string,
    input: ClusterMutationInput,
  ): Promise<ClusterItemResponse> {
    const record = await this.mustFind(id);
    if (record.state === 'deleted') {
      throw new BadRequestException('已删除的集群不可修改');
    }

    const patch = this.validateUpdate(input);
    if (patch.name && patch.name !== record.name) {
      await this.ensureNameAvailable(patch.name, record.id);
    }

    const next: ClusterRecord = {
      ...record,
      ...patch,
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    };

    const updated = await this.repository.update(next);
    return this.toResponse(
      updated,
      await this.getProfileByClusterId(updated.id),
    );
  }

  async remove(id: string): Promise<ClusterItemResponse> {
    const record = await this.mustFind(id);
    if (record.state === 'deleted') {
      return this.toResponse(record, null);
    }

    const next: ClusterRecord = {
      ...record,
      state: 'deleted',
      status: '已删除',
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    };

    const updated = await this.repository.update(next);

    // 删除后彻底不可见：资源软删除 + 监控/会话/审计关联清理
    await this.prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.workloadRecord.updateMany({
          where: { clusterId: id, state: { not: 'deleted' } },
          data: { state: 'deleted' },
        }),
        tx.networkResource.updateMany({
          where: { clusterId: id, state: { not: 'deleted' } },
          data: { state: 'deleted' },
        }),
        tx.configResource.updateMany({
          where: { clusterId: id, state: { not: 'deleted' } },
          data: { state: 'deleted' },
        }),
        tx.storageResource.updateMany({
          where: { clusterId: id, state: { not: 'deleted' } },
          data: { state: 'deleted' },
        }),
        tx.namespaceRecord.updateMany({
          where: { clusterId: id, state: { not: 'deleted' } },
          data: { state: 'deleted' },
        }),
      ]);

      await tx.monitoringAlert.deleteMany({ where: { clusterId: id } });
      await tx.runtimeSession.deleteMany({ where: { clusterId: id } });
      await tx.clusterCredential.deleteMany({ where: { clusterId: id } });
      await tx.auditLog.updateMany({
        where: { clusterId: id },
        data: { clusterId: null },
      });
    });

    return this.toResponse(updated, null);
  }

  async disable(id: string): Promise<ClusterItemResponse> {
    return this.switchState(id, 'disable');
  }

  async enable(id: string): Promise<ClusterItemResponse> {
    return this.switchState(id, 'enable');
  }

  async updateProfile(
    id: string,
    input: ClusterProfileMutationInput,
  ): Promise<ClusterItemResponse> {
    const record = await this.mustFind(id);
    if (record.state === 'deleted') {
      throw new BadRequestException('已删除的集群不可修改 profile');
    }
    const profileInput = this.validateProfileInput(input);
    const clusterProfileModel = this.requireClusterProfileModel();
    await clusterProfileModel.upsert({
      where: { clusterId: record.id },
      create: {
        clusterId: record.id,
        environmentType: profileInput.environmentType,
        provider: profileInput.provider,
        region: profileInput.region,
        labelsJson: profileInput.labels,
      },
      update: {
        environmentType: profileInput.environmentType,
        provider: profileInput.provider,
        region: profileInput.region,
        labelsJson: profileInput.labels,
      },
    });
    return this.toResponse(record, await this.getProfileByClusterId(record.id));
  }

  async applyBatchState(
    input: ClusterBatchStateRequest,
  ): Promise<BatchStateResponse> {
    const action = input?.action;
    if (action !== 'enable' && action !== 'disable') {
      throw new BadRequestException('action 仅支持 enable 或 disable');
    }

    if (!Array.isArray(input?.ids) || input.ids.length === 0) {
      throw new BadRequestException('ids 不能为空');
    }

    const result: BatchStateItemResult[] = [];
    for (const rawId of input.ids) {
      const id = rawId?.trim();
      if (!id) {
        result.push({
          id: rawId,
          action,
          status: 'failure',
          message: 'id 不能为空',
        });
        continue;
      }

      const record = await this.repository.findById(id);
      if (!record) {
        result.push({ id, action, status: 'failure', message: '集群不存在' });
        continue;
      }
      if (record.state === 'deleted') {
        result.push({
          id,
          action,
          status: 'failure',
          message: '已删除的集群不能修改状态',
        });
        continue;
      }

      if (action === 'disable' && record.state === 'disabled') {
        result.push({
          id,
          action,
          status: 'success',
          state: record.state,
          version: record.version,
          message: '集群已是禁用状态',
        });
        continue;
      }

      if (action === 'enable' && record.state === 'active') {
        result.push({
          id,
          action,
          status: 'success',
          state: record.state,
          version: record.version,
          message: '集群已是启用状态',
        });
        continue;
      }

      const next = await this.updateClusterState(
        record,
        action === 'enable' ? 'active' : 'disabled',
      );

      result.push({
        id,
        action,
        status: 'success',
        state: next.state,
        version: next.version,
      });
    }

    const successCount = result.filter(
      (item) => item.status === 'success',
    ).length;
    const overallStatus: BatchStateResponse['status'] =
      successCount === result.length
        ? 'success'
        : successCount === 0
          ? 'failure'
          : 'partial_success';

    return {
      status: overallStatus,
      result,
      timestamp: new Date().toISOString(),
    };
  }

  private async switchState(
    id: string,
    action: 'enable' | 'disable',
  ): Promise<ClusterItemResponse> {
    const record = await this.mustFind(id);
    if (record.state === 'deleted') {
      throw new BadRequestException('已删除的集群不能修改状态');
    }

    if (action === 'disable' && record.state === 'disabled') {
      return this.toResponse(
        record,
        await this.getProfileByClusterId(record.id),
      );
    }

    if (action === 'enable' && record.state === 'active') {
      return this.toResponse(
        record,
        await this.getProfileByClusterId(record.id),
      );
    }

    const nextState: ClusterState = action === 'enable' ? 'active' : 'disabled';
    const next = await this.updateClusterState(record, nextState);
    return this.toResponse(next, await this.getProfileByClusterId(next.id));
  }

  private async updateClusterState(
    record: ClusterRecord,
    nextState: ClusterState,
  ): Promise<ClusterRecord> {
    const next: ClusterRecord = {
      ...record,
      state: nextState,
      status:
        nextState === 'disabled'
          ? '维护'
          : record.status === '已删除'
            ? '正常'
            : record.status,
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    };

    return this.repository.update(next);
  }

  private async mustFind(id: string): Promise<ClusterRecord> {
    const normalizedId = id?.trim();
    if (!normalizedId) {
      throw new BadRequestException('id 不能为空');
    }

    const record = await this.repository.findById(normalizedId);
    if (!record) {
      throw new NotFoundException(`未找到集群: ${normalizedId}`);
    }
    return record;
  }

  private async ensureNameAvailable(
    name: string,
    currentId?: string,
  ): Promise<void> {
    const existing = await this.repository.findByName(name);
    if (existing && existing.id !== currentId) {
      throw new BadRequestException('name 已存在');
    }
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private ensureValidState(value: string): ClusterState {
    if (value === 'active' || value === 'disabled' || value === 'deleted') {
      return value;
    }
    throw new BadRequestException('state 仅支持 active、disabled、deleted');
  }

  private validateCreate(
    input: ClusterMutationInput,
  ): Omit<
    ClusterRecord,
    'id' | 'state' | 'version' | 'createdAt' | 'updatedAt'
  > {
    const name = input.name?.trim();
    const environment = input.environment?.trim();
    const provider = input.provider?.trim();
    const kubernetesVersion = input.kubernetesVersion?.trim();

    if (!name) {
      throw new BadRequestException('name 不能为空');
    }
    if (!environment) {
      throw new BadRequestException('environment 不能为空');
    }
    if (!provider) {
      throw new BadRequestException('provider 不能为空');
    }
    if (!kubernetesVersion) {
      throw new BadRequestException('kubernetesVersion 不能为空');
    }

    return {
      name,
      environment,
      provider,
      kubernetesVersion,
      status: input.status?.trim() || '正常',
      cpuUsage: this.normalizeUsage(input.cpuUsage, 'cpuUsage', 0),
      memoryUsage: this.normalizeUsage(input.memoryUsage, 'memoryUsage', 0),
      storageUsage: this.normalizeUsage(input.storageUsage, 'storageUsage', 0),
      kubeconfig: input.kubeconfig?.trim() || undefined,
    };
  }

  private validateUpdate(input: ClusterMutationInput): Partial<ClusterRecord> {
    if (!input || Object.keys(input).length === 0) {
      throw new BadRequestException('更新内容不能为空');
    }

    const patch: Partial<ClusterRecord> = {};

    if (input.name !== undefined) {
      const value = input.name.trim();
      if (!value) {
        throw new BadRequestException('name 不能为空');
      }
      patch.name = value;
    }

    if (input.environment !== undefined) {
      const value = input.environment.trim();
      if (!value) {
        throw new BadRequestException('environment 不能为空');
      }
      patch.environment = value;
    }

    if (input.provider !== undefined) {
      const value = input.provider.trim();
      if (!value) {
        throw new BadRequestException('provider 不能为空');
      }
      patch.provider = value;
    }

    if (input.kubernetesVersion !== undefined) {
      const value = input.kubernetesVersion.trim();
      if (!value) {
        throw new BadRequestException('kubernetesVersion 不能为空');
      }
      patch.kubernetesVersion = value;
    }

    if (input.status !== undefined) {
      const value = input.status.trim();
      if (!value) {
        throw new BadRequestException('status 不能为空');
      }
      patch.status = value;
    }

    if (input.cpuUsage !== undefined) {
      patch.cpuUsage = this.normalizeUsage(input.cpuUsage, 'cpuUsage');
    }
    if (input.memoryUsage !== undefined) {
      patch.memoryUsage = this.normalizeUsage(input.memoryUsage, 'memoryUsage');
    }
    if (input.storageUsage !== undefined) {
      patch.storageUsage = this.normalizeUsage(
        input.storageUsage,
        'storageUsage',
      );
    }

    if (input.kubeconfig !== undefined) {
      // 允许传空字符串以清除 kubeconfig
      patch.kubeconfig = input.kubeconfig.trim() || undefined;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('更新内容不能为空');
    }

    return patch;
  }

  private normalizeUsage(
    value: number | undefined,
    field: string,
    fallback?: number,
  ): number {
    if (value === undefined) {
      if (fallback === undefined) {
        throw new BadRequestException(`${field} 不能为空`);
      }
      return fallback;
    }

    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new BadRequestException(`${field} 必须是 0-100 的数字`);
    }

    return Number(value);
  }

  private toResponse(
    record: ClusterRecord,
    profile?: ClusterProfileResponse | null,
  ): ClusterItemResponse {
    return {
      id: record.id,
      name: record.name,
      environment: record.environment,
      status: record.status,
      cpuUsage: record.cpuUsage,
      memoryUsage: record.memoryUsage,
      storageUsage: record.storageUsage,
      provider: record.provider,
      kubernetesVersion: record.kubernetesVersion,
      state: record.state,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      hasKubeconfig: Boolean(record.kubeconfig),
      ...(profile ? { profile } : {}),
    };
  }

  private validateProfileInput(input: ClusterProfileMutationInput): {
    environmentType: ClusterEnvironmentType;
    provider: string;
    region?: string;
    labels?: Record<string, string>;
  } {
    const environmentType = input.environmentType?.trim() as
      | ClusterEnvironmentType
      | undefined;
    if (
      environmentType !== 'on-prem' &&
      environmentType !== 'private-cloud' &&
      environmentType !== 'public-cloud' &&
      environmentType !== 'edge'
    ) {
      throw new BadRequestException(
        'environmentType 必须为 on-prem/private-cloud/public-cloud/edge',
      );
    }
    const provider = input.provider?.trim();
    if (!provider) {
      throw new BadRequestException('provider 不能为空');
    }
    const region = input.region?.trim() || undefined;
    const labels = this.normalizeLabels(input.labels);
    return { environmentType, provider, region, labels };
  }

  private normalizeLabels(
    labels: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!labels) {
      return undefined;
    }
    const entries = Object.entries(labels)
      .map(([key, value]) => [key.trim(), String(value).trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private async getProfileByClusterId(
    clusterId: string,
  ): Promise<ClusterProfileResponse | null> {
    const clusterProfileModel = this.requireClusterProfileModel();
    const row = await clusterProfileModel.findUnique({
      where: { clusterId },
    });
    return row ? this.toProfileResponse(row) : null;
  }

  private toProfileResponse(row: {
    clusterId: string;
    environmentType: string;
    provider: string;
    region: string | null;
    labelsJson: unknown;
    updatedAt: Date;
    createdAt: Date;
  }): ClusterProfileResponse {
    return {
      clusterId: row.clusterId,
      environmentType: row.environmentType as ClusterEnvironmentType,
      provider: row.provider,
      region: row.region ?? undefined,
      labels: this.parseLabels(row.labelsJson),
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseLabels(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseClusterHealthDetail(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private pickClusterPlatformValue(
    detail: Record<string, unknown> | null,
    key: string,
  ): string | null {
    if (!detail) {
      return null;
    }
    const value = detail[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async fetchNodeInventory(
    kubeconfig: string | null,
  ): Promise<{ items: ClusterDetailNodeItem[] }> {
    if (!kubeconfig) {
      return { items: [] };
    }

    try {
      const coreApi = this.k8sClientService.getCoreApi(kubeconfig);
      const resp = await coreApi.listNode();
      const items = resp.items
        .map((node) => {
          const name = node.metadata?.name?.trim() ?? '';
          if (!name) {
            return null;
          }
          const readyCondition = node.status?.conditions?.find(
            (condition) => condition.type === 'Ready',
          );
          const ready = readyCondition?.status === 'True';
          const labels = node.metadata?.labels ?? {};
          const role =
            labels['node-role.kubernetes.io/control-plane'] !== undefined ||
            labels['node-role.kubernetes.io/master'] !== undefined
              ? 'control-plane'
              : 'worker';
          return {
            name,
            role,
            ready,
            kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? undefined,
          };
        })
        .filter((item) => item !== null) as ClusterDetailNodeItem[];
      return { items };
    } catch {
      return { items: [] };
    }
  }

  private requireClusterProfileModel(): {
    findMany(args: unknown): Promise<any[]>;
    findUnique(args: unknown): Promise<any | null>;
    upsert(args: unknown): Promise<any>;
  } {
    const model = (this.prisma as any).clusterProfile;
    if (!model) {
      throw new BadRequestException(
        'ClusterProfile 模型未就绪，请先执行 prisma generate',
      );
    }
    return model;
  }
}
