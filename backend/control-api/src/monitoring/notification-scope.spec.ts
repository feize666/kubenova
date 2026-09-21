import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ObservabilityService } from './observability.service';
import { ObservabilityController } from './observability.controller';
import { ClusterAccessService } from '../common/cluster-access.service';

const admin = { role: 'platform-admin' };
const input = { name: 'channel', channel: 'webhook', endpoint: 'https://hooks.example', bodyTemplate: '{}', secretRef: 'secret', enabled: false };

function setup() {
  const rows = [null, 'a', 'b'].map((clusterId, index) => ({
    ...input, id: String(index), clusterId, version: 3,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
  }));
  const table = {
    findMany: jest.fn(async ({ where }) => rows.filter(row => !where || row.clusterId === where.clusterId)),
    findUnique: jest.fn(async ({ where }) => rows.find(row => row.id === where.id)),
    create: jest.fn(async ({ data }) => ({ ...rows[0], ...data, clusterId: data.cluster?.connect.id ?? null })),
    update: jest.fn(async ({ where, data }) => ({ ...rows.find(row => row.id === where.id), ...data, version: 4 })),
    delete: jest.fn(async () => ({})),
  };
  const prisma = { monitoringNotificationTemplate: table, clusterRegistry: {
    findFirst: jest.fn(async ({ where }) => ['a', 'b'].includes(where.id) ? { id: where.id } : null),
  } };
  return { table, prisma, service: new ObservabilityService(prisma as never) as any };
}

describe('notification scope boundaries', () => {
  it('creates email recipients and validates channel conversions before writing', async () => {
    const { service, table } = setup();
    expect(await service.createNotificationTemplate(admin, { ...input, channel: 'email', endpoint: 'ops@example.com' })).toMatchObject({ channel: 'email', endpoint: 'ops@example.com' });
    await expect(service.updateNotificationTemplate(admin, '0', { channel: 'email' })).rejects.toBeInstanceOf(BadRequestException);
    expect(table.update).not.toHaveBeenCalled();
    expect(await service.updateNotificationTemplate(admin, '0', { channel: 'email', endpoint: 'ops@example.com' })).toMatchObject({ channel: 'email', endpoint: 'ops@example.com' });
    await expect(service.createNotificationTemplate(admin, { ...input, channel: 'email', endpoint: 'ops@example.com\r\nBcc: other@example.com' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([[undefined, '0', null], ['a', '1', 'a'], ['b', '2', 'b']])('lists only exact scope %s with existing fields intact', async (scope, id, clusterId) => {
    const { service } = setup();
    const result = await service.listNotificationTemplates(admin, scope);
    expect(result.items).toEqual([expect.objectContaining({ ...input, id, clusterId, version: 3, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' })]);
  });

  it.each(['a', 'b', undefined])('creates in scope %s', async clusterId => {
    const { service } = setup();
    expect(await service.createNotificationTemplate(admin, { ...input, clusterId })).toMatchObject({ ...input, clusterId: clusterId ?? null });
  });

  it.each(['update', 'delete', 'test'])('rejects cross-scope %s without writes or network', async action => {
    const { service, table } = setup();
    const send = jest.spyOn(globalThis, 'fetch');
    try {
      for (const [id, scope] of [['1', 'b'], ['1', undefined], ['0', 'a']]) {
        const args = action === 'update' ? [admin, id, { name: 'changed' }, scope] : [admin, id, scope];
        await expect(service[`${action}NotificationTemplate`](...args)).rejects.toBeInstanceOf(NotFoundException);
      }
      expect(table.update).not.toHaveBeenCalled();
      expect(table.delete).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally { send.mockRestore(); }
  });

  it.each(['list', 'create', 'update', 'delete', 'test'])('checks actor before any %s access', async action => {
    const { service, table, prisma } = setup();
    const args = action === 'list' ? [42] : action === 'create' ? [{ ...input, clusterId: 42 }] : action === 'update' ? ['1', {}, 42] : ['1', 42];
    await expect(service[`${action}NotificationTemplate${action === 'list' ? 's' : ''}`]({ role: 'cluster-operator' }, ...args)).rejects.toBeInstanceOf(ForbiddenException);
    expect(table.findMany).not.toHaveBeenCalled();
    expect(table.findUnique).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
    expect(prisma.clusterRegistry.findFirst).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 42, null, ['a'], {}])('rejects malformed scope %j', async scope => {
    const { service, table } = setup();
    await expect(service.listNotificationTemplates(admin, scope)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createNotificationTemplate(admin, { ...input, clusterId: scope })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateNotificationTemplate(admin, '0', {}, scope)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteNotificationTemplate(admin, '0', scope)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.testNotificationTemplate(admin, '0', scope)).rejects.toBeInstanceOf(BadRequestException);
    expect(table.findMany).not.toHaveBeenCalled();
    expect(table.findUnique).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
  });

  it('rejects missing clusters and immutable-scope updates', async () => {
    const { service, table } = setup();
    await expect(service.listNotificationTemplates(admin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createNotificationTemplate(admin, { ...input, clusterId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteNotificationTemplate(admin, '1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.testNotificationTemplate(admin, '1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateNotificationTemplate(admin, '1', { clusterId: 'b' }, 'a')).rejects.toBeInstanceOf(BadRequestException);
    expect(table.update).not.toHaveBeenCalled();
    expect(table.create).not.toHaveBeenCalled();
  });

  it('updates and deletes matching scopes', async () => {
    const { service, table } = setup();
    expect(await service.updateNotificationTemplate(admin, '1', { name: 'changed' }, 'a')).toMatchObject({ name: 'changed', clusterId: 'a', secretRef: 'secret', enabled: false, version: 4 });
    expect(await service.deleteNotificationTemplate(admin, '2', 'b')).toEqual({ id: '2', deleted: true });
    expect(table.delete).toHaveBeenCalledWith({ where: { id: '2' } });
  });

  it('tests only the requested matching channel', async () => {
    const { service } = setup();
    const send = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
    try {
      expect(await service.testNotificationTemplate(admin, '1', 'a')).toMatchObject({ id: '1', success: true, statusCode: 202 });
      expect(send).toHaveBeenCalledTimes(1);
    } finally { send.mockRestore(); }
  });

  it.each(['list', 'create', 'update', 'delete', 'test'])('controller denies ordinary users before %s delegation', action => {
    const method = `${action}NotificationTemplate${action === 'list' ? 's' : ''}`;
    const service = { [method]: jest.fn() };
    const controller = new ObservabilityController(service as never, new ClusterAccessService({} as never)) as any;
    expect(() => controller[method]({ user: { user: { role: 'cluster-operator' } } }, '1', {})).toThrow(ForbiddenException);
    expect(service[method]).not.toHaveBeenCalled();
  });

  it('controller carries query scope to list and mutations', async () => {
    const { service, prisma, table } = setup();
    const controller = new ObservabilityController(service, new ClusterAccessService(prisma as never));
    const req = { user: { user: { role: 'platform-admin' as const } } };
    expect((await controller.listNotificationTemplates(req, 'a')).items[0].id).toBe('1');
    expect(await controller.updateNotificationTemplate(req, '1', { name: 'changed' }, 'a')).toMatchObject({ name: 'changed', clusterId: 'a' });
    await expect(controller.deleteNotificationTemplate(req, '1', 'b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.testNotificationTemplate(req, '1', 'b')).rejects.toBeInstanceOf(NotFoundException);
    expect(table.delete).not.toHaveBeenCalled();
  });
});
