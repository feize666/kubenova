import { ClustersRepository } from './clusters.repository';

describe('ClustersRepository', () => {
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
