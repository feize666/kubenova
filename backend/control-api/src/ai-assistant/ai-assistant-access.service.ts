import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import type { AiActionActor } from './ai-action-executor.service';

export type AiAssistantAccessContext = {
  clusterId?: string;
  namespace?: string;
  mutation?: boolean;
  requireScope?: boolean;
};

@Injectable()
export class AiAssistantAccessService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly namespaceIdentity: NamespaceIdentityService,
  ) {}

  async getAccess(actor: AiActionActor | undefined) {
    const role = String(actor?.role ?? '').trim().toLowerCase();
    if (role === 'admin' || role === 'platform-admin') {
      return { allowed: true, fullAccess: true, scopes: [] as Array<{ clusterId: string; namespaces: string[] }> };
    }
    const userId = actor?.userId?.trim();
    if (!userId) return { allowed: false, fullAccess: false, scopes: [] };
    const grants = await this.authorization.listEffectiveGrants(userId);
    const scoped = grants.filter(grant => grant.capabilities.some(item => item.capability === 'ai-assistant:use'));
    const scopes = new Map<string, Set<string>>();
    scoped.forEach(grant => {
      const namespaces = scopes.get(grant.clusterId) ?? new Set<string>();
      grant.namespaces.forEach(namespace => namespaces.add(namespace.namespaceName ?? namespace.namespaceUid));
      scopes.set(grant.clusterId, namespaces);
    });
    return {
      allowed: scopes.size > 0,
      fullAccess: false,
      scopes: [...scopes.entries()].map(([clusterId, namespaces]) => ({ clusterId, namespaces: [...namespaces].sort() })),
    };
  }

  async authorize(actor: AiActionActor | undefined, context: AiAssistantAccessContext = {}): Promise<AiActionActor> {
    const role = String(actor?.role ?? '').trim().toLowerCase();
    if (role === 'admin' || role === 'platform-admin') {
      return { ...actor, role: 'platform-admin' };
    }

    const userId = actor?.userId?.trim();
    if (!userId) throw new ForbiddenException('AI 助手需要有效的用户身份');
    const clusterId = context.clusterId?.trim();
    const namespace = context.namespace?.trim();
    if (!clusterId && !namespace && !context.mutation && !context.requireScope) {
      const grants = await this.authorization.listEffectiveGrants(userId);
      if (grants.some(grant => grant.capabilities.some(item => item.capability === 'ai-assistant:use'))) {
        return { ...actor, role: 'read-only' };
      }
      throw new ForbiddenException('当前用户未获授 AI 助手使用权限');
    }
    if (!clusterId || !namespace) {
      throw new ForbiddenException('AI 资源操作必须指定已授权的集群和命名空间');
    }

    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, namespace);
    const decision = await this.authorization.authorize({
      userId,
      clusterId,
      namespaceUid,
      capability: 'ai-assistant:use',
      mutation: context.mutation,
    });
    if (!decision.allowed) {
      throw new ForbiddenException('AI 助手操作超出当前用户的集群、命名空间或角色授权范围');
    }

    return {
      ...actor,
      role: context.mutation ? 'cluster-operator' : 'read-only',
    };
  }
}
