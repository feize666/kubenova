import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  it('caps inherited grants at membership expiry without shortening direct grants', async () => {
    const expiresAt = new Date('2026-09-16T00:01:00Z');
    const base = { id:'group', userId:null, groupId:'team', clusterId:'c', role:'viewer', state:'active', validFrom:new Date(0), expiresAt:null, revokedAt:null, namespaces:[{namespaceUid:'ns'}], capabilities:[] };
    const grants = [base, {...base,id:'direct',userId:'u',groupId:null}];
    const {service} = setup({groupMembership:{findMany:async()=>[{groupId:'team',expiresAt}]},accessGrant:{findMany:async()=>grants}});
    const effective = await service.listEffectiveGrants('u',now);
    expect(effective.find(g=>g.id==='group')?.expiresAt).toEqual(expiresAt);
    expect(effective.find(g=>g.id==='direct')?.expiresAt).toBeNull();
    expect(base.expiresAt).toBeNull();
    expect((await service.authorize({userId:'u',clusterId:'c',namespaceUid:'ns',at:now})).expiresAt).toEqual(expiresAt);
  });
  it('lists effective grants without widening identity, time or namespace scope', async () => {
    const base = { id: 'direct', userId: 'u', groupId: null, clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'ns', namespaceName: 'ai' }], capabilities: [] };
    const grants = [base, { ...base, id: 'group', userId: null, groupId: 'team' },
      { ...base, id: 'foreign', userId: 'other' }, { ...base, id: 'disabled', state: 'disabled' },
      { ...base, id: 'expired', expiresAt: now }, { ...base, id: 'future', validFrom: new Date('2030-01-01') },
      { ...base, id: 'empty', namespaces: [] }, { ...base, id: 'revoked', revokedAt: now }];
    const { service } = setup({ groupMembership: { findMany: async () => [{ groupId: 'team' }] }, accessGrant: { findMany: async () => grants } });
    const result = await (service as any).listEffectiveGrants('u', now);
    expect(result.map((grant: any) => grant.id)).toEqual(['direct', 'group']);
    expect(result[0].namespaces).toEqual([{ namespaceUid: 'ns', namespaceName: 'ai' }]);
    await expect((service as any).listEffectiveGrants('', now)).resolves.toEqual([]);
  });
  const now = new Date('2026-09-16T00:00:00Z');
  function setup(overrides: Record<string, unknown> = {}) {
    const prisma = {
      groupMembership: { findMany: jest.fn().mockResolvedValue([]) },
      accessGrant: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    return { service: new AuthorizationService(prisma as never), prisma };
  }
  it('denies missing identity, unsupported capability and absent grant', async () => {
    const { service } = setup();
    await expect(service.authorize({ userId: '', clusterId: 'c' })).resolves.toMatchObject({ allowed: false, reasonCode: 'IDENTITY_OR_CLUSTER_REQUIRED' });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', capability: 'other' as never })).resolves.toMatchObject({ allowed: false, reasonCode: 'CAPABILITY_NOT_SUPPORTED' });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', at: now })).resolves.toMatchObject({ allowed: false, reasonCode: 'GRANT_NOT_FOUND' });
  });
  it('requires an explicit namespace and capability on the same grant', async () => {
    const grant = { id: 'g', userId: 'u', clusterId: 'c', role: 'operator', state: 'active', validFrom: new Date('2026-01-01'), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'ns' }], capabilities: [{ capability: 'logs' }] };
    const { service } = setup({ accessGrant: { findMany: jest.fn().mockResolvedValue([grant]) } });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'other', capability: 'logs', at: now })).resolves.toMatchObject({ allowed: false });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', capability: 'exec', at: now })).resolves.toMatchObject({ allowed: false });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', capability: 'logs', at: now })).resolves.toMatchObject({ allowed: true, grantIds: ['g'] });
  });
  it.each([undefined, '', '   '])('does not widen namespace grants when namespace is %p', async namespaceUid => {
    const grant = { id: 'g', userId: 'u', groupId: null, clusterId: 'c', role: 'operator', state: 'active', validFrom: new Date('2026-01-01'), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'ns' }], capabilities: [{ capability: 'logs' }] };
    const { service } = setup({ accessGrant: { findMany: jest.fn().mockResolvedValue([grant]) } });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid, capability: 'logs', at: now })).resolves.toMatchObject({ allowed: false });
  });
  it('rejects expired, revoked, viewer mutation and future grants', async () => {
    const base = { id: 'g', userId: 'u', clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date('2027-01-01'), expiresAt: new Date('2027-02-01'), revokedAt: new Date('2027-01-02'), namespaces: [{ namespaceUid: 'ns' }], capabilities: [{ capability: 'logs' }] };
    const { service } = setup({ accessGrant: { findMany: jest.fn().mockResolvedValue([base]) } });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', capability: 'logs', mutation: true, at: now })).resolves.toMatchObject({ allowed: false });
  });
  it('allows an active group grant only within its namespace and lifetime', async () => {
    const grant = { id: 'g', userId: null, clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date('2026-01-01'), expiresAt: new Date('2026-12-01'), revokedAt: null, namespaces: [{ namespaceUid: 'ns' }], capabilities: [] };
    const { service } = setup({ groupMembership: { findMany: jest.fn().mockResolvedValue([{ groupId: 'team' }]) }, accessGrant: { findMany: jest.fn().mockResolvedValue([{ ...grant, groupId: 'team' }]) } });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', at: now })).resolves.toMatchObject({ allowed: true });
  });
  it('excludes disabled groups from inherited authorization', async () => {
    const grant = { id: 'g', userId: null, groupId: 'disabled-team', clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'ns' }], capabilities: [] };
    const { service } = setup({
      groupMembership: { findMany: async ({ where }: any) => where.group?.active === true ? [] : [{ groupId: 'disabled-team' }] },
      accessGrant: { findMany: async () => [grant] },
    });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', at: now })).resolves.toMatchObject({ allowed: false });
  });
  it.each([
    { userId: 'team', groupId: null },
    { userId: null, groupId: 'u' },
  ])('does not mix user and group identity domains: %p', async subject => {
    const grant = { id: 'g', ...subject, clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'ns' }], capabilities: [] };
    const { service } = setup({ groupMembership: { findMany: async () => [{ groupId: 'team' }] }, accessGrant: { findMany: async () => [grant] } });
    await expect(service.authorize({ userId: 'u', clusterId: 'c', namespaceUid: 'ns', at: now })).resolves.toMatchObject({ allowed: false });
  });
});
