import { UnauthorizedException } from '@nestjs/common';
import { OidcIdentityRepository } from './oidc-identity.repository';

describe('OIDC identity resolution', () => {
  const user = { id: 'local-user', isActive: true, role: 'user', authzVersion: 1 };
  function setup() {
    const identities = new Map([
      ['https://issuer-a.test|subject', { user }],
      ['https://issuer-b.test|subject', { user: { ...user, id: 'other-user' } }],
      ['https://issuer-a.test|disabled', { user: { ...user, isActive: false } }],
    ]);
    const prisma = { externalIdentity: { findUnique: async ({ where }: any) => identities.get(`${where.issuer_subject.issuer}|${where.issuer_subject.subject}`) ?? null } };
    return new OidcIdentityRepository(prisma as never);
  }
  it('separates identical subjects from different issuers', async () => {
    const repository = setup();
    expect((await repository.resolve('https://issuer-a.test', 'subject')).id).toBe('local-user');
    expect((await repository.resolve('https://issuer-b.test', 'subject')).id).toBe('other-user');
  });
  it.each(['unknown', 'disabled', ''])('denies unbound or inactive identity %s', async subject => {
    await expect(setup().resolve('https://issuer-a.test', subject)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
