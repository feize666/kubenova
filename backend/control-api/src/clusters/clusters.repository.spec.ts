import { ClustersRepository } from './clusters.repository';

describe('ClustersRepository', () => {
  it('sorts online clusters by name before slicing pages, retaining authorization scope', async () => {
    const now = new Date('2026-10-16T00:00:00Z');
    const row = (id: string, name: string, status: string) => ({
      id, name, apiServer: '', status: 'active', metadata: { kubeconfig: 'fixture' },
      deletedAt: null, createdAt: now, updatedAt: now, healthSnapshot: { status },
    });
    const findMany = jest.fn().mockResolvedValue([
      row('offline', 'A-offline', 'offline'),
      row('online-z', 'Z-online', 'running'),
      row('online-a', 'A-online', 'running'),
    ]);
    const repository = new ClustersRepository({ clusterRegistry: { findMany } } as never);
    const first = await repository.list({ page: 1, pageSize: 2, sortBy: 'runtimeStatus', accessibleClusterIds: ['offline', 'online-z', 'online-a'] });
    const second = await repository.list({ page: 2, pageSize: 2, sortBy: 'runtimeStatus', accessibleClusterIds: ['offline', 'online-z', 'online-a'] });
    expect(first.items.map(item => item.id)).toEqual(['online-a', 'online-z']);
    expect(second.items.map(item => item.id)).toEqual(['offline']);
    expect(first.total).toBe(3);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['offline', 'online-z', 'online-a'] } }),
      include: { healthSnapshot: { select: { status: true } } },
    }));
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('skip');
  });

  it('should request stable sort for list query', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      clusterRegistry: {
        count,
        findMany,
      },
    };

    const repository = new ClustersRepository(prisma as never);
    await repository.list({ page: 1, pageSize: 10 });

    expect(count).toHaveBeenCalledWith({
      where: { deletedAt: null, status: { not: 'deleted' } },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, status: { not: 'deleted' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 0,
      take: 10,
    });
  });

  it('constrains both count and rows to the accessible cluster ids', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new ClustersRepository({
      clusterRegistry: { count, findMany },
    } as never);

    await repository.list({
      page: 1,
      pageSize: 10,
      accessibleClusterIds: ['cluster-a'],
    });

    const expectedWhere = {
      id: { in: ['cluster-a'] },
      deletedAt: null,
      status: { not: 'deleted' },
    };
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });
});
