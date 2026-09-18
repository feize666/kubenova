import { ForbiddenException } from '@nestjs/common';
import { WorkloadsService } from './workloads.service';
import { WorkloadsRepository } from './workloads.repository';
import { AuthorizationService } from '../common/authorization.service';
jest.mock('@kubernetes/client-node', () => ({}));

describe('workload grant boundaries', () => {
  const actor = { id: 'reader', role: 'user' as const };
  function setup(overrides = {}) {
    const grant = { id: 'g', userId: 'reader', groupId: null, clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid' }], capabilities: [], ...overrides };
    const prisma = { accessGrant: { findMany: jest.fn(async () => [grant]) }, groupMembership: { findMany: jest.fn(async () => []) }, workloadRecord: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) } };
    const repository = new WorkloadsRepository(prisma as any);
    jest.spyOn(repository, 'findById').mockResolvedValue({ id: 'w', clusterId: 'c', namespace: 'other', state: 'active' } as any);
    const access = { isPlatformAdmin: (subject: any) => subject?.role === 'admin', listAccessibleClusterIds: jest.fn(async () => []), assertCanRead: jest.fn(async () => ({ accessRole: 'viewer' })) };
    const identities = { resolve: jest.fn(async () => 'uid') };
    const service = new (WorkloadsService as any)(repository, {}, {}, {}, {}, { assertClusterOnlineForRead: async () => {}, listReadableClusterIdsForResourceRead: async () => ['c', 'foreign'] }, {}, {}, {}, {}, access, new AuthorizationService(prisma as any), identities) as WorkloadsService;
    return { service, prisma, repository, identities, grant, access };
  }
  it('applies namespace scope to both SQL list and count before pagination', async () => {
    const { service, prisma } = setup();
    await (service.list as any)({ page: '2', pageSize: '5' }, actor);
    const query = prisma.workloadRecord.findMany.mock.calls[0] as any;
    expect(query[0].where.AND).toEqual([{ OR: [{ clusterId: 'c', namespace: 'ai' }] }]);
    expect((prisma.workloadRecord.count.mock.calls[0] as any)[0].where).toEqual(query[0].where);
    expect(query[0].skip).toBe(5);
  });
  it.each([{ expiresAt: new Date(0) }, { revokedAt: new Date() }, { state: 'revoked' }])('excludes expired or revoked grants %j', async override => {
    const { service, prisma } = setup(override);
    expect((await (service.list as any)({}, actor)).items).toEqual([]);
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it('denies foreign record identity even if client requests another namespace', async () => {
    const { service } = setup();
    await expect((service.getById as any)('w', actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect((service.update as any)('w', { namespace: 'ai' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('denies viewer actions on an authorized namespace', async () => {
    const { service, repository } = setup();
    jest.spyOn(repository, 'findById').mockResolvedValue({ id: 'w', clusterId: 'c', namespace: 'ai', state: 'active' } as any);
    await expect((service.applyAction as any)('w', 'disable', undefined, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects stale namespace UID', async () => {
    const { service, identities, prisma } = setup();
    identities.resolve.mockResolvedValue('recreated');
    expect((await (service.list as any)({}, actor)).items).toEqual([]);
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it.each([{ clusterId: 'foreign' }, { clusterId: 'c', namespace: 'other' }])('never queries resources outside scope %j', async query => {
    const { service, prisma } = setup();
    expect(await service.list(query, actor)).toMatchObject({ items: [], total: 0 });
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it('allows a user with an operator grant to update its real record', async () => {
    const { service, repository } = setup({ role: 'operator' });
    const row = { id: 'w', clusterId: 'c', namespace: 'ai', state: 'active' } as any;
    jest.spyOn(repository, 'findById').mockResolvedValue(row);
    jest.spyOn(repository, 'update').mockResolvedValue(row);
    await expect(service.update('w', {}, actor)).resolves.toEqual(row);
    await expect(service.update('w', { namespace: 'other' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('uses active group membership and stops granting after it is removed', async () => {
    const { service, prisma } = setup({ userId: null, groupId: 'team' });
    (prisma.groupMembership.findMany as jest.Mock).mockResolvedValue([{ groupId: 'team' }]);
    await service.list({}, actor);
    expect((prisma.workloadRecord.findMany.mock.calls[0] as any)[0].where.AND).toEqual([{ OR: [{ clusterId: 'c', namespace: 'ai' }] }]);
    prisma.workloadRecord.findMany.mockClear();
    prisma.groupMembership.findMany.mockResolvedValue([]);
    await service.list({}, actor);
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it('retains platform admin and legacy cluster read access', async () => {
    const { service, prisma, access } = setup({ state: 'revoked' });
    (access.listAccessibleClusterIds as jest.Mock).mockResolvedValue(['c']);
    await service.list({}, actor);
    expect((prisma.workloadRecord.findMany.mock.calls[0] as any)[0].where.AND).toEqual([{ OR: [{ clusterId: 'c' }] }]);
    await service.list({}, { id: 'a', role: 'admin' });
    expect((prisma.workloadRecord.findMany.mock.calls[1] as any)[0].where.AND).toBeUndefined();
  });
  it('rejects missing HTTP identity rather than using internal access', async () => {
    const { service } = setup();
    await expect(service.list({}, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('preserves the legacy platform-role write ceiling without blocking a separate operator grant', async () => {
    const { service, repository, access, grant } = setup({ state: 'revoked' });
    (access.listAccessibleClusterIds as jest.Mock).mockResolvedValue(['c']);
    (access as any).assertCanMutate = jest.fn(async () => { throw new ForbiddenException(); });
    const row = { id: 'w', clusterId: 'c', namespace: 'ai', state: 'active' } as any;
    jest.spyOn(repository, 'findById').mockResolvedValue(row);
    jest.spyOn(repository, 'update').mockResolvedValue(row);
    access.assertCanRead.mockResolvedValue({ accessRole: 'operator' });
    await expect(service.update('w', {}, actor)).rejects.toBeInstanceOf(ForbiddenException);
    grant.state = 'active';
    grant.role = 'operator';
    await expect(service.update('w', {}, actor)).resolves.toEqual(row);
  });
});
