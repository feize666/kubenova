jest.mock('@kubernetes/client-node', () => ({}));
import { ResourcesController } from './resources.controller';
import { AuthorizationService } from '../common/authorization.service';

describe('Secret namespace identity', () => {
  const previous = process.env.KUBENOVA_AUTHZ_ENFORCE;
  beforeEach(() => { process.env.KUBENOVA_AUTHZ_ENFORCE = 'true'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.KUBENOVA_AUTHZ_ENFORCE;
    else process.env.KUBENOVA_AUTHZ_ENFORCE = previous;
  });
  it.each(['updateDynamicYaml', 'createDynamic', 'deleteDynamic'] as const)('blocks unauthorized %s before mutation', async method => {
    const write = jest.fn().mockResolvedValue({});
    const Controller = ResourcesController as unknown as new (...args: any[]) => ResourcesController;
    const controller = new Controller(
      { updateDynamicYaml: write, createDynamicResource: write, deleteDynamicResource: write },
      { getKubeconfig: async () => null }, {}, { assertCanMutate: async () => {} },
      { authorize: async () => ({ allowed: false, reasonCode: 'GRANT_NOT_FOUND' }) },
      { resolve: async () => 'uid-apps' },
    );
    await expect(controller[method]({ user: { user: { id: 'u' } } }, { clusterId: 'c', namespace: 'apps', resource: 'secrets', name: 's' })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it.each(['yaml', 'dynamic', 'update'])('authorizes %s using UID, rejects a recreated namespace', async route => {
    const authz = new AuthorizationService({
      groupMembership: { findMany: async () => [] },
      accessGrant: { findMany: async () => [{ id: 'g', userId: 'u', groupId: null, clusterId: 'c', role: 'operator', state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'uid-original' }], capabilities: [{ capability: 'secrets' }] }] },
    } as never);
    let uid = 'uid-original';
    const read = jest.fn().mockResolvedValue('authorized-result');
    const Controller = ResourcesController as unknown as new (...args: any[]) => ResourcesController;
    const controller = new Controller({ getYaml: read, getDynamicResourceDetail: read, updateYaml: read }, {}, {}, { listAccessibleClusterIds: async () => ['c'], assertCanRead: async () => {}, assertCanMutate: async () => {} }, authz, { resolve: async () => uid });
    const request = { user: { user: { id: 'u' } } };
    const call = () => route === 'yaml' ? controller.getYaml(request, 'c', 'apps', 'Secret', 's') : route === 'dynamic' ? controller.getDynamicDetail(request, 'c', '', 'v1', 'secrets', 'apps', 's') : controller.updateYaml(request, { clusterId: 'c', namespace: 'apps', kind: 'Secret', name: 's', yaml: '{}', dryRun: true });
    await expect(call()).resolves.toBe('authorized-result');
    uid = 'uid-recreated';
    await expect(call()).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
