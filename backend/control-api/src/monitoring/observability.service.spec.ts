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

  it('validates Grafana panel metadata before persisting a source', async () => {
    const { service, prisma } = createService();

    await expect(
      service.createDataSource({ username: 'admin', role: 'platform-admin' }, {
        kind: 'grafana',
        name: 'grafana',
        endpoint: 'https://grafana.example',
        metadata: { dashboardUid: 'not safe/uid', panelId: 0 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.monitoringDataSource.create).not.toHaveBeenCalled();
  });

  it('returns a cluster-scoped safe Grafana embed URL without secrets', async () => {
    const { service, prisma } = createService();
    prisma.monitoringDataSource.findMany.mockResolvedValue([
      {
        id: 'grafana-a',
        clusterId: 'cluster-a',
        kind: 'grafana',
        name: 'grafana',
        endpoint: 'https://grafana.example',
        secretRef: 'monitoring/grafana-token',
        enabled: true,
        status: 'unknown',
        lastCheckedAt: null,
        lastError: null,
        metadata: {
          dashboardUid: 'kubenova',
          panelId: 7,
          defaultTimeRange: '24h',
          theme: 'dark',
          variableMapping: { cluster: '$clusterId' },
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    process.env.OBSERVABILITY_GRAFANA_ALLOWED_ORIGINS = 'https://grafana.example';

    try {
      const result = await service.getGrafanaPanelConfiguration('cluster-a', '24h');
      expect(result.available).toBe(true);
      expect(result.embedUrl).toContain('/d-solo/kubenova');
      expect(result.embedUrl).toContain('panelId=7');
      expect(result.embedUrl).toContain('var-cluster=cluster-a');
      expect(result).not.toHaveProperty('secretRef');
      expect(result).not.toHaveProperty('token');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OBSERVABILITY_GRAFANA_ALLOWED_ORIGINS;
    }
  });

  it('returns an unavailable state when Grafana is not configured', async () => {
    const { service } = createService();
    const result = await service.getGrafanaPanelConfiguration('cluster-a', '1h');
    expect(result.available).toBe(false);
    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/未配置/);
    expect(result.embedUrl).toBeNull();
  });

  it('sends a rendered test notification and reports delivery status', async () => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n1', channel: 'webhook', endpoint: 'https://hooks.example/test', bodyTemplate: '{"title":"{{title}}","message":"{{message}}"}' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 202 })) as never;
    try {
      const result = await service.testNotificationTemplate('n1');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(202);
      expect(globalThis.fetch).toHaveBeenCalledWith('https://hooks.example/test', expect.objectContaining({ method: 'POST' }));
    } finally { globalThis.fetch = originalFetch; }
  });
});
