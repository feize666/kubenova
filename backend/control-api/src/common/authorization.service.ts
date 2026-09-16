import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service';

export type AuthorizationCapability = 'logs' | 'exec' | 'secrets' | 'kubeconfig';
export type AuthorizationRole = 'cluster-admin' | 'operator' | 'viewer';

export interface AuthorizationRequest {
  userId: string;
  clusterId: string;
  namespaceUid?: string;
  capability?: AuthorizationCapability;
  mutation?: boolean;
  at?: Date;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reasonCode: string;
  grantIds: string[];
  expiresAt: Date | null;
}

type Grant = {
  id: string;
  userId: string | null;
  groupId: string | null;
  clusterId: string;
  role: string;
  state: string;
  validFrom: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  namespaces: Array<{ namespaceUid: string }>;
  capabilities: Array<{ capability: string }>;
};

type AuthorizationPrisma = {
  accessGrant: { findMany(args: unknown): Promise<Grant[]> };
  groupMembership: { findMany(args: unknown): Promise<Array<{ groupId: string }>> };
};

const roles = new Set<AuthorizationRole>(['cluster-admin', 'operator', 'viewer']);
const capabilities = new Set<AuthorizationCapability>(['logs', 'exec', 'secrets', 'kubeconfig']);

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const now = request.at ?? new Date();
    if (!request.userId || !request.clusterId) return this.deny('IDENTITY_OR_CLUSTER_REQUIRED');
    if (request.capability && !capabilities.has(request.capability)) return this.deny('CAPABILITY_NOT_SUPPORTED');
    // A namespaced grant cannot authorize an unscoped request.
    if (!request.namespaceUid?.trim()) return this.deny('NAMESPACE_SCOPE_REQUIRED');
    const memberships = await (this.prisma as unknown as AuthorizationPrisma).groupMembership.findMany({
      where: { userId: request.userId, state: 'active', validFrom: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { groupId: true },
    });
    const subjectIds = [request.userId, ...memberships.map(item => item.groupId)];
    const grants = await (this.prisma as unknown as AuthorizationPrisma).accessGrant.findMany({
      where: { clusterId: request.clusterId, state: 'active', revokedAt: null, OR: [{ userId: request.userId }, { groupId: { in: subjectIds.slice(1) } }] },
      include: { namespaces: { select: { namespaceUid: true } }, capabilities: { select: { capability: true } } },
    });
    const matching = grants.filter(grant => {
      if (!subjectIds.includes(grant.userId ?? '') && !subjectIds.includes(grant.groupId ?? '')) return false;
      if (!roles.has(grant.role as AuthorizationRole)) return false;
      if (grant.validFrom > now || (grant.expiresAt && grant.expiresAt <= now) || grant.revokedAt) return false;
      if (request.namespaceUid && !grant.namespaces.some(scope => scope.namespaceUid === request.namespaceUid)) return false;
      if (request.capability && !grant.capabilities.some(item => item.capability === request.capability)) return false;
      if (request.mutation && grant.role === 'viewer') return false;
      return true;
    });
    if (!matching.length) return this.deny('GRANT_NOT_FOUND');
    const expiresAt = matching.reduce<Date | null>((earliest, grant) => !grant.expiresAt ? earliest : !earliest || grant.expiresAt < earliest ? grant.expiresAt : earliest, null);
    return { allowed: true, reasonCode: 'GRANT_MATCHED', grantIds: matching.map(grant => grant.id), expiresAt };
  }

  private deny(reasonCode: string): AuthorizationDecision {
    return { allowed: false, reasonCode, grantIds: [], expiresAt: null };
  }
}
