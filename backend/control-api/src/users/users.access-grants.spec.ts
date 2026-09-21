import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('access grant list confidentiality', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new UsersService({ accessGrant: { findMany } } as never);
  const controller = new UsersController(service);
  beforeEach(() => findMany.mockClear());

  it('maps the persisted email identity without exposing credential fields', async () => {
    findMany.mockResolvedValueOnce([{
      id: 'g', user: { id: 'u', email: 'operator@example.test', name: 'Operator' }, group: null,
      cluster: { id: 'c', name: 'Cluster' }, role: 'viewer', state: 'active',
      validFrom: new Date('2026-01-01T00:00:00Z'), expiresAt: null,
      namespaces: [{ namespaceName: 'default', namespaceUid: 'uid' }], capabilities: [{ capability: 'logs' }],
      version: 1, updatedAt: new Date('2026-01-01T00:00:00Z'),
    }]);
    const result = await service.listAccessGrants(undefined, { role: 'admin' });
    expect(result.items[0]).toMatchObject({ principal: { id: 'u', type: 'user', username: 'operator@example.test', name: 'Operator' } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ user: { select: { id: true, email: true, name: true } } }) }));
  });

  it.each([undefined, 'read-only', 'operator', 'cluster-operator'])('rejects role %s before querying grants', async (role) => {
    await expect(Reflect.apply(controller.listAccessGrants, controller, [undefined, { user: { user: { role } } }])).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(['admin', 'platform-admin'])('allows %s to filter grants by cluster', async (role) => {
    const result = await Reflect.apply(controller.listAccessGrants, controller, [' cluster-a ', { user: { user: { role } } }]);
    expect(result).toMatchObject({ items: [], total: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clusterId: 'cluster-a' } }));
  });
});
