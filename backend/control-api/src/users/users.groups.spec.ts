import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('grant group options', () => {
  const findMany = jest.fn().mockResolvedValue([{ id: 'team', name: 'Ops' }]);
  const service = new UsersService({ identityGroup: { findMany } } as never);
  beforeEach(() => findMany.mockClear());
  it('rejects ordinary users before reading groups', async () => {
    await expect((service as any).listGrantGroups({ role: 'operator' }, '')).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('only exposes active group options with bounded search', async () => {
    await expect((service as any).listGrantGroups({ role: 'admin' }, ' Ops ')).resolves.toEqual({ items: [{ id: 'team', name: 'Ops' }] });
    expect(findMany).toHaveBeenCalledWith({ where: { active: true, name: { contains: 'Ops', mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 });
  });
});

describe('create local identity group', () => {
  const create = jest.fn().mockResolvedValue({ id: 'team', name: 'Ops', active: true });
  const audit = jest.fn();
  const tx = { identityGroup: { create }, authorizationChange: { create: audit } };
  const transaction = jest.fn(async fn => fn(tx));
  const service = new UsersService({ $transaction: transaction } as never);
  beforeEach(() => jest.clearAllMocks());
  it('rejects operators without writing', async () => {
    await expect((service as any).createIdentityGroup({ id: 'u', role: 'operator' }, { name: 'Ops' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([null, {}, { name: '' }, { name: '   ' }, { name: 12 }, { name: 'x'.repeat(129) }])('rejects invalid input %p', async body => {
    await expect((service as any).createIdentityGroup({ id: 'a', role: 'admin' }, body)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('creates a local group and its audit in one transaction', async () => {
    await expect((service as any).createIdentityGroup({ id: 'a', role: 'admin' }, { name: ' Ops ' })).resolves.toEqual({ id: 'team', name: 'Ops', active: true });
    expect(create).toHaveBeenCalledWith({ data: { name: 'Ops' }, select: { id: true, name: true, active: true } });
    expect(audit).toHaveBeenCalledWith({ data: { actorUserId: 'a', reason: 'group-created:team', version: 1 } });
  });
});
