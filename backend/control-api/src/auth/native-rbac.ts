import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { AuthorizationService } from '../common/authorization.service';
import { nativeReadResources } from './native-request';

type Grant = Awaited<ReturnType<AuthorizationService['listEffectiveGrants']>>[number];

export function nativeRbacSubject(userId: string, clusterId: string) {
  if (!userId?.trim() || !clusterId?.trim()) throw new BadRequestException('Native identity and cluster required');
  return `kubenova:native:${createHash('sha256').update(JSON.stringify([clusterId, userId])).digest('hex').slice(0, 40)}`;
}

/** Pure desired state. Apply requires an ownership-aware reconciler and live grant recheck. */
export function planNativeRbac(input: {
  userId: string; clusterId: string; grants: Grant[];
  namespaces: Array<{ name: string; uid: string }>; now?: Date;
}) {
  if (!input.userId?.trim() || !input.clusterId?.trim()) throw new BadRequestException('Native identity and cluster required');
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new BadRequestException('Invalid authorization time');
  const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
  const subject = nativeRbacSubject(input.userId, input.clusterId);
  const seen = new Set<string>();
  return input.namespaces.flatMap(namespace => {
    if (!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace.name) || !namespace.uid?.trim() || seen.has(namespace.name)) {
      throw new BadRequestException('Invalid or duplicate native namespace');
    }
    seen.add(namespace.name);
    // Grants must come from listEffectiveGrants, which resolves user/group membership.
    const grants = input.grants.filter(grant => grant.clusterId === input.clusterId &&
      (grant.userId === input.userId || (grant.userId === null && Boolean(grant.groupId))) &&
      grant.state === 'active' && !grant.revokedAt && grant.validFrom <= now &&
      (!grant.expiresAt || grant.expiresAt > now) &&
      ['viewer', 'operator', 'cluster-admin'].includes(grant.role) &&
      grant.namespaces.some(scope => scope.namespaceUid === namespace.uid && scope.namespaceName === namespace.name) &&
      grant.capabilities.some(item => item.capability === 'kubeconfig'));
    if (!grants.length) return [];
    const capabilities = new Set(grants.flatMap(grant => grant.capabilities.map(item => item.capability)));
    const rules = Object.entries(nativeReadResources).map(([api, resources]) => ({
      apiGroups: [api === '/api/v1' ? '' : api.split('/')[2]],
      resources: resources.filter(resource => resource !== 'secrets' || capabilities.has('secrets')),
      verbs: ['get', 'list', 'watch'],
    }));
    if (capabilities.has('logs')) rules.push({ apiGroups: [''], resources: ['pods/log'], verbs: ['get'] });
    if (capabilities.has('exec')) rules.push({ apiGroups: [''], resources: ['pods/exec'], verbs: ['get', 'create'] });
    // Workload writes remain denied until admission prevents SA/Secret escalation.
    const name = `kn-native-${digest(JSON.stringify([input.clusterId, input.userId, namespace.uid]))}`;
    const metadata = { name, namespace: namespace.name,
      labels: { 'app.kubernetes.io/managed-by': 'kubenova' },
      annotations: { 'kubenova.io/namespace-uid': namespace.uid, 'kubenova.io/cluster-id': input.clusterId } };
    return [{
      role: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata, rules },
      binding: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata,
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name },
        subjects: [{ apiGroup: 'rbac.authorization.k8s.io', kind: 'User', name: subject }] },
    }];
  });
}
