import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('authorization audit listing', () => {
  function setup() {
    const findMany = jest.fn().mockResolvedValue([{ id: 'event', grantId: 'grant', reason: 'grant-created' }]);
    const count = jest.fn().mockResolvedValue(1);
    const service = new UsersService({ authorizationChange: { findMany, count } } as never);
    const list = (actor: unknown, query: unknown = {}) => (service as any).listAuthorizationChanges(actor, query);
    return { list, findMany };
  }
  it('denies non-administrators', async () => {
    const { list, findMany } = setup();
    await expect(list({ role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  it.each([{ page: '-1' }, { page: '1.5' }, { pageSize: '101' }, { pageSize: '0' }])('rejects invalid pagination %p', async query => {
    await expect(setup().list({ role: 'admin' }, query)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('returns filtered bounded audit records', async () => {
    const { list, findMany } = setup();
    await expect(list({ role: 'admin' }, { grantId: 'grant', page: '2', pageSize: '10' })).resolves.toMatchObject({ total: 1, page: 2, pageSize: 10, items: [{ id: 'event' }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { grantId: 'grant' }, skip: 10, take: 10 }));
  });
});
