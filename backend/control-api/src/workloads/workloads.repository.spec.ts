import { WorkloadsRepository } from './workloads.repository';
import type { PrismaService } from '../platform/database/prisma.service';

describe('WorkloadsRepository list projection', () => {
  function build() {
    const prisma = {
      workloadRecord: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;
    return {
      repository: new WorkloadsRepository(prisma),
      workloadRecord: (
        prisma as unknown as {
          workloadRecord: {
            findMany: jest.Mock;
            count: jest.Mock;
          };
        }
      ).workloadRecord,
    };
  }

  it('keeps default list query full-width', async () => {
    const { repository, workloadRecord } = build();

    await repository.list({});

    expect(workloadRecord.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ select: expect.any(Object) }),
    );
  });

  it('uses slim select for topology projection', async () => {
    const { repository, workloadRecord } = build();

    await repository.list({ projection: 'topology' });

    const args = workloadRecord.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      clusterId: true,
      namespace: true,
      kind: true,
      name: true,
      state: true,
      replicas: true,
      readyReplicas: true,
      statusJson: true,
      labels: true,
      createdAt: true,
      updatedAt: true,
    });
    expect(args.select).not.toHaveProperty('spec');
    expect(args.select).not.toHaveProperty('annotations');
  });
});
