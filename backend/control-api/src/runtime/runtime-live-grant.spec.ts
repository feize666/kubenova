jest.mock('@kubernetes/client-node', () => ({}));
import { NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../common/authorization.service';
import { RuntimeSessionService, RuntimeTokenPayload } from './runtime-session.service';

describe('runtime live grant validation', () => {
  const payload: RuntimeTokenPayload = { sessionId: 's', userId: 'u', type: 'terminal', clusterId: 'c', namespace: 'ai', pod: 'p', container: 'app', path: '/ws/terminal', exp: Math.floor(Date.now() / 1000) + 600 };
  function setup() {
    const grant = { id: 'g', userId: 'u', groupId: null, clusterId: 'c', role: 'viewer', state: 'active', validFrom: new Date(0), expiresAt: null as Date | null, revokedAt: null, namespaces: [{ namespaceUid: 'original' }], capabilities: [{ capability: 'exec' }] };
    const row = { ...payload, id: 's', closedAt: null, expiresAt: new Date(payload.exp * 1000), subject: { id: 'u', role: 'user' } };
    const authorization = new AuthorizationService({ groupMembership: { findMany: async () => [] }, accessGrant: { findMany: async () => [grant] } } as never);
    const identity = { resolve: jest.fn(async () => 'original') };
    const denied = async () => { throw new NotFoundException(); };
    const access = { assertCanRead: denied, assertCanMutate: denied };
    const service = new RuntimeSessionService({ findSessionById: async () => row } as never, access as never, authorization, identity as never);
    const validate = () => service.validateSessionTokenDetailed({ sessionId: 's', runtimeToken: service.createRuntimeToken(payload), expectedPath: '/ws/terminal' });
    return { grant, identity, validate };
  }
  it('invalidates a naturally expired grant without an authorization-version change', async () => {
    const { grant, validate } = setup();
    expect((await validate()).payload).toEqual(payload);
    grant.expiresAt = new Date(Date.now() - 1);
    expect((await validate()).payload).toBeNull();
  });
  it('rejects a recreated namespace despite an unchanged name', async () => {
    const { identity, validate } = setup();
    identity.resolve.mockResolvedValue('recreated');
    expect((await validate()).payload).toBeNull();
  });
  it('bounds the validated lifetime by the live grant deadline', async () => {
    const { grant, validate } = setup();
    grant.expiresAt = new Date(Date.now() + 30000);
    expect((await validate()).payload?.exp).toBe(Math.floor(grant.expiresAt.getTime() / 1000));
  });
  it('rejects capability removal while the signed runtime token remains valid', async () => {
    const { grant, validate } = setup();
    grant.capabilities = [];
    expect((await validate()).payload).toBeNull();
  });
});
