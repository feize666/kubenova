jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization.service';
import { NetworkService } from './network.service';
import { NetworkRepository } from './network.repository';
import { NetworkController } from './network.controller';

const actor = { id: 'alice', role: 'cluster-operator' };
const row = { id: 'cached', clusterId: 'c1', namespace: 'team', kind: 'Service', name: 'web', state: 'active' };
const grant = (role = 'operator', namespaceName = 'team', extra = {}) => ({
  id: 'g1', userId: 'alice', groupId: null, clusterId: 'c1', role, state: 'active',
  validFrom: new Date(0), expiresAt: null, revokedAt: null,
  namespaces: [{ namespaceName, namespaceUid: `uid-${namespaceName}` }], capabilities: [], ...extra,
});

function build(grants = [grant()]) {
  const repo = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    findById: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue(row),
    setState: jest.fn().mockResolvedValue(row), create: jest.fn().mockResolvedValue(row),
  };
  const health = { assertClusterOnlineForRead: jest.fn(), listReadableClusterIdsForResourceRead: jest.fn().mockResolvedValue(['c1', 'c2']) };
  const clusters = { getKubeconfig: jest.fn() };
  const access = { isPlatformAdmin: jest.fn().mockReturnValue(false), isKnownPlatformRole: jest.fn().mockReturnValue(true), listAccessibleClusterIds: jest.fn().mockResolvedValue([]), assertCanMutate: jest.fn() };
  const identity = { resolve: jest.fn().mockImplementation(async (_c, ns) => `uid-${ns}`) };
  const auth = new AuthorizationService({
    groupMembership: { findMany: jest.fn().mockResolvedValue([{ groupId: 'team-group' }]) },
    accessGrant: { findMany: jest.fn().mockResolvedValue(grants) },
  } as any);
  const api = { listNamespacedNetworkPolicy: jest.fn().mockImplementation(async ({ namespace }) => ({ items: [1, 2].map(n => ({ metadata: { name: `policy-${n}`, namespace }, spec: {} })) })), listNetworkPolicyForAllNamespaces: jest.fn(), deleteNamespacedNetworkPolicy: jest.fn() };
  const clients = { getCoreApi: jest.fn(), getDiscoveryApi: jest.fn(), getNetworkingApi: jest.fn().mockReturnValue(api), getCustomObjectsApi: jest.fn() };
  const service = new NetworkService(repo as any, health as any, clusters as any, {} as any, { consumeClusterDirty: () => false } as any, clients as any, access as any, auth, identity as any);
  return { service, repo, health, clusters, access, identity, api };
}

describe('Network resource authorization', () => {
  it('denies unknown platform roles even with an effective namespace grant', async () => {
    const { service, access, identity } = build();
    access.isKnownPlatformRole.mockReturnValue(false);
    await expect(service.getById('cached', { ...actor, role: 'unknown' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(identity.resolve).not.toHaveBeenCalled();
    expect(access.listAccessibleClusterIds).not.toHaveBeenCalled();
  });

  it.each([grant(), grant('viewer', 'team', { userId: null, groupId: 'team-group' })])('accepts effective direct/group grants for cached detail', async g => {
    const { service } = build([g]);
    await expect(service.getById('cached', actor)).resolves.toEqual(row);
  });

  it('filters cached queries using internal exact pairs, ignoring forged scope fields', async () => {
    const { service, repo } = build();
    await service.list({ scopes: [{ clusterId: 'c2' }], clusterIds: ['c2'] } as any, actor);
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ scopes: [{ clusterId: 'c1', namespace: 'team' }], clusterIds: ['c1'] }));
  });

  it.each([{ clusterId: 'c2' }, { clusterId: 'c1', namespace: 'other' }, { namespace: 'other' }])('rejects unauthorized explicit scope %j before cluster requests', async query => {
    const { service, health, clusters } = build();
    await expect(service.list(query, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(health.assertClusterOnlineForRead).not.toHaveBeenCalled();
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
  });

  it('returns empty for an unfiltered identity with no grants', async () => {
    const { service, repo } = build([]);
    await expect(service.list({}, actor)).resolves.toMatchObject({ items: [], total: 0 });
    expect(repo.list).not.toHaveBeenCalled();
  });

  it.each([
    grant('operator', 'team', { expiresAt: new Date(1) }),
    grant('operator', 'team', { revokedAt: new Date(1) }),
    grant('operator', 'team', { userId: null, groupId: 'foreign-group' }),
  ])('does not accept expired, revoked or unrelated grants', async g => {
    const { service } = build([g]);
    await expect(service.getById('cached', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns no resources when permitted clusters are offline', async () => {
    const { service, health, repo } = build();
    health.listReadableClusterIdsForResourceRead.mockResolvedValue(['c2']);
    await expect(service.list({}, actor)).resolves.toMatchObject({ total: 0, items: [] });
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('permits authorized live detail and delete', async () => {
    const { service, clusters, api } = build();
    clusters.getKubeconfig.mockResolvedValue('test-config');
    await expect(service.getById('live:c1:NetworkPolicy:team:policy-1', actor)).resolves.toMatchObject({ namespace: 'team' });
    await expect(service.applyAction('live:c1:NetworkPolicy:team:policy-1', { action: 'delete' }, actor)).resolves.toMatchObject({ item: { state: 'deleted' } });
    expect(api.deleteNamespacedNetworkPolicy).toHaveBeenCalledWith({ name: 'policy-1', namespace: 'team' });
  });

  it('denies stale namespace UID and failed live identity lookup', async () => {
    const { service, identity } = build();
    identity.resolve.mockResolvedValueOnce('recreated');
    await expect(service.getById('cached', actor)).rejects.toBeInstanceOf(ForbiddenException);
    identity.resolve.mockRejectedValueOnce(new Error('offline'));
    await expect(service.getById('cached', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('queries only permitted live namespaces and counts before pagination without duplicates', async () => {
    const { service, api, clusters } = build([grant(), grant()]);
    clusters.getKubeconfig.mockResolvedValue('test-config');
    const result = await service.list({ kind: 'NetworkPolicy', page: '2', pageSize: '1' }, actor);
    expect(result).toMatchObject({ total: 2, page: 2, items: [expect.objectContaining({ namespace: 'team' })] });
    expect(api.listNamespacedNetworkPolicy).toHaveBeenCalledTimes(1);
    expect(api.listNamespacedNetworkPolicy).toHaveBeenCalledWith({ namespace: 'team' });
    expect(api.listNetworkPolicyForAllNamespaces).not.toHaveBeenCalled();
  });

  it('denies cached and live ID mutations outside scope before fetching or writing Kubernetes', async () => {
    const { service, repo, clusters } = build();
    repo.findById.mockResolvedValue({ ...row, namespace: 'other' });
    await expect(service.getById('cached', actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getById('live:c1:NetworkPolicy:other:web', actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.applyAction('cached', { action: 'delete' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.applyAction('live:c1:NetworkPolicy:other:web', { action: 'delete' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create({ clusterId: 'c2', namespace: 'team', name: 'web', kind: 'Service' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
    expect(repo.setState).not.toHaveBeenCalled();
  });

  it('does not combine a viewer namespace with an operator grant elsewhere', async () => {
    const { service, repo } = build([grant('viewer'), grant('operator', 'other')]);
    await expect(service.update('cached', { labels: {} }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('retains platform read-only mutation denial despite an operator grant', async () => {
    const { service } = build();
    await expect(service.update('cached', {}, { ...actor, role: 'read-only' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects namespace relocation and allows an in-scope update', async () => {
    const { service, repo } = build();
    await expect(service.update('cached', { namespace: 'other' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
    await expect(service.update('cached', { labels: {} }, actor)).resolves.toMatchObject({ item: row });
  });

  it('preserves admin and legacy full-cluster reads', async () => {
    const { service, access } = build([]);
    access.isPlatformAdmin.mockReturnValueOnce(true);
    await expect(service.getById('cached', { ...actor, role: 'platform-admin' })).resolves.toEqual(row);
    access.listAccessibleClusterIds.mockResolvedValue(['c1']);
    await expect(service.getById('cached', actor)).resolves.toEqual(row);
    await expect(service.update('cached', {}, actor)).resolves.toMatchObject({ item: row });
  });

  it('never treats missing HTTP identity as an internal call', async () => {
    const { service } = build();
    const controller = new NetworkController(service, {} as any, {} as any);
    await expect(controller.list({}, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getById({}, 'cached')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('applies identical exact-pair predicates to database count and page queries', async () => {
    const db = { networkResource: { findMany: jest.fn(async (_args: any) => []), count: jest.fn(async (_args: any) => 2) } };
    const repository = new NetworkRepository(db as any);
    await repository.list({ page: 2, pageSize: 1, scopes: [{ clusterId: 'c1', namespace: 'team' }, { clusterId: 'c2', namespace: 'other' }] });
    const where = db.networkResource.count.mock.calls[0][0].where;
    expect(where.AND).toEqual([{ OR: [{ clusterId: 'c1', namespace: 'team' }, { clusterId: 'c2', namespace: 'other' }] }]);
    expect(db.networkResource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 1, take: 1 }));
  });
});
