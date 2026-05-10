import { ClustersRepository } from './clusters.repository';

describe('ClustersRepository', () => {
  it('should request stable sort for list query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      clusterRegistry: {
        findMany,
      },
    };

    const repository = new ClustersRepository(prisma as never);
    await repository.list({ page: 1, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  });
});
