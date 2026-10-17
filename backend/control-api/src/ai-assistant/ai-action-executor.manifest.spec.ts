import { ApiError } from '../common/errors/api-error';
jest.mock('@kubernetes/client-node', () => ({}));
import { AiActionExecutorService, type AiActionExecuteInput } from './ai-action-executor.service';

describe('AiActionExecutorService resource manifest action', () => {
  const manifest = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: apps\ndata:\n  mode: safe\n`;

  function setup(options: { secretAllowed?: boolean } = {}) {
    const applyYaml = jest.fn(async (_input: { dryRun?: boolean }, authorize?: (resource: any) => Promise<void>) => {
      const resource = {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'settings', namespace: 'apps' },
      };
      await authorize?.(resource);
      return {
        clusterId: 'cluster-a',
        items: [{ apiVersion: 'v1', kind: 'ConfigMap', namespace: 'apps', name: 'settings', dryRun: Boolean(_input.dryRun), message: 'ok' }],
        total: 1,
        dryRun: Boolean(_input.dryRun),
        message: 'ok',
        timestamp: new Date().toISOString(),
      };
    });
    const clusterAccess = {
      assertCanMutate: jest.fn(async () => undefined),
      isPlatformAdmin: jest.fn(() => false),
    };
    const namespaceIdentity = { resolve: jest.fn(async () => 'namespace-uid') };
    const authorization = {
      authorize: jest.fn(async (request: { capability?: string }) => ({
        allowed: request.capability === 'secrets' ? options.secretAllowed !== false : true,
        reasonCode: 'GRANT_MATCHED', grantIds: ['grant-1'], expiresAt: null,
      })),
    };
    const service = new AiActionExecutorService(
      {} as never,
      {} as never,
      { applyYaml } as never,
      clusterAccess as never,
      authorization as never,
      namespaceIdentity as never,
    );
    return { service, applyYaml, clusterAccess, namespaceIdentity, authorization };
  }

  const actor = { userId: 'user-a', username: 'operator', role: 'cluster-operator' as const };

  it('requires a namespace and non-empty manifest', async () => {
    const { service } = setup();
    const missingNamespace = {
      operation: 'apply-resource-manifest' as const,
      target: { clusterId: 'cluster-a', manifest },
    };
    await expect(service.preview(actor, missingNamespace)).resolves.toMatchObject({ status: 'invalid' });
    const missingManifest = {
      operation: 'apply-resource-manifest' as const,
      target: { clusterId: 'cluster-a', namespace: 'apps', manifest: '  ' },
    };
    await expect(service.preview(actor, missingManifest)).resolves.toMatchObject({ status: 'invalid' });
  });

  it('rejects operations that are absent from the typed registry', async () => {
    const { service } = setup();
    await expect(service.preview(actor, {
      operation: 'delete-everything' as never,
      target: { clusterId: 'cluster-a', namespace: 'apps' },
    })).resolves.toMatchObject({ status: 'invalid', error: { code: 'VALIDATION_ERROR' } });
  });

  it('uses dry-run for preview and preserves the full resource summary', async () => {
    const { service, applyYaml, namespaceIdentity } = setup();
    const action: AiActionExecuteInput = {
      operation: 'apply-resource-manifest',
      target: { clusterId: 'cluster-a', namespace: 'apps', manifest },
    };
    const preview = await service.preview(actor, action);
    expect(preview).toMatchObject({ status: 'ok', operation: 'apply-resource-manifest' });
    expect(applyYaml).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'cluster-a', namespace: 'apps', dryRun: true }), expect.any(Function));
    expect(namespaceIdentity.resolve).toHaveBeenCalledWith('cluster-a', 'apps');
  });

  it('requires the Secret capability before applying a Secret manifest', async () => {
    const { service, applyYaml, authorization } = setup({ secretAllowed: false });
    applyYaml.mockImplementationOnce(async (input: { dryRun?: boolean }, authorize?: (resource: any) => Promise<void>) => {
      await authorize?.({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace: 'apps' } });
      return { clusterId: 'cluster-a', items: [], total: 0, dryRun: Boolean(input.dryRun), message: 'ok', timestamp: new Date().toISOString() };
    });
    const action: AiActionExecuteInput = {
      operation: 'apply-resource-manifest',
      target: { clusterId: 'cluster-a', namespace: 'apps', manifest: 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: credentials\n  namespace: apps\n' },
    };
    await expect(service.preview(actor, action)).resolves.toMatchObject({
      status: 'invalid',
      error: { code: 'FORBIDDEN' },
    });
    expect(authorization.authorize).toHaveBeenCalledWith(expect.objectContaining({ capability: 'secrets', mutation: true }));
  });
});
