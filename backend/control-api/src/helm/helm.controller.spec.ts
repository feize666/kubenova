jest.mock('@kubernetes/client-node', () => ({}));
import { ForbiddenException } from '@nestjs/common';
import { HelmController } from './helm.controller';
import { HelmService } from './helm.service';

describe('Helm administrator boundary', () => {
  const query = { clusterId: 'foreign-cluster', namespace: 'private', confirm: true };
  const routes: [string, string, unknown[]][] = [
    ['listRepositoryPresets', 'listRepositoryPresets', []],
    ['listRepositories', 'listRepositories', [query]],
    ['listCharts', 'listCharts', [query]],
    ['listReleases', 'listReleases', [query]],
    ['getRelease', 'getRelease', ['release', query]],
    ['getReleaseValues', 'getReleaseValues', ['release', query]],
    ['getReleaseManifest', 'getReleaseManifest', ['release', query]],
    ['getReleaseHistory', 'getReleaseHistory', ['release', query]],
    ['importRepositoryPresets', 'importRepositoryPresets', [query]],
    ['importHostRepositories', 'importHostRepositories', [query]],
    ['createRepository', 'createRepository', [query]],
    ['updateRepository', 'updateRepository', ['repo', query]],
    ['removeRepository', 'deleteRepository', ['repo', query]],
    ['syncRepository', 'syncRepository', ['repo', query]],
    ['installRelease', 'installRelease', [query]],
    ['upgradeRelease', 'upgradeRelease', ['release', query]],
    ['rollbackRelease', 'rollbackRelease', ['release', query]],
    ['uninstallRelease', 'uninstallRelease', ['release', query, query]],
  ];
  it.each(routes)('%s rejects non-administrators before service access', (method, target, args) => {
    const service = { [target]: jest.fn() };
    const controller = new HelmController(service as unknown as HelmService);
    for (const role of [undefined, 'viewer', 'read-only', 'operator', 'cluster-operator', 'cluster-admin']) {
      expect(() => (controller as any)[method]({ user: { user: { id: 'reader', role } } }, ...args)).toThrow(ForbiddenException);
    }
    expect(service[target]).not.toHaveBeenCalled();
  });
  it.each(routes)('%s preserves administrator operation', (method, target, args) => {
    const service = { [target]: jest.fn().mockReturnValue('result') };
    const controller = new HelmController(service as unknown as HelmService);
    for (const role of ['admin', 'platform-admin']) {
      expect((controller as any)[method]({ user: { user: { role } } }, ...args)).toBe('result');
    }
    expect(service[target]).toHaveBeenCalledTimes(2);
  });
});
