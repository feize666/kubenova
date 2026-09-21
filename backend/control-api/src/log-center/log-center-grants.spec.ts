jest.mock('@kubernetes/client-node', () => ({}));
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthorizationService } from '../common/authorization.service';
import { ClusterAccessService } from '../common/cluster-access.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { LogCenterService } from './log-center.service';

describe('log center namespace grants', () => {
  const actor = { id: 'reader', role: 'read-only' };
  const input = {
    clusterId: 'c',
    dataSourceId: 's',
    namespace: 'apps',
    from: '2026-09-15T00:00:00Z',
    to: '2026-09-15T01:00:00Z',
  };
  const grant = {
    id: 'g',
    userId: 'reader',
    groupId: null,
    clusterId: 'c',
    role: 'viewer',
    state: 'active',
    validFrom: new Date(0),
    expiresAt: null,
    revokedAt: null,
    namespaces: [{ namespaceName: 'apps', namespaceUid: 'uid-current' }],
    capabilities: [{ capability: 'logs' }],
  };
  const source = {
    id: 's',
    name: 'Logs',
    clusterId: 'c',
    kind: 'elasticsearch',
    enabled: true,
    endpoint: 'https://logs.test',
    secretRef: 'env:KUBENOVA_ES_API_KEY_TEST',
    metadata: {
      logQuery: {
        indexPattern: 'logs-*',
        namespaceUidField: 'kubernetes.namespace_uid',
      },
    },
  };
  let service: LogCenterService;
  let db: any;
  let readNamespace: jest.Mock;
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    db = {
      groupMembership: { findMany: jest.fn().mockResolvedValue([]) },
      accessGrant: { findMany: jest.fn().mockResolvedValue([grant]) },
      clusterRegistry: { findFirst: jest.fn().mockResolvedValue({ id: 'c' }) },
      monitoringDataSource: {
        findFirst: jest.fn().mockResolvedValue(source),
        findMany: jest.fn().mockResolvedValue([source]),
      },
    };
    readNamespace = jest
      .fn()
      .mockResolvedValue({ metadata: { uid: 'uid-current' } });
    const identity = new NamespaceIdentityService(
      { getKubeconfig: async () => 'config' } as never,
      { getCoreApi: () => ({ readNamespace }) } as never,
    );
    service = new LogCenterService(
      db,
      new ClusterAccessService(db),
      new AuthorizationService(db),
      identity,
    );
    process.env.KUBENOVA_ES_API_KEY_TEST = 'test-key';
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ hits: { hits: [] } })));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.KUBENOVA_ES_API_KEY_TEST;
  });

  it('filters granted logs by cluster, explicit namespace, and live UID', async () => {
    await expect(service.query(actor, input)).resolves.toEqual({ rows: [] });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.query.bool.filter).toEqual([
      { term: { 'kubenova.cluster_id': 'c' } },
      {
        range: {
          '@timestamp': {
            gte: '2026-09-15T00:00:00.000Z',
            lte: '2026-09-15T01:00:00.000Z',
          },
        },
      },
      { term: { 'kubernetes.namespace_name': 'apps' } },
      { term: { 'kubernetes.namespace_uid': 'uid-current' } },
    ]);
  });
  it.each([
    { capabilities: [] },
    { namespaces: [{ namespaceName: 'other', namespaceUid: 'uid-current' }] },
    { clusterId: 'other' },
    { userId: 'other' },
    { revokedAt: new Date() },
    { expiresAt: new Date(0) },
    { state: 'revoked' },
  ])(
    'denies invalid grants before contacting Elasticsearch: %j',
    async (overrides) => {
      db.accessGrant.findMany.mockResolvedValue([{ ...grant, ...overrides }]);
      await expect(service.query(actor, input)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(readNamespace).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
  it('denies a recreated namespace even when its name still matches the grant', async () => {
    readNamespace.mockResolvedValue({ metadata: { uid: 'uid-recreated' } });
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('requires an explicit namespace', async () => {
    await expect(
      service.query(actor, { ...input, namespace: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(readNamespace).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('fails closed when live namespace identity cannot be resolved', async () => {
    readNamespace.mockRejectedValue(new Error('cluster offline'));
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('requires collector namespace UID mapping for non-admin access', async () => {
    db.monitoringDataSource.findFirst.mockResolvedValue({
      ...source,
      metadata: { logQuery: { indexPattern: 'logs-*' } },
    });
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects an unknown platform role even with a grant', async () => {
    await expect(
      service.query({ ...actor, role: 'unknown' }, input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('discovers only safe source metadata for a logs grant', async () => {
    await expect(service.sources(actor, 'c')).resolves.toEqual({
      items: [
        {
          id: 's',
          name: 'Logs',
          clusterId: 'c',
          kind: 'elasticsearch',
          enabled: true,
        },
      ],
    });
    expect(db.monitoringDataSource.findMany).toHaveBeenCalledWith({
      where: { clusterId: 'c', kind: 'elasticsearch', enabled: true },
      select: {
        id: true,
        name: true,
        clusterId: true,
        kind: true,
        enabled: true,
      },
      orderBy: { name: 'asc' },
    });
  });
  it('does not expose source metadata to viewers without logs capability', async () => {
    db.accessGrant.findMany.mockResolvedValue([{ ...grant, capabilities: [] }]);
    await expect(service.sources(actor, 'c')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.monitoringDataSource.findMany).not.toHaveBeenCalled();
  });
  it('does not use another cluster grant to expose source metadata', async () => {
    await expect(service.sources(actor, 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.monitoringDataSource.findMany).not.toHaveBeenCalled();
  });
  it('supports effective group logs grants through the shared evaluator', async () => {
    db.groupMembership.findMany.mockResolvedValue([{ groupId: 'team' }]);
    db.accessGrant.findMany.mockResolvedValue([
      { ...grant, userId: null, groupId: 'team' },
    ]);
    await expect(service.query(actor, input)).resolves.toEqual({ rows: [] });
  });
  it('rejects source discovery without identity or a valid cluster ID', async () => {
    await expect(service.sources(undefined, 'c')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    for (const clusterId of ['', undefined, ['c'], '../c']) {
      await expect(service.sources(actor, clusterId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(db.monitoringDataSource.findMany).not.toHaveBeenCalled();
  });
  it('preserves administrator source discovery without grants', async () => {
    db.accessGrant.findMany.mockResolvedValue([]);
    await expect(
      service.sources({ id: 'admin', role: 'platform-admin' }, 'c'),
    ).resolves.toEqual({
      items: [
        {
          id: 's',
          name: 'Logs',
          clusterId: 'c',
          kind: 'elasticsearch',
          enabled: true,
        },
      ],
    });
    expect(readNamespace).not.toHaveBeenCalled();
  });
});
