import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClusterAccessService } from '../common/cluster-access.service';
import { PrismaService } from '../platform/database/prisma.service';
import { LogCenterService } from './log-center.service';

describe('bounded log queries', () => {
  const actor = { id: 'admin', role: 'platform-admin' };
  const input = {
    clusterId: 'cluster-a',
    dataSourceId: 'source-a',
    from: '2026-09-15T00:00:00Z',
    to: '2026-09-16T00:00:00Z',
    limit: 20,
    namespace: 'apps',
    keyword: 'error OR *',
  };
  const source = {
    id: 'source-a',
    clusterId: 'cluster-a',
    kind: 'elasticsearch',
    enabled: true,
    endpoint: 'https://logs.example.test',
    secretRef: 'env:KUBENOVA_ES_API_KEY_TEST',
    metadata: { logQuery: { indexPattern: 'logs-*' } },
  };
  let service: LogCenterService;
  let fetchMock: jest.SpyInstance;
  let db: {
    monitoringDataSource: { findFirst: jest.Mock };
    clusterRegistry: { findFirst: jest.Mock };
  };
  const response = (hits: unknown[] = []) =>
    new Response(JSON.stringify({ hits: { hits } }));
  beforeEach(() => {
    process.env.KUBENOVA_ES_API_KEY_TEST = 'test-api-key';
    db = {
      monitoringDataSource: { findFirst: jest.fn().mockResolvedValue(source) },
      clusterRegistry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cluster-a' }),
      },
    };
    const prisma = db as unknown as PrismaService;
    service = new LogCenterService(prisma, new ClusterAccessService(prisma));
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response());
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.KUBENOVA_ES_API_KEY_TEST;
  });

  it('rejects missing identity and non-admin cluster viewers', async () => {
    await expect(service.query(undefined, input)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.query({ id: 'viewer', role: 'read-only' }, input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires an accessible live cluster', async () => {
    db.clusterRegistry.findFirst.mockResolvedValue(null);
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...source, clusterId: 'other' },
    { ...source, enabled: false },
    { ...source, kind: 'kibana' },
  ])('rejects absent or mismatched source %j', async (record) => {
    db.monitoringDataSource.findFirst.mockResolvedValue(record);
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { ...input, endpoint: 'http://evil' },
    { ...input, limit: 201 },
    { ...input, limit: 0 },
    { ...input, limit: '20' },
    { ...input, limit: 1.5 },
    { ...input, keyword: {} },
    { ...input, keyword: 'a'.repeat(513) },
    { ...input, from: 'yesterday' },
    { ...input, from: '2026-02-30T00:00:00Z' },
    { ...input, to: '2026-09-17T00:00:00Z' },
    { ...input, to: input.from },
    { ...input, namespace: '*' },
    { ...input, clusterId: '' },
  ])('rejects malformed request %j', async (body) => {
    await expect(service.query(actor, body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends bounded plain text queries with mandatory cluster and namespace filters', async () => {
    await service.query(actor, input);
    expect(db.monitoringDataSource.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'source-a',
          clusterId: 'cluster-a',
          kind: 'elasticsearch',
          enabled: true,
        },
      }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://logs.example.test/logs-*/_search');
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('ApiKey test-api-key');
    expect(JSON.parse(init.body)).toMatchObject({
      size: 20,
      track_total_hits: false,
      query: {
        bool: {
          filter: [
            { term: { 'kubenova.cluster_id': 'cluster-a' } },
            {
              range: {
                '@timestamp': {
                  gte: '2026-09-15T00:00:00.000Z',
                  lte: '2026-09-16T00:00:00.000Z',
                },
              },
            },
            { term: { 'kubernetes.namespace_name': 'apps' } },
          ],
          must: [{ match: { message: 'error OR *' } }],
        },
      },
    });
  });
  it.each(['plain-key', 'vault:key', 'env:MISSING_LOG_QUERY_KEY'])(
    'fails closed on unsupported or missing credentials %s',
    async (secretRef) => {
      db.monitoringDataSource.findFirst.mockResolvedValue({
        ...source,
        secretRef,
      });
      await expect(service.query(actor, input)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('never forwards an unrelated environment secret to a log endpoint', async () => {
    process.env.LOG_QUERY_UNRELATED_SECRET = 'unrelated-secret';
    try {
      db.monitoringDataSource.findFirst.mockResolvedValue({
        ...source,
        secretRef: 'env:LOG_QUERY_UNRELATED_SECRET',
      });
      await expect(service.query(actor, input)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.LOG_QUERY_UNRELATED_SECRET;
    }
  });
  it.each([
    { indexPattern: '*' },
    { indexPattern: '../_all' },
    { indexPattern: 'logs-*', clusterField: 'x;bad' },
    { indexPattern: 'logs-*', messageField: '__proto__' },
  ])('fails closed on unsafe source metadata %j', async (logQuery) => {
    db.monitoringDataSource.findFirst.mockResolvedValue({
      ...source,
      metadata: { logQuery },
    });
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('redacts upstream errors and redirects', async () => {
    for (const status of [302, 401, 500]) {
      fetchMock.mockResolvedValue(
        new Response('sensitive upstream body', { status }),
      );
      await expect(service.query(actor, input)).rejects.toMatchObject({
        message: 'Log source query failed',
      });
    }
    fetchMock.mockRejectedValue(new Error('secret upstream address'));
    await expect(service.query(actor, input)).rejects.toMatchObject({
      message: 'Log source query failed',
    });
  });
  it('aborts requests that exceed the timeout', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener('abort', () =>
            reject(new Error('secret timeout')),
          ),
        ),
    );
    const pending = expect(service.query(actor, input)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await jest.advanceTimersByTimeAsync(5100);
    await pending;
    jest.useRealTimers();
  });
  it.each([
    'not json',
    '{}',
    JSON.stringify({ hits: { hits: [{}] } }),
    JSON.stringify({ timed_out: true, hits: { hits: [] } }),
    'x'.repeat(2_097_153),
  ])('rejects malformed, partial or oversized responses', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(service.query(actor, input)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('normalizes only allowed fields and caps messages', async () => {
    fetchMock.mockResolvedValue(
      response([
        {
          _id: 'row-1',
          _source: {
            '@timestamp': '2026-09-15T12:00:00Z',
            kubernetes: {
              namespace_name: 'apps',
              pod_name: 'web',
              container_name: 'main',
            },
            message: 'x'.repeat(9000),
            secret: 'never-return',
          },
        },
      ]),
    );
    expect(await service.query(actor, input)).toEqual({
      rows: [
        {
          id: 'row-1',
          timestamp: '2026-09-15T12:00:00.000Z',
          namespace: 'apps',
          pod: 'web',
          container: 'main',
          message: 'x'.repeat(8192),
        },
      ],
    });
  });
  it('honors administrator field mapping while preserving cluster isolation without namespace', async () => {
    db.monitoringDataSource.findFirst.mockResolvedValue({
      ...source,
      metadata: {
        logQuery: {
          indexPattern: 'tenant-logs',
          clusterField: 'tenant',
          namespaceField: 'ns',
          timestampField: 'time',
          messageField: 'body',
        },
      },
    });
    fetchMock.mockResolvedValue(
      response([
        {
          _id: 'r',
          _source: { time: '2026-09-15T12:00:00Z', ns: 'apps', body: 'hello' },
        },
      ]),
    );
    expect(
      await service.query(actor, {
        ...input,
        namespace: undefined,
        keyword: undefined,
      }),
    ).toEqual({
      rows: [
        {
          id: 'r',
          timestamp: '2026-09-15T12:00:00.000Z',
          namespace: 'apps',
          pod: '',
          container: '',
          message: 'hello',
        },
      ],
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query.bool).toEqual({
      filter: [
        { term: { tenant: 'cluster-a' } },
        {
          range: {
            time: {
              gte: '2026-09-15T00:00:00.000Z',
              lte: '2026-09-16T00:00:00.000Z',
            },
          },
        },
      ],
      must: [],
    });
  });
  it('rejects oversized content length, excess hits, and failed shards', async () => {
    const cases = [
      new Response('{}', { headers: { 'content-length': '2097153' } }),
      response(
        new Array(21).fill({ _id: 'x', _source: { '@timestamp': input.from } }),
      ),
      new Response(
        JSON.stringify({ _shards: { failed: 1 }, hits: { hits: [] } }),
      ),
    ];
    for (const result of cases) {
      fetchMock.mockResolvedValue(result);
      await expect(service.query(actor, input)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
  });
});
