jest.mock('@kubernetes/client-node', () => ({ loadYaml: JSON.parse, PatchStrategy: { ServerSideApply: 'apply' } }));
import { ResourcesService } from './resources.service';

describe('batch apply authorization preflight', () => {
  it('rejects a later unauthorized document before writing the first', async () => {
    const service = Object.create(ResourcesService.prototype);
    const patch = jest.fn();
    service.makeObjectClient = async () => ({ patch });
    const documents = [
      { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'config', namespace: 'apps' } },
      { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace: 'private' } },
    ];
    const checked: string[] = [];
    await expect(service.applyYaml({ clusterId: 'c', yaml: documents.map(d => JSON.stringify(d)).join('\n---\n') }, async (manifest: { kind: string }) => {
      checked.push(manifest.kind);
      if (manifest.kind === 'Secret') throw new Error('denied');
    })).rejects.toThrow('denied');
    expect(checked).toEqual(['ConfigMap', 'Secret']);
    expect(patch).not.toHaveBeenCalled();
  });
});
