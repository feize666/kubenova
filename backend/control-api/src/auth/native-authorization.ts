import { ForbiddenException } from '@nestjs/common';
import type { AuthorizationService } from '../common/authorization.service';
import type { NamespaceIdentityService } from '../common/namespace-identity.service';
import { classifyNativeRequest } from './native-request';

/** Called only with a freshly authenticated actor and a server-resolved cluster. */
export async function authorizeNativeRequest(
  actor: { userId: string; authzVersion: number; expiresAt: Date },
  clusterId: string, method: string, target: string,
  authorization: AuthorizationService, identities: NamespaceIdentityService,
) {
  const request = classifyNativeRequest(method, target);
  const now = new Date();
  if (!actor.userId || !clusterId || !Number.isFinite(actor.expiresAt.getTime()) || actor.expiresAt <= now) {
    throw new ForbiddenException('Native access denied');
  }
  const grants = await authorization.listEffectiveGrants(actor.userId, now, clusterId);
  const candidates = grants.filter(grant => grant.clusterId === clusterId &&
    grant.capabilities.some(item => item.capability === 'kubeconfig') &&
    (!request.capability || grant.capabilities.some(item => item.capability === request.capability)));
  if (!candidates.length) throw new ForbiddenException('Native access denied');
  const namespaceUid = await identities.resolve(clusterId, request.namespace);
  const matching = candidates.filter(grant => grant.namespaces.some(scope => scope.namespaceUid === namespaceUid));
  if (!namespaceUid || !matching.length) throw new ForbiddenException('Native access denied');
  const expiresAt = new Date(Math.min(actor.expiresAt.getTime(), ...matching.map(grant => grant.expiresAt?.getTime() ?? Infinity)));
  if (expiresAt <= new Date()) throw new ForbiddenException('Native access expired');
  return { ...request, clusterId, namespaceUid, userId: actor.userId,
    authzVersion: actor.authzVersion, grantIds: matching.map(grant => grant.id), expiresAt };
}
