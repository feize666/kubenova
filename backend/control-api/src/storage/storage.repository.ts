import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export type StorageResourceState = 'active' | 'disabled' | 'deleted';
export type StorageResourceKind = 'PV' | 'PVC' | 'SC';

export interface StorageResourceRecord {
  id: string;
  clusterId: string;
  namespace: string | null;
  kind: StorageResourceKind;
  name: string;
  state: StorageResourceState;
  capacity: string | null;
  accessModes: Prisma.JsonValue | null;
  storageClass: string | null;
  bindingMode: string | null;
  spec: Prisma.JsonValue | null;
  statusJson: Prisma.JsonValue | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageListParams {
  clusterId?: string;
  clusterIds?: string[];
  namespace?: string;
  kind?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface StorageListResult {
  items: StorageResourceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StorageCreateData {
  clusterId: string;
  namespace?: string | null;
  kind: StorageResourceKind;
  name: string;
  state?: StorageResourceState;
  capacity?: string;
  accessModes?: Prisma.InputJsonValue;
  storageClass?: string;
  bindingMode?: string;
  spec?: Prisma.InputJsonValue;
  statusJson?: Prisma.InputJsonValue;
}

export interface StorageUpdateData {
  namespace?: string | null;
  state?: StorageResourceState;
  capacity?: string;
  accessModes?: Prisma.InputJsonValue;
  storageClass?: string;
  bindingMode?: string;
  spec?: Prisma.InputJsonValue;
  statusJson?: Prisma.InputJsonValue;
}

@Injectable()
export class StorageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: StorageListParams): Promise<StorageListResult> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize =
      params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.StorageResourceWhereInput = {
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
      this.prisma.storageResource.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.storageResource.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toRecord(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: string): Promise<StorageResourceRecord | null> {
    const row = await this.prisma.storageResource.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByKey(
    clusterId: string,
    kind: StorageResourceKind,
    name: string,
  ): Promise<StorageResourceRecord | null> {
    const row = await this.prisma.storageResource.findFirst({
      where: {
        clusterId,
        kind,
        name,
        state: { not: 'deleted' },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return row ? this.toRecord(row) : null;
  }

  async create(data: StorageCreateData): Promise<StorageResourceRecord> {
    const row = await this.prisma.storageResource.create({
      data: {
        clusterId: data.clusterId,
        namespace: data.namespace ?? null,
        kind: data.kind,
        name: data.name,
        state: data.state ?? 'active',
        capacity: data.capacity ?? null,
        accessModes: data.accessModes ?? Prisma.JsonNull,
        storageClass: data.storageClass ?? null,
        bindingMode: data.bindingMode ?? null,
        spec: data.spec ?? Prisma.JsonNull,
        statusJson: data.statusJson ?? Prisma.JsonNull,
      },
    });
    return this.toRecord(row);
  }

  async update(
    id: string,
    data: StorageUpdateData,
  ): Promise<StorageResourceRecord> {
    const updateData: Prisma.StorageResourceUpdateInput = {};

    if ('namespace' in data) {
      updateData.namespace = data.namespace ?? null;
    }
    if (data.state !== undefined) {
      updateData.state = data.state;
    }
    if (data.capacity !== undefined) {
      updateData.capacity = data.capacity;
    }
    if (data.accessModes !== undefined) {
      updateData.accessModes = data.accessModes;
    }
    if (data.storageClass !== undefined) {
      updateData.storageClass = data.storageClass;
    }
    if (data.bindingMode !== undefined) {
      updateData.bindingMode = data.bindingMode;
    }
    if (data.spec !== undefined) {
      updateData.spec = data.spec;
    }
    if (data.statusJson !== undefined) {
      updateData.statusJson = data.statusJson;
    }

    const row = await this.prisma.storageResource.update({
      where: { id },
      data: updateData,
    });
    return this.toRecord(row);
  }

  async setState(
    id: string,
    state: StorageResourceState,
  ): Promise<StorageResourceRecord> {
    const row = await this.prisma.storageResource.update({
      where: { id },
      data: { state },
    });
    return this.toRecord(row);
  }

  private toRecord(row: {
    id: string;
    clusterId: string;
    namespace: string | null;
    kind: string;
    name: string;
    state: string;
    capacity: string | null;
    accessModes: Prisma.JsonValue | null;
    storageClass: string | null;
    bindingMode: string | null;
    spec: Prisma.JsonValue | null;
    statusJson: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): StorageResourceRecord {
    const createdAt =
      this.readCreationTimestamp(row.statusJson) ?? row.createdAt.toISOString();
    return {
      id: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: this.parseKind(row.kind),
      name: row.name,
      state: this.parseState(row.state),
      capacity: row.capacity,
      accessModes: row.accessModes,
      storageClass: row.storageClass,
      bindingMode: row.bindingMode,
      spec: row.spec,
      statusJson: row.statusJson,
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

  private parseKind(value: string): StorageResourceKind {
    if (value === 'SC') return 'SC';
    if (value === 'PVC') return 'PVC';
    return 'PV';
  }

  private parseState(value: string): StorageResourceState {
    if (value === 'disabled' || value === 'deleted') return value;
    return 'active';
  }
}
