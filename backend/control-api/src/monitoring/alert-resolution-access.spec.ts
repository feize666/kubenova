jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { AuthorizationService } from '../common/authorization.service';

function setup(clusterId: string | null = 'a', binding = true) {
  const row = { id: 'alert', clusterId, namespace: 'default', severity: 'warning', title: 'Alert', message: 'Test', source: 'prometheus', resourceType: 'Pod', resourceName: 'pod', status: 'firing', firedAt: new Date(), resolvedAt: null };
  const prisma = {
    monitoringAlert: {
      findUnique: jest.fn(async () => row),
      update: jest.fn(async ({ data }) => ({ ...row, ...data })),
    },
    clusterRegistry: { findFirst: jest.fn(async () => ({ id: 'a' })) },
    clusterRoleBinding: { findFirst: jest.fn(async () => binding ? { clusterId: 'a', role: 'operator' } : null), findMany: async () => binding ? [{ clusterId: 'a' }] : [] },
    accessGrant: { findMany: async () => [] },
    groupMembership: { findMany: async () => [] },
  };
  return { prisma, service: new MonitoringService(prisma as never, {} as never, {} as never, undefined, undefined, new AuthorizationService(prisma as never), { resolve: async () => 'uid' } as never) };
}

describe('alert resolution authorization', () => {
  it.each([undefined, { id: 'u', role: 'user' }])('denies read-only or absent identity before writes', async actor => {
    const { service, prisma } = setup();
    await expect((service.resolveAlert as any)('alert', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.monitoringAlert.update).not.toHaveBeenCalled();
  });
  it('denies an operator without access to the alert cluster', async () => {
    const { service, prisma } = setup('a', false);
    await expect((service.resolveAlert as any)('alert', { id: 'u', role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.monitoringAlert.update).not.toHaveBeenCalled();
  });
  it('denies non-admin resolution of platform or orphaned alerts', async () => {
    const { service, prisma } = setup(null);
    await expect((service.resolveAlert as any)('alert', { id: 'u', role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.monitoringAlert.update).not.toHaveBeenCalled();
  });
  it('allows a bound operator through the HTTP controller identity', async () => {
    const { service, prisma } = setup();
    const controller = new MonitoringController(service);
    const result = await (controller.resolveAlert as any)('alert', { user: { user: { id: 'u', role: 'operator' } } });
    expect(result.status).toBe('resolved');
    expect(prisma.clusterRoleBinding.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u', clusterId: 'a' }) }));
  });
});
