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

const PLATFORM_ADMIN_ROLES = new Set(['platform-admin', 'admin']);

function normalizeClusterAccessRole(value: string): ClusterAccessRole {
  if (value === 'cluster-admin' || value === 'operator') {
    return value;
  }
  return 'viewer';
}

/**
 * Resolves a user's access to one cluster. It intentionally owns no HTTP
 * details so resource modules can reuse it when cluster-scoped routes migrate.
 */
@Injectable()
export class ClusterAccessService {
  constructor(private readonly prisma: PrismaService) {}

  isPlatformAdmin(subject: ClusterAccessSubject | undefined): boolean {
    return PLATFORM_ADMIN_ROLES.has(
      String(subject?.role ?? '')
        .trim()
        .toLowerCase(),
    );
  }

  async assertCanAccess(
    subject: ClusterAccessSubject | undefined,
    clusterId: string,
  ): Promise<ClusterAccessContext> {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      throw new BadRequestException({
        code: 'CLUSTER_ID_REQUIRED',
        message: '必须提供集群 ID',
      });
    }

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

    if (this.isPlatformAdmin(subject)) {
      return {
        clusterId: cluster.id,
        accessRole: 'cluster-admin',
        source: 'platform-admin',
      };
    }

    const userId = subject?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REQUIRED',
        message: '当前会话缺少用户身份',
      });
    }

    const binding = await this.prisma.clusterRoleBinding.findFirst({
      where: {
        userId,
        clusterId: cluster.id,
        state: 'active',
      },
      select: { role: true },
    });
    if (!binding) {
      throw new ForbiddenException({
        code: 'CLUSTER_ACCESS_DENIED',
        message: '当前用户未获授权访问该集群',
      });
    }

    return {
      clusterId: cluster.id,
      accessRole: normalizeClusterAccessRole(binding.role),
      source: 'role-binding',
    };
  }

  /**
   * `null` means unrestricted platform-admin access. Other callers receive
   * only active bound cluster IDs and may apply the result to list queries.
   */
  async listAccessibleClusterIds(
    subject: ClusterAccessSubject | undefined,
  ): Promise<string[] | null> {
    if (this.isPlatformAdmin(subject)) {
      return null;
    }

    const userId = subject?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REQUIRED',
        message: '当前会话缺少用户身份',
      });
    }

    const bindings = await this.prisma.clusterRoleBinding.findMany({
      where: { userId, state: 'active' },
      select: { clusterId: true },
    });
    return bindings.map((binding) => binding.clusterId);
  }
}
