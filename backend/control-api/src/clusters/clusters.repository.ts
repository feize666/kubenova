import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export type ClusterState = 'active' | 'disabled' | 'deleted';

export interface ClusterRecord {
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
  /** kubeconfig YAML 原文，存于 metadata.kubeconfig，接入真实集群时使用 */
  kubeconfig?: string;
}

export interface ClusterListParams {
  keyword?: string;
  provider?: string;
  state?: ClusterState;
  environment?: string;
  status?: string;
  page: number;
  pageSize: number;
}

export interface ClusterListResult {
  items: ClusterRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface ClusterMetadata {
  environment?: string;
  status?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  storageUsage?: number;
  provider?: string;
  kubernetesVersion?: string;
  state?: ClusterState;
  version?: number;
  /** kubeconfig YAML 原文，敏感字段，仅在内部流转，不对外直接暴露 */
  kubeconfig?: string;
}

type ClusterRow = {
  id: string;
  name: string;
  apiServer: string;
  status: string;
  metadata: Prisma.JsonValue | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class ClustersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ClusterListParams): Promise<ClusterListResult> {
    const { keyword, provider, state, environment, status, page, pageSize } =
      params;

    const where: Prisma.ClusterRegistryWhereInput = {};

    if (state) {
      if (state === 'deleted') {
        where.OR = [{ deletedAt: { not: null } }, { status: 'deleted' }];
      } else {
        where.deletedAt = null;
        where.status = state;
      }
    } else {
      // 默认排除软删除记录
      where.deletedAt = null;
      where.status = { not: 'deleted' };
    }

    if (keyword) {
      where.name = { contains: keyword, mode: 'insensitive' };
    }

    const needsMemoryFilter = !!(provider || environment || status);

    if (!needsMemoryFilter) {
      const [total, rows] = await Promise.all([
        this.prisma.clusterRegistry.count({ where }),
        this.prisma.clusterRegistry.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        items: rows.map((row) => this.toRecord(row as ClusterRow)),
        total,
        page,
        pageSize,
      };
    }

    const rows = await this.prisma.clusterRegistry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    const normalizedKeyword = keyword?.trim().toLowerCase();
    const filtered = rows
      .map((row) => this.toRecord(row as ClusterRow))
      .filter((record) => {
        if (provider && record.provider !== provider) return false;
        if (environment && record.environment !== environment) return false;
        if (status && record.status !== status) return false;
        if (normalizedKeyword) {
          const matched = [record.id, record.name, record.provider].some((f) =>
            f.toLowerCase().includes(normalizedKeyword),
          );
          if (!matched) return false;
        }
        return true;
      });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return { items, total, page, pageSize };
  }

  async findById(id: string): Promise<ClusterRecord | null> {
    const row = await this.prisma.clusterRegistry.findUnique({ where: { id } });
    return row ? this.toRecord(row as ClusterRow) : null;
  }

  async findByName(name: string): Promise<ClusterRecord | null> {
    // 仅查 deletedAt 为 null 的记录（未软删除），已删除集群的名称可以被重新使用
    const row = await this.prisma.clusterRegistry.findFirst({
      where: { name, deletedAt: null, status: { not: 'deleted' } },
    });
    return row ? this.toRecord(row as ClusterRow) : null;
  }

  async create(record: ClusterRecord): Promise<ClusterRecord> {
    const row = await this.prisma.clusterRegistry.create({
      data: this.toCreateInput(record),
    });
    return this.toRecord(row as ClusterRow);
  }

  async update(record: ClusterRecord): Promise<ClusterRecord> {
    const updateData: Prisma.ClusterRegistryUpdateInput = {
      name: record.name,
      apiServer: `https://${record.name}`,
      status: record.state,
      metadata: this.toMetadata(record),
      // 软删除支持：state 为 deleted 时设置 deletedAt，否则清除
      deletedAt: record.state === 'deleted' ? new Date() : null,
    };

    const row = await this.prisma.clusterRegistry.update({
      where: { id: record.id },
      data: updateData,
    });
    return this.toRecord(row as ClusterRow);
  }

  private toRecord(row: ClusterRow): ClusterRecord {
    const metadata = this.parseMetadata(row.metadata);
    // 优先用 deletedAt 判断 state
    const state: ClusterState = row.deletedAt
      ? 'deleted'
      : this.parseState(metadata.state ?? row.status);

    return {
      id: row.id,
      name: row.name,
      // 历史数据未写入 environment 时，默认归类到“本地”，避免前端筛选/可选集群丢失。
      environment: metadata.environment ?? '本地',
      status:
        metadata.status ??
        (state === 'deleted'
          ? '已删除'
          : state === 'disabled'
            ? '维护'
            : '正常'),
      cpuUsage: this.parseUsage(metadata.cpuUsage),
      memoryUsage: this.parseUsage(metadata.memoryUsage),
      storageUsage: this.parseUsage(metadata.storageUsage),
      provider: metadata.provider ?? 'unknown',
      kubernetesVersion: metadata.kubernetesVersion ?? 'unknown',
      state,
      version: this.parseVersion(metadata.version),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      kubeconfig: metadata.kubeconfig,
    };
  }

  private toCreateInput(record: ClusterRecord) {
    const data: Prisma.ClusterRegistryCreateInput = {
      name: record.name,
      apiServer: `https://${record.name}`,
      status: record.state,
      metadata: this.toMetadata(record) as Prisma.InputJsonObject,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      deletedAt: null,
    };

    return data;
  }

  private toMetadata(record: ClusterRecord): Prisma.JsonObject {
    const meta: Prisma.JsonObject = {
      environment: record.environment,
      status: record.status,
      cpuUsage: record.cpuUsage,
      memoryUsage: record.memoryUsage,
      storageUsage: record.storageUsage,
      provider: record.provider,
      kubernetesVersion: record.kubernetesVersion,
      state: record.state,
      version: record.version,
    };

    if (record.kubeconfig) {
      meta.kubeconfig = record.kubeconfig;
    }

    return meta;
  }

  private parseMetadata(value: Prisma.JsonValue | null): ClusterMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const raw = value as Record<string, unknown>;
    return {
      environment:
        typeof raw.environment === 'string' ? raw.environment : undefined,
      status: typeof raw.status === 'string' ? raw.status : undefined,
      cpuUsage: typeof raw.cpuUsage === 'number' ? raw.cpuUsage : undefined,
      memoryUsage:
        typeof raw.memoryUsage === 'number' ? raw.memoryUsage : undefined,
      storageUsage:
        typeof raw.storageUsage === 'number' ? raw.storageUsage : undefined,
      provider: typeof raw.provider === 'string' ? raw.provider : undefined,
      kubernetesVersion:
        typeof raw.kubernetesVersion === 'string'
          ? raw.kubernetesVersion
          : undefined,
      state: this.parseState(raw.state),
      version: typeof raw.version === 'number' ? raw.version : undefined,
      kubeconfig:
        typeof raw.kubeconfig === 'string' && raw.kubeconfig
          ? raw.kubeconfig
          : undefined,
    };
  }

  private parseState(value: unknown): ClusterState {
    if (value === 'active' || value === 'disabled' || value === 'deleted') {
      return value;
    }
    return 'active';
  }

  private parseUsage(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return value;
  }

  private parseVersion(value: number | undefined): number {
    if (!value || !Number.isFinite(value) || value <= 0) {
      return 1;
    }
    return Math.floor(value);
  }
}
