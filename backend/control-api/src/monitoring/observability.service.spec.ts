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
  it('does not expose webhook secrets from transport errors', async () => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n', channel: 'webhook', endpoint: 'https://hooks.example/test?key=private-secret', bodyTemplate: '{}' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('failed https://hooks.example/test?key=private-secret'));
    try {
      const result = await service.testNotificationTemplate({ role: 'platform-admin' }, 'n');
      expect(result.success).toBe(false);
      expect(result.error).not.toContain('private-secret');
    } finally { globalThis.fetch = originalFetch; }
  });
  it.each(['file:///etc/passwd', 'not-a-url'])('rejects invalid saved notification endpoints %s before network access', async endpoint => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n', channel: 'webhook', endpoint, bodyTemplate: '{}' });
    const originalFetch = globalThis.fetch;
    const send = jest.fn().mockResolvedValue(new Response('{}'));
    globalThis.fetch = send;
    try {
      expect(await service.testNotificationTemplate({ role: 'platform-admin' }, 'n')).toMatchObject({ success: false, statusCode: null });
      expect(send).not.toHaveBeenCalled();
    } finally { globalThis.fetch = originalFetch; }
  });
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
      const result = await service.testNotificationTemplate({ role: 'platform-admin' }, 'n1');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(202);
      expect(globalThis.fetch).toHaveBeenCalledWith('https://hooks.example/test', expect.objectContaining({ method: 'POST' }));
    } finally { globalThis.fetch = originalFetch; }
  });
  it('does not report HTTP reachability as successful email delivery', async () => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'mail', channel: 'email', endpoint: 'https://mail.example', bodyTemplate: '{{message}}' });
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;
    try {
      expect(await service.testNotificationTemplate({ role: 'platform-admin' }, 'mail')).toMatchObject({ success: false, statusCode: null });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { globalThis.fetch = originalFetch; }
  });
  it.each([302, 400, 429, 500])('does not automatically repeat a notification POST after HTTP %s', async status => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n', channel: 'webhook', endpoint: 'https://hooks.example/test', bodyTemplate: '{}' });
    const originalFetch = globalThis.fetch;
    const send = jest.fn().mockResolvedValue(new Response('{}', { status }));
    globalThis.fetch = send;
    try {
      expect(await service.testNotificationTemplate({ role: 'platform-admin' }, 'n')).toMatchObject({ success: false, statusCode: status });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('https://hooks.example/test', expect.objectContaining({ redirect: 'manual' }));
    } finally { globalThis.fetch = originalFetch; }
  });
  it.each([
    ['feishu', { code: 0 }, true],
    ['feishu', { code: 19001 }, false],
    ['dingtalk', { errcode: 0 }, true],
    ['dingtalk', { errcode: 310000 }, false],
    ['wecom', { errcode: 0 }, true],
    ['wecom', {}, false],
  ])('checks business delivery status for %s: %j', async (channel, body, success) => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n', channel, endpoint: 'https://hooks.example/test', bodyTemplate: '{}' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(Response.json(body));
    try { expect(await service.testNotificationTemplate({ role: 'platform-admin' }, 'n')).toMatchObject({ success, statusCode: 200 }); }
    finally { globalThis.fetch = originalFetch; }
  });
  it.each([
    ['slack', 'ok', true], ['slack', 'invalid_payload', false],
    ['pagerduty', '{"status":"success"}', true], ['pagerduty', '{"status":"invalid event"}', false],
  ])('validates %s provider response %s', async (channel, body, success) => {
    const { service, prisma } = createService();
    prisma.monitoringNotificationTemplate.findUnique.mockResolvedValue({ id: 'n', channel, endpoint: 'https://hooks.example/test', bodyTemplate: '{}' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(body));
    try { expect(await service.testNotificationTemplate({ role: 'platform-admin' }, 'n')).toMatchObject({ success, statusCode: 200 }); }
    finally { globalThis.fetch = originalFetch; }
  });
});
