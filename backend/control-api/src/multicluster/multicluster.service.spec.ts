import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MultiClusterService } from './multicluster.service';
import { ClusterAccessService } from '../common/cluster-access.service';
jest.mock('@kubernetes/client-node', () => ({}));

describe('multi-cluster query grants', () => {
  const actor = { id: 'reader', role: 'read-only' };
  let service: MultiClusterService;
  let clusters: any;
  let prisma: any;
  let grants: any[];
  let identity: any;
  beforeEach(() => {
    grants = [{ clusterId: 'c1', namespaces: [{ namespaceName: 'ai', namespaceUid: 'uid-ai' }], capabilities: [] }];
    clusters = { getKubeconfig: jest.fn().mockResolvedValue('config') };
    prisma = { clusterRoleBinding: { findMany: jest.fn().mockResolvedValue([]) } };
    for (const table of ['workloadRecord', 'networkResource', 'storageResource', 'configResource'])
      prisma[table] = { findMany: jest.fn().mockResolvedValue([]) };
    identity = { resolve: jest.fn().mockResolvedValue('uid-ai') };
    service = new (MultiClusterService as any)(clusters, prisma, new ClusterAccessService(prisma), { listEffectiveGrants: async () => grants }, identity);
  });
  const query = (body: any, subject: any = actor) => (service.query as any)(body, subject);
  it('rejects foreign clusters before configuration or resource reads', async () => {
    await expect(query({ clusterIds: ['foreign'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it('authorizes every requested cluster before querying any cluster', async () => {
    await expect(query({ clusterIds: ['c1', 'foreign'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
    expect(prisma.workloadRecord.findMany).not.toHaveBeenCalled();
  });
  it.each([null, { clusterIds: [12] }, { clusterIds: ['c1'], namespace: {} }])('rejects malformed input %j', async body => {
    await expect(query(body)).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([undefined, {}, { id: 'reader', role: 'unknown' }])('rejects missing or unknown identities %j', async subject => {
    await expect((service.query as any)({ clusterIds: ['c1'] }, subject)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['workload', 'network', 'storage', 'config'])('filters %s before limit', async domain => {
    await query({ clusterIds: ['c1'], domain, limitPerCluster: 1, keyword: 'app' });
    const table = { workload: 'workloadRecord', network: 'networkResource', storage: 'storageResource', config: 'configResource' }[domain]!;
    expect(prisma[table].findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 1, where: expect.objectContaining({ clusterId: 'c1', AND: [{ OR: [expect.objectContaining({ namespace: 'ai', ...(domain === 'storage' ? { kind: 'PVC' } : domain === 'config' ? { kind: 'ConfigMap' } : {}) })] }] }),
    }));
  });
  it.each([{ namespace: 'foreign' }, { domain: 'storage', kind: 'PV' }, { domain: 'storage', kind: 'StorageClass' }, { domain: 'config', kind: 'Secret' }])('denies unauthorized request %j', async request => {
    await expect(query({ clusterIds: ['c1'], ...request })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects recreated namespace UID', async () => {
    identity.resolve.mockResolvedValue('recreated');
    await expect(query({ clusterIds: ['c1'] })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows Secret only from its own effective namespace capability', async () => {
    grants.push({ clusterId: 'c1', namespaces: [{ namespaceName: 'other', namespaceUid: 'uid-ai' }], capabilities: [{ capability: 'secrets' }] });
    await expect(query({ clusterIds: ['c1'], domain: 'config', kind: 'Secret', namespace: 'ai' })).rejects.toBeInstanceOf(ForbiddenException);
    grants[0].capabilities.push({ capability: 'secrets' });
    await query({ clusterIds: ['c1'], domain: 'config', kind: 'Secret', namespace: 'ai' });
    expect(prisma.configResource.findMany).toHaveBeenCalled();
  });
  it('retains legacy full-cluster reads but excludes Secrets', async () => {
    grants = [];
    prisma.clusterRoleBinding.findMany.mockResolvedValue([{ clusterId: 'c1' }]);
    await query({ clusterIds: ['c1'], domain: 'storage', kind: 'PV' });
    await expect(query({ clusterIds: ['c1'], domain: 'config', kind: 'Secret' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('retains admin and partial missing-configuration response', async () => {
    clusters.getKubeconfig.mockResolvedValue(null);
    const result = await query({ clusterIds: ['c1'] }, { id: 'admin', role: 'admin' });
    expect(result.partialErrors[0].code).toBe('CLUSTER_KUBECONFIG_MISSING');
  });
});
