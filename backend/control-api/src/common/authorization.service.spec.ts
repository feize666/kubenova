import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
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
});
