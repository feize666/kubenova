import { AuthRepository } from './auth.repository';

describe('refresh authorization version boundary', () => {
  const input = { authzVersion: 4, sessionId: 's', userId: 'u', currentRefreshTokenHash: 'old', nextRefreshTokenHash: 'new', expiresAt: new Date('2027-01-01'), refreshExpiresAt: new Date('2027-02-01') };
  function setup(count: number) {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const create = jest.fn().mockResolvedValue({ id: 'next', authzVersion: 4 });
    const repo = new AuthRepository({ $transaction: async (fn: any) => fn({ session: { updateMany, create } }) } as never);
    return { repo, updateMany, create };
  }
  it('requires the stored user and session to have the expected authorization version', async () => {
    const { repo, updateMany, create } = setup(1);
    await expect(repo.rotateSession(input)).resolves.toMatchObject({ authzVersion: 4 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ authzVersion: 4, user: { isActive: true, authzVersion: 4 } }) }));
    expect(create).toHaveBeenCalledWith({ data: { userId: 'u', authzVersion: 4, refreshTokenHash: 'new', expiresAt: input.expiresAt, refreshExpiresAt: input.refreshExpiresAt } });
  });
  it('never issues a replacement after the conditional revocation fails', async () => {
    const { repo, create } = setup(0);
    await expect(repo.rotateSession(input)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it('caps replacement access expiry at the absolute refresh deadline', async () => {
    const { repo, create } = setup(1);
    await repo.rotateSession({ ...input, expiresAt: new Date('2027-03-01') });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expiresAt: input.refreshExpiresAt }) }));
  });
});
