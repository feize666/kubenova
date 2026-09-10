import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';

export type ClusterAccessRole = 'cluster-admin' | 'operator' | 'viewer';

export interface ClusterAccessSubject {
  id?: string;
  username?: string;
  role?: string;
}

export interface ClusterAccessContext {
  clusterId: string;
  accessRole: ClusterAccessRole;
  source: 'platform-admin' | 'role-binding';
}

type ClusterAccessPrisma = {
  clusterRegistry: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  clusterRoleBinding: {
    findFirst(args: unknown): Promise<{
      clusterId: string;
      role: string;
    } | null>;
    findMany(args: unknown): Promise<Array<{ clusterId: string }>>;
  };
};

const PLATFORM_ADMIN_ROLES = new Set(['platform-admin', 'admin']);
const PLATFORM_OPERATOR_ROLES = new Set(['cluster-operator', 'operator']);
const PLATFORM_READ_ONLY_ROLES = new Set(['read-only', 'user']);
const BINDING_ROLES: ClusterAccessRole[] = [
  'viewer',
  'operator',
  'cluster-admin',
];

function normalizeRole(role: string | undefined): string {
  return String(role ?? '')
    .trim()
    .toLowerCase();
}

function inaccessibleCluster(): NotFoundException {
  return new NotFoundException({
    code: 'CLUSTER_NOT_FOUND_OR_INACCESSIBLE',
    message: '集群不存在或当前用户无权访问',
  });
}

@Injectable()
export class ClusterAccessService {
  constructor(private readonly prismaService: PrismaService) {}

  private get prisma(): ClusterAccessPrisma {
    return this.prismaService as unknown as ClusterAccessPrisma;
  }

  isPlatformAdmin(subject: ClusterAccessSubject | undefined): boolean {
    return PLATFORM_ADMIN_ROLES.has(normalizeRole(subject?.role));
  }

  isPlatformOperator(subject: ClusterAccessSubject | undefined): boolean {
    return PLATFORM_OPERATOR_ROLES.has(normalizeRole(subject?.role));
  }

  isKnownPlatformRole(subject: ClusterAccessSubject | undefined): boolean {
    const role = normalizeRole(subject?.role);
    return (
      PLATFORM_ADMIN_ROLES.has(role) ||
      PLATFORM_OPERATOR_ROLES.has(role) ||
      PLATFORM_READ_ONLY_ROLES.has(role)
    );
  }

  assertPlatformAdmin(subject: ClusterAccessSubject | undefined): void {
    if (!this.isPlatformAdmin(subject)) {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_REQUIRED',
        message: '当前操作需要平台管理员权限',
      });
    }
  }

  async assertCanAccess(
    subject: ClusterAccessSubject | undefined,
    clusterId: string,
  ): Promise<ClusterAccessContext> {
    return this.assertCanRead(subject, clusterId);
  }

  async assertCanRead(
    subject: ClusterAccessSubject | undefined,
    clusterId: string,
  ): Promise<ClusterAccessContext> {
    const normalizedClusterId = this.requireClusterId(clusterId);

    if (this.isPlatformAdmin(subject)) {
      const cluster = await this.prisma.clusterRegistry.findFirst({
        where: {
          id: normalizedClusterId,
          deletedAt: null,
          status: { not: 'deleted' },
        },
        select: { id: true },
      });
      if (!cluster) {
        throw new NotFoundException({
          code: 'CLUSTER_NOT_FOUND',
          message: '集群不存在或已删除',
        });
      }
      return {
        clusterId: cluster.id,
        accessRole: 'cluster-admin',
        source: 'platform-admin',
      };
    }

    const userId = this.requireUserId(subject);
    if (!this.isKnownPlatformRole(subject)) {
      throw inaccessibleCluster();
    }

    const binding = await this.prisma.clusterRoleBinding.findFirst({
      where: {
        userId,
        clusterId: normalizedClusterId,
        state: 'active',
        role: { in: BINDING_ROLES },
        cluster: {
          is: {
            deletedAt: null,
            status: { not: 'deleted' },
          },
        },
      },
      select: { clusterId: true, role: true },
    });
    if (
      !binding ||
      !BINDING_ROLES.includes(binding.role as ClusterAccessRole)
    ) {
      throw inaccessibleCluster();
    }

    return {
      clusterId: binding.clusterId,
      accessRole: binding.role as ClusterAccessRole,
      source: 'role-binding',
    };
  }

  async assertCanMutate(
    subject: ClusterAccessSubject | undefined,
    clusterId: string,
  ): Promise<ClusterAccessContext> {
    const access = await this.assertCanRead(subject, clusterId);
    if (this.isPlatformAdmin(subject)) {
      return access;
    }

    if (!this.isPlatformOperator(subject)) {
      throw new ForbiddenException({
        code: 'PLATFORM_WRITE_FORBIDDEN',
        message: '当前平台角色仅允许只读访问',
      });
    }
    if (access.accessRole === 'viewer') {
      throw new ForbiddenException({
        code: 'CLUSTER_WRITE_FORBIDDEN',
        message: '当前集群授权仅允许只读访问',
      });
    }
    return access;
  }

  async assertClusterAdmin(
    subject: ClusterAccessSubject | undefined,
    clusterId: string,
  ): Promise<ClusterAccessContext> {
    const access = await this.assertCanMutate(subject, clusterId);
    if (access.accessRole !== 'cluster-admin') {
      throw new ForbiddenException({
        code: 'CLUSTER_ADMIN_REQUIRED',
        message: '当前操作需要集群管理员权限',
      });
    }
    return access;
  }

  async listAccessibleClusterIds(
    subject: ClusterAccessSubject | undefined,
  ): Promise<string[] | null> {
    if (this.isPlatformAdmin(subject)) {
      return null;
    }

    const userId = this.requireUserId(subject);
    if (!this.isKnownPlatformRole(subject)) {
      return [];
    }

    const bindings = await this.prisma.clusterRoleBinding.findMany({
      where: {
        userId,
        state: 'active',
        role: { in: BINDING_ROLES },
        cluster: {
          is: {
            deletedAt: null,
            status: { not: 'deleted' },
          },
        },
      },
      select: { clusterId: true },
    });
    return [...new Set(bindings.map((binding) => binding.clusterId))];
  }

  private requireClusterId(clusterId: string): string {
    const normalized = clusterId?.trim();
    if (!normalized) {
      throw new BadRequestException({
        code: 'CLUSTER_ID_REQUIRED',
        message: '必须提供集群 ID',
      });
    }
    return normalized;
  }

  private requireUserId(subject: ClusterAccessSubject | undefined): string {
    const userId = subject?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REQUIRED',
        message: '当前会话缺少用户身份',
      });
    }
    return userId;
  }
}
