import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export interface WorkloadRecord {
  id: string;
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  state: 'active' | 'disabled' | 'deleted';
  replicas: number | null;
  readyReplicas: number | null;
  spec: Prisma.JsonValue | null;
  statusJson: Prisma.JsonValue | null;
  labels: Prisma.JsonValue | null;
  annotations: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkloadListParams {
  clusterId?: string;
  clusterIds?: string[];
  namespace?: string;
  kind?: string;
  keyword?: string;
  state?: string;
  page?: number;
  pageSize?: number;
}

export interface WorkloadListResult {
  items: WorkloadRecord[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class WorkloadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: WorkloadListParams): Promise<WorkloadListResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 10;
    const skip = (page - 1) * pageSize;

    const where: Prisma.WorkloadRecordWhereInput = {
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
    if (params.state) {
      // explicit state filter overrides the default 'not deleted'
      where.state = params.state;
    }
    if (params.keyword) {
      where.name = { contains: params.keyword, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.workloadRecord.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.workloadRecord.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRecord(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: string): Promise<WorkloadRecord | null> {
    const row = await this.prisma.workloadRecord.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByKey(
    clusterId: string,
    namespace: string,
    kind: string,
    name: string,
  ): Promise<WorkloadRecord | null> {
    const row = await this.prisma.workloadRecord.findUnique({
      where: {
        clusterId_namespace_kind_name: { clusterId, namespace, kind, name },
      },
    });
    return row ? this.toRecord(row) : null;
  }

  async getClusterKubeconfig(clusterId: string): Promise<string | null> {
    const row = await this.prisma.clusterRegistry.findUnique({
      where: { id: clusterId },
      select: { metadata: true, deletedAt: true },
    });
    if (!row || row.deletedAt) {
      return null;
    }
    if (
      !row.metadata ||
      typeof row.metadata !== 'object' ||
      Array.isArray(row.metadata)
    ) {
      return null;
    }
    const metadata = row.metadata as Record<string, unknown>;
    return typeof metadata.kubeconfig === 'string' && metadata.kubeconfig
      ? metadata.kubeconfig
      : null;
  }

  async create(data: {
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
  }): Promise<WorkloadRecord> {
    const row = await this.prisma.workloadRecord.create({
      data: {
        clusterId: data.clusterId,
        namespace: data.namespace,
        kind: data.kind,
        name: data.name,
        state: 'active',
        replicas: data.replicas ?? null,
        readyReplicas: data.readyReplicas ?? null,
        spec: data.spec ?? Prisma.JsonNull,
        statusJson: data.statusJson ?? Prisma.JsonNull,
        labels: data.labels ?? Prisma.JsonNull,
        annotations: data.annotations ?? Prisma.JsonNull,
      },
    });
    return this.toRecord(row);
  }

  async update(
    id: string,
    data: Partial<
      Pick<
        WorkloadRecord,
        | 'state'
        | 'replicas'
        | 'readyReplicas'
        | 'spec'
        | 'statusJson'
        | 'labels'
        | 'annotations'
        | 'namespace'
        | 'kind'
        | 'name'
      >
    >,
  ): Promise<WorkloadRecord> {
    const updateData: Prisma.WorkloadRecordUpdateInput = {};

    if (data.state !== undefined) updateData.state = data.state;
    if (data.namespace !== undefined) updateData.namespace = data.namespace;
    if (data.kind !== undefined) updateData.kind = data.kind;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.replicas !== undefined) updateData.replicas = data.replicas;
    if (data.readyReplicas !== undefined)
      updateData.readyReplicas = data.readyReplicas;
    if (data.spec !== undefined)
      updateData.spec = data.spec as Prisma.InputJsonValue;
    if (data.statusJson !== undefined)
      updateData.statusJson = data.statusJson as Prisma.InputJsonValue;
    if (data.labels !== undefined)
      updateData.labels = data.labels as Prisma.InputJsonValue;
    if (data.annotations !== undefined)
      updateData.annotations = data.annotations as Prisma.InputJsonValue;

    const row = await this.prisma.workloadRecord.update({
      where: { id },
      data: updateData,
    });
    return this.toRecord(row);
  }

  async setState(
    id: string,
    state: 'active' | 'disabled' | 'deleted',
  ): Promise<WorkloadRecord> {
    const row = await this.prisma.workloadRecord.update({
      where: { id },
      data: { state },
    });
    return this.toRecord(row);
  }

  async deleteByCluster(clusterId: string): Promise<void> {
    await this.prisma.workloadRecord.deleteMany({ where: { clusterId } });
  }

  private toRecord(row: {
    id: string;
    clusterId: string;
    namespace: string;
    kind: string;
    name: string;
    state: string;
    replicas: number | null;
    readyReplicas: number | null;
    spec: Prisma.JsonValue | null;
    statusJson: Prisma.JsonValue | null;
    labels: Prisma.JsonValue | null;
    annotations: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkloadRecord {
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      state: this.parseState(row.state),
      replicas: row.replicas,
      readyReplicas: row.readyReplicas,
      spec: row.spec,
      statusJson: row.statusJson,
      labels: row.labels,
      annotations: row.annotations,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private parseState(value: string): 'active' | 'disabled' | 'deleted' {
    if (value === 'active' || value === 'disabled' || value === 'deleted') {
      return value;
    }
    return 'active';
  }
}
