import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

function createService() {
  const prisma = {
    monitoringDataSource: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    monitoringAlertTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    monitoringNotificationTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  return { prisma, service: new ObservabilityService(prisma as never) };
}

describe('ObservabilityService', () => {
  it('lists configured sources and ignores empty environment defaults', async () => {
    const { service, prisma } = createService();
    process.env.OBSERVABILITY_PROMETHEUS_URL = 'http://prometheus:9090';
    const result = await service.listDataSources('cluster-a');
    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'prometheus', endpoint: 'http://prometheus:9090' }),
    ]);
    expect(prisma.monitoringDataSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ clusterId: 'cluster-a' }, { clusterId: null }] } }),
    );
    delete process.env.OBSERVABILITY_PROMETHEUS_URL;
  });

  it('rejects unsupported protocols and read-only writes', async () => {
    const { service } = createService();
    await expect(
      service.createDataSource({ username: 'viewer', role: 'read-only' }, {
        kind: 'prometheus', name: 'p', endpoint: 'file:///tmp/p',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createDataSource({ username: 'admin', role: 'platform-admin' }, {
        kind: 'prometheus', name: 'p', endpoint: 'file:///tmp/p',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a bounded unavailable result when a source cannot be reached', async () => {
    const { service } = createService();
    const result = await service.testEndpoint('grafana', 'http://127.0.0.1:1');
    expect(result.status).toBe('unavailable');
    expect(result.error).toBeTruthy();
  });
});
