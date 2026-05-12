import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export type NetworkResourceState = 'active' | 'disabled' | 'deleted';
export type NetworkResourceKind =
  | 'Service'
  | 'Endpoints'
  | 'EndpointSlice'
  | 'Ingress'
  | 'IngressRoute'
  | 'NetworkPolicy';

export interface NetworkResourceRecord {
  id: string;
  clusterId: string;
  namespace: string;
  kind: NetworkResourceKind;
  name: string;
  state: NetworkResourceState;
  spec: Prisma.JsonValue | null;
  statusJson: Prisma.JsonValue | null;
  labels: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkListParams {
  clusterId?: string;
  clusterIds?: string[];
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface NetworkListResult {
  items: NetworkResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NetworkCreateData {
  clusterId: string;
  namespace: string;
  kind: NetworkResourceKind;
  name: string;
  state?: NetworkResourceState;
  spec?: Prisma.InputJsonValue;
  statusJson?: Prisma.InputJsonValue;
  labels?: Prisma.InputJsonValue;
}

export interface NetworkUpdateData {
  namespace?: string;
  state?: NetworkResourceState;
  spec?: Prisma.InputJsonValue;
  statusJson?: Prisma.InputJsonValue;
  labels?: Prisma.InputJsonValue;
}

@Injectable()
export class NetworkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: NetworkListParams): Promise<NetworkListResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NetworkResourceWhereInput = {
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
    const orderBy = this.resolveOrderBy(params.sortBy, params.sortOrder);

    const [rows, total] = await Promise.all([
      this.prisma.networkResource.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.networkResource.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRecord(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: string): Promise<NetworkResourceRecord | null> {
    const row = await this.prisma.networkResource.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByKey(
    clusterId: string,
    namespace: string,
    kind: NetworkResourceKind,
    name: string,
  ): Promise<NetworkResourceRecord | null> {
    const row = await this.prisma.networkResource.findFirst({
      where: {
        clusterId,
        namespace,
        kind,
        name,
        state: { not: 'deleted' },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return row ? this.toRecord(row) : null;
  }

  async create(data: NetworkCreateData): Promise<NetworkResourceRecord> {
    const row = await this.prisma.networkResource.create({
      data: {
        clusterId: data.clusterId,
        namespace: data.namespace,
        kind: data.kind,
        name: data.name,
        state: data.state ?? 'active',
        spec: data.spec ?? Prisma.JsonNull,
        statusJson: data.statusJson ?? Prisma.JsonNull,
        labels: data.labels ?? Prisma.JsonNull,
      },
    });
    return this.toRecord(row);
  }

  async update(
    id: string,
    data: NetworkUpdateData,
  ): Promise<NetworkResourceRecord> {
    const updateData: Prisma.NetworkResourceUpdateInput = {};
    if (data.namespace !== undefined) {
      updateData.namespace = data.namespace;
    }
    if (data.state !== undefined) {
      updateData.state = data.state;
    }
    if (data.spec !== undefined) {
      updateData.spec = data.spec;
    }
    if (data.statusJson !== undefined) {
      updateData.statusJson = data.statusJson;
    }
    if (data.labels !== undefined) {
      updateData.labels = data.labels;
    }

    const row = await this.prisma.networkResource.update({
      where: { id },
      data: updateData,
    });
    return this.toRecord(row);
  }

  async setState(
    id: string,
    state: NetworkResourceState,
  ): Promise<NetworkResourceRecord> {
    const row = await this.prisma.networkResource.update({
      where: { id },
      data: { state },
    });
    return this.toRecord(row);
  }

  private resolveOrderBy(
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ): Prisma.NetworkResourceOrderByWithRelationInput[] {
    const order: Prisma.SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';
    const field = (sortBy ?? '').trim();
    if (field === 'name') {
      return [{ name: order }, { id: 'asc' }];
    }
    if (field === 'namespace') {
      return [{ namespace: order }, { id: 'asc' }];
    }
    if (field === 'clusterId') {
      return [{ clusterId: order }, { id: 'asc' }];
    }
    if (field === 'createdAt') {
      return [{ createdAt: order }, { id: 'asc' }];
    }
    return [{ createdAt: 'desc' }, { id: 'asc' }];
  }

  private toRecord(row: {
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
  }): NetworkResourceRecord {
    const createdAt =
      this.readCreationTimestamp(row.statusJson) ?? row.createdAt.toISOString();
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: this.parseKind(row.kind),
      name: row.name,
      state: this.parseState(row.state),
      spec: row.spec,
      statusJson: row.statusJson,
      labels: row.labels,
      createdAt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private readCreationTimestamp(value: Prisma.JsonValue | null): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const creationTimestamp = (value as Record<string, unknown>)
      .creationTimestamp;
    return typeof creationTimestamp === 'string' && creationTimestamp.trim()
      ? creationTimestamp
      : null;
  }

  private parseKind(value: string): NetworkResourceKind {
    if (value === 'EndpointSlice') return 'EndpointSlice';
    if (value === 'Endpoints') return 'Endpoints';
    if (value === 'IngressRoute') return 'IngressRoute';
    if (value === 'Ingress') return 'Ingress';
    if (value === 'NetworkPolicy') return 'NetworkPolicy';
    return 'Service';
  }

  private parseState(value: string): NetworkResourceState {
    if (value === 'disabled' || value === 'deleted') return value;
    return 'active';
  }
}
