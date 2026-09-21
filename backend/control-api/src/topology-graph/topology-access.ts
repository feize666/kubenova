import { ForbiddenException } from '@nestjs/common';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';

export type TopologyActor = ClusterAccessSubject;
export interface TopologyActorRequest { user?: { user?: TopologyActor } }
export interface TopologyScope {
  clusterId: string;
  namespace?: string;
  namespaceUid?: string;
  secrets: boolean;
}

export async function resolveTopologyScopes(
  actor: TopologyActor | undefined,
  query: { clusterId?: string; namespace?: string },
  access?: ClusterAccessService,
  authorization?: AuthorizationService,
  identity?: NamespaceIdentityService,
): Promise<TopologyScope[] | undefined> {
  // Only internal callers may omit the actor; HTTP controllers always pass {}.
  if (actor === undefined) return undefined;
  if (!actor.id?.trim() || !access || !authorization || !identity || !access.isKnownPlatformRole(actor)) throw new ForbiddenException();
  if (access.isPlatformAdmin(actor)) return undefined;
  const clusterId = query.clusterId?.trim();
  const namespace = query.namespace?.trim();
  const scopes: TopologyScope[] = (await access.listAccessibleClusterIds(actor) ?? [])
    .filter(id => !clusterId || id === clusterId)
    .map(id => ({ clusterId: id, secrets: false }));
  const checked = new Map<string, string | null>();
  for (const grant of await authorization.listEffectiveGrants(actor.id)) {
    if (clusterId && grant.clusterId !== clusterId) continue;
    for (const scope of grant.namespaces) {
      if (!scope.namespaceName || (namespace && scope.namespaceName !== namespace)) continue;
      const key = `${grant.clusterId}/${scope.namespaceName}`;
      if (!checked.has(key)) {
        try { checked.set(key, await identity.resolve(grant.clusterId, scope.namespaceName)); }
        catch { checked.set(key, null); }
      }
      if (checked.get(key) !== scope.namespaceUid) continue;
      scopes.push({ clusterId: grant.clusterId, namespace: scope.namespaceName, namespaceUid: scope.namespaceUid, secrets: grant.capabilities.some(item => item.capability === 'secrets') });
    }
  }
  if (!scopes.length && (clusterId || namespace)) throw new ForbiddenException('拓扑资源不在授权范围内');
  return scopes;
}

type ResourceScopeFilter = { OR?: Array<{ clusterId: string; namespace?: string; name?: string; kind?: { not: string } }> };
type AlertScopeFilter = { OR?: Array<{ clusterId: string; namespace?: string; OR?: Array<{ resourceType: null } | { resourceType: { not: string } }> }> };
export function topologyScopeWhere(scopes: TopologyScope[] | undefined, target?: 'resources' | 'configuration' | 'namespaces'): ResourceScopeFilter;
export function topologyScopeWhere(scopes: TopologyScope[] | undefined, target: 'alerts'): AlertScopeFilter;
export function topologyScopeWhere(scopes: TopologyScope[] | undefined, target: 'resources' | 'configuration' | 'namespaces' | 'alerts' = 'resources'): ResourceScopeFilter | AlertScopeFilter {
  if (!scopes) return {};
  return {
    OR: scopes.map(scope => ({
      clusterId: scope.clusterId,
      ...(scope.namespace ? { [target === 'namespaces' ? 'name' : 'namespace']: scope.namespace } : {}),
      ...(target === 'configuration' && !scope.secrets ? { kind: { not: 'Secret' } } : {}),
      ...(target === 'alerts' && !scope.secrets ? { OR: [{ resourceType: null }, { resourceType: { not: 'Secret' } }] } : {}),
    })),
  };
}
