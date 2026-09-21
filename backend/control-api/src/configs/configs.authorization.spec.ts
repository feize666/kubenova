jest.mock('@kubernetes/client-node', () => ({}));
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigsService } from './configs.service';
import { AuthorizationService } from '../common/authorization.service';
import { ClusterAccessService } from '../common/cluster-access.service';
import { ConfigsRepository } from './configs.repository';
import { ConfigsController } from './configs.controller';

const actor = { id: 'u', role: 'cluster-operator' as const };
const config = {
  id: 'x',
  clusterId: 'a',
  namespace: 'ns',
  kind: 'Secret',
  state: 'active',
};
function build() {
  const grants: any[] = [];
  const prisma = {
    groupMembership: { findMany: jest.fn().mockResolvedValue([]) },
    accessGrant: { findMany: jest.fn(async () => grants) },
    clusterRoleBinding: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const repository = {
    list: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    findById: jest.fn().mockResolvedValue(config),
    getRevisions: jest.fn().mockResolvedValue([]),
    getRevision: jest.fn().mockResolvedValue({ data: {} }),
    create: jest.fn(),
    update: jest.fn(),
    rollback: jest.fn(),
    setState: jest.fn(),
    findByKey: jest.fn(),
  };
  const identities = { resolve: jest.fn().mockResolvedValue('uid') };
  const service = new (ConfigsService as any)(
    repository,
    {
      listReadableClusterIdsForResourceRead: jest
        .fn()
        .mockResolvedValue(['a', 'foreign']),
      assertClusterOnlineForRead: jest.fn(),
    },
    { getKubeconfig: jest.fn() },
    {},
    { consumeClusterDirty: () => false },
    {},
    new ClusterAccessService(prisma as any),
    new AuthorizationService(prisma as any),
    identities,
  );
  function grant(extra = {}) {
    grants.push({
      id: 'g',
      userId: 'u',
      groupId: null,
      clusterId: 'a',
      role: 'operator',
      state: 'active',
      validFrom: new Date(0),
      expiresAt: null,
      revokedAt: null,
      namespaces: [{ namespaceName: 'ns', namespaceUid: 'uid' }],
      capabilities: [],
      ...extra,
    });
  }
  return { service, repository, identities, grant, prisma };
}

describe('configuration authorization boundary', () => {
  it('does not leak online foreign clusters or trust forged scopes', async () => {
    const { service, repository, grant } = build();
    grant();
    await service.list(
      { clusterIds: ['foreign'], scopes: [{ clusterId: 'foreign' }] },
      actor,
    );
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterIds: ['a'],
        scopes: [{ clusterId: 'a', namespace: 'ns', kind: 'ConfigMap' }],
      }),
    );
  });
  it('returns no rows or count without grants', async () => {
    const { service, repository } = build();
    expect(await service.list({ page: '2', pageSize: '7' }, actor)).toEqual(
      expect.objectContaining({ items: [], total: 0, page: 2, pageSize: 7 }),
    );
    expect(repository.list).not.toHaveBeenCalled();
  });
  it.each([
    'getById',
    'getRevisions',
    'getRevisionDiff',
    'rollback',
    'update',
    'applyAction',
  ])('denies Secret %s before revision or mutation effects', async (method) => {
    const { service, repository, grant } = build();
    grant();
    const args: Record<string, any[]> = {
      getById: ['x', actor],
      getRevisions: ['x', actor],
      getRevisionDiff: ['x', 1, 2, actor],
      rollback: ['x', 1, undefined, actor],
      update: ['x', {}, actor],
      applyAction: ['x', { action: 'disable' }, actor],
    };
    await expect(service[method](...args[method])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.getRevisions).not.toHaveBeenCalled();
    expect(repository.getRevision).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.rollback).not.toHaveBeenCalled();
    expect(repository.setState).not.toHaveBeenCalled();
  });
  it('never combines a viewer capability with another operator grant', async () => {
    const { service, grant } = build();
    grant();
    grant({ role: 'viewer', capabilities: [{ capability: 'secrets' }] });
    await expect(
      service.applyAction('x', { action: 'disable' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires a current UID and effective grant', async () => {
    const { service, grant, identities } = build();
    grant({ capabilities: [{ capability: 'secrets' }] });
    identities.resolve.mockResolvedValue('recreated');
    await expect(service.getRevisions('x', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each([
    undefined,
    {},
    { id: 'u', role: 'invented' },
    { role: 'platform-admin' },
  ])('fails closed for missing or unknown identity %j', async (subject) => {
    const { service, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }] });
    await expect(service.list({}, subject)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each([
    { expiresAt: new Date(0) },
    { revokedAt: new Date() },
    { state: 'revoked' },
    { validFrom: new Date('2999-01-01') },
    { role: 'invented' },
    { userId: 'someone-else' },
  ])('rejects ineffective direct grants %j', async (extra) => {
    const { service, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }], ...extra });
    await expect(service.getRevisions('x', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('accepts a current group grant but loses access when membership disappears', async () => {
    const { service, grant, prisma } = build();
    grant({
      userId: null,
      groupId: 'g',
      capabilities: [{ capability: 'secrets' }],
    });
    prisma.groupMembership.findMany.mockResolvedValue([{ groupId: 'g' }]);
    expect((await service.getRevisions('x', actor)).total).toBe(0);
    prisma.groupMembership.findMany.mockResolvedValue([]);
    await expect(service.getRevisions('x', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each([
    { clusterId: 'b' },
    { namespaces: [{ namespaceName: 'other', namespaceUid: 'uid' }] },
  ])('does not authorize another resource scope %j', async (extra) => {
    const { service, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }], ...extra });
    await expect(service.getById('x', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('keeps legacy ConfigMap access but never inherits Secret capability', async () => {
    const { service, repository, prisma } = build();
    prisma.clusterRoleBinding.findMany.mockResolvedValue([{ clusterId: 'a' }]);
    await expect(service.getById('x', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    repository.findById.mockResolvedValue({ ...config, kind: 'ConfigMap' });
    expect((await service.getById('x', actor)).kind).toBe('ConfigMap');
  });
  it('allows Secret reads and writes with the same capable operator grant', async () => {
    const { service, repository, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }] });
    repository.setState.mockResolvedValue(config);
    expect((await service.getById('x', actor)).revisions).toEqual([]);
    expect(
      (await service.applyAction('x', { action: 'disable' }, actor)).item.id,
    ).toBe('x');
    expect((await service.getRevisionDiff('x', 1, 2, actor)).diff).toEqual({});
    repository.rollback.mockResolvedValue(config);
    expect((await service.rollback('x', 1, 'name', actor)).item.id).toBe('x');
    expect(repository.rollback).toHaveBeenCalledWith('x', 1, 'name');
  });
  it('retains administrator Secret access', async () => {
    const { service } = build();
    expect(
      (await service.getById('x', { id: 'admin', role: 'platform-admin' }))
        .kind,
    ).toBe('Secret');
  });
  it('denies unauthorized create before duplicate lookup or cluster effects', async () => {
    const { service, repository, grant } = build();
    grant();
    await expect(
      service.create({ ...config, name: 'secret' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findByKey).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('retains platform read-only mutation restrictions', async () => {
    const { service, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }] });
    await expect(
      service.applyAction(
        'x',
        { action: 'disable' },
        { ...actor, role: 'read-only' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects namespace relocation before writing', async () => {
    const { service, repository, grant } = build();
    grant({ capabilities: [{ capability: 'secrets' }] });
    await expect(
      service.update('x', { namespace: 'other' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, 0, -1, 1.5, '1', null])(
    'rejects malformed revision %j as HTTP 400',
    async (revision) => {
      const { service, repository } = build();
      await expect(
        service.getRevisionDiff('x', revision, 1, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rollback('x', revision, undefined, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.getRevision).not.toHaveBeenCalled();
    },
  );
});

describe('configuration persistence authorization filters', () => {
  it('uses exact scope conjunctions for both rows and count before pagination', async () => {
    const prisma = {
      configResource: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    await new ConfigsRepository(prisma as any).list({
      page: 2,
      pageSize: 7,
      scopes: [{ clusterId: 'a', namespace: 'ns', kind: 'Secret' }],
    });
    const where = {
      state: { not: 'deleted' },
      cluster: { deletedAt: null, status: { not: 'deleted' } },
      AND: [{ OR: [{ clusterId: 'a', namespace: 'ns', kind: 'Secret' }] }],
    };
    expect(prisma.configResource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 7, take: 7 }),
    );
    expect(prisma.configResource.count).toHaveBeenCalledWith({ where });
  });
  it('does not eagerly fetch revisions during authorization lookup', async () => {
    const prisma = {
      configResource: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await new ConfigsRepository(prisma as any).findById('x', false);
    expect(prisma.configResource.findUnique).toHaveBeenCalledWith({
      where: { id: 'x' },
      include: { revisions: false },
    });
  });
});

describe('configuration HTTP actor and revision boundary', () => {
  it('always forwards an actor object for read endpoints', async () => {
    const service = {
      list: jest.fn(),
      getById: jest.fn(),
      getRevisions: jest.fn(),
      getRevisionDiff: jest.fn(),
    };
    const controller = new ConfigsController(
      service as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await controller.list({}, {});
    await controller.getById({}, 'x');
    await controller.getRevisions({}, 'x');
    await controller.getRevisionDiff({}, 'x', '1', '2');
    expect(service.list).toHaveBeenCalledWith({}, {});
    expect(service.getById).toHaveBeenCalledWith('x', {});
    expect(service.getRevisions).toHaveBeenCalledWith('x', {});
    expect(service.getRevisionDiff).toHaveBeenCalledWith('x', 1, 2, {});
  });
  it.each(['1x', '1.5', '', '-1'])(
    'rejects malformed HTTP revision %j',
    async (revision) => {
      const controller = new ConfigsController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      await expect(
        controller.getRevisionDiff({}, 'x', revision, '2'),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
