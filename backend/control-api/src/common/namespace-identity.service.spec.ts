jest.mock('@kubernetes/client-node', () => ({}));
import { NamespaceIdentityService } from './namespace-identity.service';

describe('NamespaceIdentityService', () => {
  function setup(response: unknown) {
    const readNamespace = jest.fn().mockResolvedValue(response);
    const service = new NamespaceIdentityService(
      { getKubeconfig: async () => 'config' } as never,
      { getCoreApi: () => ({ readNamespace }) } as never,
    );
    return { service, readNamespace };
  }
  it('resolves the current UID rather than treating the name as an identity', async () => {
    const { service, readNamespace } = setup({ metadata: { uid: 'uid-1' } });
    expect(await service.resolve('cluster-a', 'apps')).toBe('uid-1');
    readNamespace.mockResolvedValue({ metadata: { uid: 'uid-2' } });
    expect(await service.resolve('cluster-a', 'apps')).toBe('uid-2');
    expect(readNamespace).toHaveBeenCalledWith({ name: 'apps' });
  });
  it.each([undefined, {}, { metadata: {} }])('rejects missing UID: %p', async response => {
    await expect(setup(response).service.resolve('c', 'apps')).rejects.toThrow();
  });
  it('rejects empty scope without reaching Kubernetes', async () => {
    const { service, readNamespace } = setup({});
    await expect(service.resolve('c', '')).rejects.toThrow();
    expect(readNamespace).not.toHaveBeenCalled();
  });
});
