jest.mock('@kubernetes/client-node', () => ({}));
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { StorageRepository } from './storage.repository';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';

const actor = { id: 'user', role: 'cluster-operator' as const };
function build(group = false) {
  const item = { id: 'pvc', clusterId: 'c1', namespace: 'team', kind: 'PVC', state: 'active', name: 'data' };
  const repository = { list: jest.fn().mockResolvedValue({ items: [], total: 0 }), findById: jest.fn().mockResolvedValue(item), update: jest.fn(), create: jest.fn(), setState: jest.fn() };
  const health = { assertClusterOnlineForRead: jest.fn(), listReadableClusterIdsForResourceRead: jest.fn().mockResolvedValue(['c1', 'c2']) };
  const clusters = { getKubeconfig: jest.fn().mockResolvedValue('config') };
  const readNamespace = jest.fn().mockResolvedValue({ metadata: { uid: 'uid-team' } });
  const clients = { getCoreApi: jest.fn().mockReturnValue({ readNamespace }) };
  const access = { isPlatformAdmin: (a: any) => a.role === 'platform-admin', isKnownPlatformRole: (a: any) => ['platform-admin', 'cluster-operator', 'read-only'].includes(a.role), listAccessibleClusterIds: jest.fn().mockResolvedValue([]), assertCanMutate: jest.fn() };
  const grant = { id: 'g1', userId: group ? null : 'user', groupId: group ? 'group' : null, clusterId: 'c1', role: 'operator', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceName: 'team', namespaceUid: 'uid-team' }], capabilities: [] };
  const prisma = { accessGrant: { findMany: jest.fn().mockResolvedValue([grant]) }, groupMembership: { findMany: jest.fn().mockResolvedValue(group ? [{ groupId: 'group' }] : []) } };
  const sync = { syncCluster: jest.fn().mockResolvedValue({ errors: [] }) };
  const service = new (StorageService as any)(repository, clusters, clients, sync, health, { consumeClusterDirty: () => false }, access, new AuthorizationService(prisma as any), new NamespaceIdentityService(clusters as any, clients as any));
  return { service, repository, health, clusters, readNamespace, access, grant, item, sync };
}

describe('Storage authorization', () => {
  it('rejects an unknown platform role before resolving grants or live identity', async () => {
    const { service, readNamespace, access } = build();
    await expect(service.list({ sync: 'false' }, { id: 'user', role: 'unknown' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.listAccessibleClusterIds).not.toHaveBeenCalled();
    expect(readNamespace).not.toHaveBeenCalled();
  });
  it('denies missing identity before health or sync probing', async () => {
    const { service, health, sync } = build();
    await expect(service.list({ clusterId: 'c1' }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(health.assertClusterOnlineForRead).not.toHaveBeenCalled();
    expect(sync.syncCluster).not.toHaveBeenCalled();
  });
  it.each([false, true])('applies effective direct/group grant pairs before pagination (%s)', async group => {
    const { service, repository } = build(group);
    await service.list({ page: '2', sync: 'false', scopes: [{ clusterId: 'c2' }], clusterIds: ['c2'] }, actor);
    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, clusterIds: ['c1'], scopes: [{ clusterId: 'c1', namespace: 'team' }] }));
  });
  it.each([{ clusterId: 'c2' }, { clusterId: 'c1', namespace: 'other' }, { clusterId: 'c1', kind: 'PV' }])('denies explicit unauthorized filters %j', async query => {
    const { service, health, sync } = build();
    await expect(service.list(query, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(health.assertClusterOnlineForRead).not.toHaveBeenCalled();
    expect(sync.syncCluster).not.toHaveBeenCalled();
  });
  it('fails closed for a recreated namespace', async () => {
    const { service, readNamespace } = build();
    readNamespace.mockResolvedValue({ metadata: { uid: 'new-uid' } });
    await expect(service.getById('pvc', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['PV', 'SC'])('does not grant cluster-scoped %s via a namespace grant', async kind => {
    const { service, item } = build(); item.kind = kind;
    await expect(service.getById('pvc', actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('denies viewer mutations and namespace relocation without writes', async () => {
    const { service, grant, repository } = build();
    await expect(service.update('pvc', { namespace: 'other' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    grant.role = 'viewer';
    await expect(service.applyAction('pvc', { action: 'delete' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update('pvc', {}, { ...actor, role: 'read-only' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it('preserves internal/admin and legacy full-cluster reads', async () => {
    const { service, item, access } = build(); item.kind = 'PV';
    expect(await service.getById('pvc')).toBe(item);
    expect(await service.getById('pvc', { ...actor, role: 'platform-admin' })).toBe(item);
    access.listAccessibleClusterIds.mockResolvedValue(['c1']);
    expect(await service.getById('pvc', actor)).toBe(item);
  });
  it('does not sync clusters outside the grant', async () => {
    const { service, sync } = build();
    await service.list({ sync: 'foreground' }, actor);
    expect(sync.syncCluster).toHaveBeenCalledTimes(1);
    expect(sync.syncCluster).toHaveBeenCalledWith('c1', 'config');
  });
  it('denies out-of-scope creates before contacting the target cluster', async () => {
    const { service, clusters, repository } = build();
    await expect(service.create({ clusterId: 'c2', kind: 'PVC', namespace: 'team', name: 'data' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(clusters.getKubeconfig).not.toHaveBeenCalledWith('c2');
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('permits an operator grant to update only the stored namespace', async () => {
    const { service, repository, item } = build();
    repository.update.mockResolvedValue({ ...item, capacity: '2Gi' });
    const result = await service.update('pvc', { capacity: '2Gi' }, actor);
    expect(result.item.capacity).toBe('2Gi');
    expect(repository.update).toHaveBeenCalledWith('pvc', { capacity: '2Gi' });
  });
  it('returns an empty page without health probing for no effective grants', async () => {
    const { service, grant, health, repository } = build(); grant.state = 'revoked';
    const result = await service.list({ page: '3', pageSize: '4', sync: 'foreground' }, actor);
    expect(result).toMatchObject({ items: [], total: 0, page: 3, pageSize: 4 });
    expect(health.listReadableClusterIdsForResourceRead).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('public reads fail closed when the request lacks an identity', async () => {
    const { service } = build();
    const controller = new StorageController(service, {} as any, {} as any);
    await expect(controller.list({}, { sync: 'false' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getById({}, 'pvc')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await controller.getById({ user: { user: actor } }, 'pvc')).toMatchObject({ id: 'pvc' });
  });
});

it('uses exact PVC pairs and full-cluster scopes in both SQL queries', async () => {
  const prisma = { storageResource: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
  await new StorageRepository(prisma as any).list({ page: 2, pageSize: 5, scopes: [{ clusterId: 'c1', namespace: 'team' }, { clusterId: 'c2' }] } as any);
  const where = { state: { not: 'deleted' }, cluster: { deletedAt: null, status: { not: 'deleted' } }, OR: [{ clusterId: 'c1', namespace: 'team', kind: 'PVC' }, { clusterId: 'c2' }] };
  expect(prisma.storageResource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 5, take: 5 }));
  expect(prisma.storageResource.count).toHaveBeenCalledWith({ where });
});
