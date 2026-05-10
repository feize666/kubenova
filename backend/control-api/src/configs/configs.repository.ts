import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export type ConfigResourceState = 'active' | 'disabled' | 'deleted';
export type ConfigResourceKind = 'ConfigMap' | 'Secret';

export interface ConfigRevisionRecord {
  id: string;
  configId: string;
  revision: number;
  data: Prisma.JsonValue | null;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface ConfigResourceRecord {
  id: string;
  clusterId: string;
  namespace: string;
  kind: ConfigResourceKind;
  name: string;
  state: ConfigResourceState;
  dataKeys: Prisma.JsonValue | null;
  currentRev: number;
  labels: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
  revisions?: ConfigRevisionRecord[];
}

export interface ConfigListParams {
  clusterId?: string;
  clusterIds?: string[];
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface ConfigListResult {
  items: ConfigResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConfigCreateData {
  clusterId: string;
  namespace: string;
  kind: ConfigResourceKind;
  name: string;
  state?: ConfigResourceState;
  dataKeys?: Prisma.InputJsonValue;
  labels?: Prisma.InputJsonValue;
}

export interface ConfigUpdateData {
  namespace?: string;
  state?: ConfigResourceState;
  dataKeys?: Prisma.InputJsonValue;
  labels?: Prisma.InputJsonValue;
}

@Injectable()
export class ConfigsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ConfigListParams): Promise<ConfigListResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ConfigResourceWhereInput = {
      state: { not: 'deleted' },
      cluster: { deletedAt: null, status: { not: 'deleted' } },
    };

    if (params.clusterId) {
      where.clusterId = params.clusterId;
    } else if (params.clusterIds) {
      where.clusterId = { in: params.clusterIds };
    }
    if (params.namespace) {
      where.namespace = params.namespace;
    }
    if (params.kind) {
      where.kind = params.kind;
    }
    if (params.keyword) {
      where.name = { contains: params.keyword, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.configResource.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.configResource.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRecord(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: string): Promise<ConfigResourceRecord | null> {
    const row = await this.prisma.configResource.findUnique({
      where: { id },
      include: {
        revisions: {
          orderBy: { revision: 'desc' },
        },
      },
    });
    if (!row) return null;
    return this.toRecord(row, row.revisions);
  }

  async findByKey(
    clusterId: string,
    namespace: string,
    kind: string,
    name: string,
  ): Promise<ConfigResourceRecord | null> {
    const row = await this.prisma.configResource.findUnique({
      where: {
        clusterId_namespace_kind_name: { clusterId, namespace, kind, name },
      },
    });
    return row ? this.toRecord(row) : null;
  }

  async create(
    data: ConfigCreateData,
    initialData?: Prisma.InputJsonValue,
  ): Promise<ConfigResourceRecord> {
    const row = await this.prisma.configResource.create({
      data: {
        clusterId: data.clusterId,
        namespace: data.namespace,
        kind: data.kind,
        name: data.name,
        state: data.state ?? 'active',
        dataKeys: data.dataKeys ?? Prisma.JsonNull,
        currentRev: 1,
        labels: data.labels ?? Prisma.JsonNull,
        revisions: {
          create: {
            revision: 1,
            data: initialData ?? Prisma.JsonNull,
            changedBy: 'system',
            changeNote: '初始版本',
          },
        },
      },
      include: {
        revisions: { orderBy: { revision: 'desc' } },
      },
    });
    return this.toRecord(row, row.revisions);
  }

  async update(
    id: string,
    data: ConfigUpdateData,
    changedBy?: string,
  ): Promise<ConfigResourceRecord> {
    // 先取当前 currentRev
    const existing = await this.prisma.configResource.findUniqueOrThrow({
      where: { id },
      select: { currentRev: true },
    });
    const nextRev = existing.currentRev + 1;

    const updateData: Prisma.ConfigResourceUpdateInput = {
      currentRev: nextRev,
      revisions: {
        create: {
          revision: nextRev,
          data: Prisma.JsonNull,
          changedBy: changedBy ?? 'system',
          changeNote: '更新配置',
        },
      },
    };

    if (data.namespace !== undefined) {
      updateData.namespace = data.namespace;
    }
    if (data.state !== undefined) {
      updateData.state = data.state;
    }
    if (data.dataKeys !== undefined) {
      updateData.dataKeys = data.dataKeys;
    }
    if (data.labels !== undefined) {
      updateData.labels = data.labels;
    }

    const row = await this.prisma.configResource.update({
      where: { id },
      data: updateData,
      include: {
        revisions: { orderBy: { revision: 'desc' } },
      },
    });
    return this.toRecord(row, row.revisions);
  }

  async setState(
    id: string,
    state: ConfigResourceState,
  ): Promise<ConfigResourceRecord> {
    const row = await this.prisma.configResource.update({
      where: { id },
      data: { state },
    });
    return this.toRecord(row);
  }

  async getRevisions(configId: string): Promise<ConfigRevisionRecord[]> {
    const rows = await this.prisma.configRevision.findMany({
      where: { configId },
      orderBy: { revision: 'desc' },
    });
    return rows.map((row) => this.toRevisionRecord(row));
  }

  async getRevision(
    configId: string,
    revision: number,
  ): Promise<ConfigRevisionRecord | null> {
    const row = await this.prisma.configRevision.findUnique({
      where: { configId_revision: { configId, revision } },
    });
    return row ? this.toRevisionRecord(row) : null;
  }

  async rollback(
    id: string,
    revision: number,
    changedBy?: string,
  ): Promise<ConfigResourceRecord> {
    // 找到目标版本的数据
    const targetRevision = await this.prisma.configRevision.findUnique({
      where: { configId_revision: { configId: id, revision } },
    });

    const existing = await this.prisma.configResource.findUniqueOrThrow({
      where: { id },
      select: { currentRev: true },
    });
    const nextRev = existing.currentRev + 1;

    const row = await this.prisma.configResource.update({
      where: { id },
      data: {
        currentRev: nextRev,
        revisions: {
          create: {
            revision: nextRev,
            data: targetRevision?.data ?? Prisma.JsonNull,
            changedBy: changedBy ?? 'system',
            changeNote: `回滚到版本 ${revision}`,
          },
        },
      },
      include: {
        revisions: { orderBy: { revision: 'desc' } },
      },
    });
    return this.toRecord(row, row.revisions);
  }

  private toRecord(
    row: {
      id: string;
      clusterId: string;
      namespace: string;
      kind: string;
      name: string;
      state: string;
      dataKeys: Prisma.JsonValue | null;
      currentRev: number;
      labels: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
    },
    revisions?: Array<{
      id: string;
      configId: string;
      revision: number;
      data: Prisma.JsonValue | null;
      changedBy: string | null;
      changeNote: string | null;
      createdAt: Date;
    }>,
  ): ConfigResourceRecord {
    const createdAt =
      revisions?.[revisions.length - 1]?.createdAt?.toISOString() ??
      row.createdAt.toISOString();
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: this.parseKind(row.kind),
      name: row.name,
      state: this.parseState(row.state),
      dataKeys: row.dataKeys,
      currentRev: row.currentRev,
      labels: row.labels,
      createdAt,
      updatedAt: row.updatedAt.toISOString(),
      revisions: revisions?.map((r) => this.toRevisionRecord(r)),
    };
  }

  private toRevisionRecord(row: {
    id: string;
    configId: string;
    revision: number;
    data: Prisma.JsonValue | null;
    changedBy: string | null;
    changeNote: string | null;
    createdAt: Date;
  }): ConfigRevisionRecord {
    return {
      id: row.id,
      configId: row.configId,
      revision: row.revision,
      data: row.data,
      changedBy: row.changedBy,
      changeNote: row.changeNote,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseKind(value: string): ConfigResourceKind {
    if (value === 'Secret') return 'Secret';
    return 'ConfigMap';
  }

  private parseState(value: string): ConfigResourceState {
    if (value === 'disabled' || value === 'deleted') return value;
    return 'active';
  }
}
