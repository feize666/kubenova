import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('group member listing', () => {
  const findUnique = jest.fn().mockResolvedValue({ id: 'g', name: 'Ops', active: true, externalId: null });
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const service = new UsersService({ identityGroup: { findUnique }, groupMembership: { findMany, count } } as never);
  beforeEach(() => jest.clearAllMocks());
  it('denies ordinary users', async () => {
    await expect((service as any).listGroupMembers({ role: 'operator' }, 'g', '1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rejects unknown groups', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect((service as any).listGroupMembers({ role: 'admin' }, 'missing', '1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('returns bounded members for the requested group only', async () => {
    await expect((service as any).listGroupMembers({ role: 'admin' }, 'g', '2')).resolves.toMatchObject({ group: { id: 'g', name: 'Ops', managedExternally: false }, items: [], total: 0, page: 2, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId: 'g' }, skip: 20, take: 20,
      select: expect.objectContaining({ user: { select: { id: true, email: true, name: true, isActive: true } } }) }));
  });
});
