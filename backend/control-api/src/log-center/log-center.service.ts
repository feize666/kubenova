import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ClusterAccessService,
  ClusterAccessSubject,
} from '../common/cluster-access.service';
import { PrismaService } from '../platform/database/prisma.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { buildCollectorConfig, collectorCaSecretSchema } from './collector-config';
import { buildCollectorManifests } from './collector-manifests';

const querySchema = z
  .object({
    clusterId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    dataSourceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    namespace: z
      .string()
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
      .optional(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    keyword: z.string().max(512).optional(),
    pod: z.string().min(1).max(253).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/).optional(),
    container: z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict()
  .refine((value) => {
    const duration = Date.parse(value.to) - Date.parse(value.from);
    return duration > 0 && duration <= 86_400_000;
  }, 'Time range must be positive and at most 24 hours');

const field = z
  .string()
  .max(128)
  .regex(/^@?[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/)
  .refine(
    (value) =>
      !value
        .split('.')
        .some((part) =>
          ['__proto__', 'constructor', 'prototype'].includes(part),
        ),
  );
const metadataSchema = z
  .object({
    indexPattern: z
      .string()
      .max(128)
      .regex(/^[a-z0-9][a-z0-9_-]*\*?$/),
    clusterField: field.default('kubenova.cluster_id'),
    namespaceField: field.default('kubernetes.namespace_name'),
    namespaceUidField: field.optional(),
    timestampField: field.default('@timestamp'),
    messageField: field.default('message'),
  })
  .strict();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readField(value: Record<string, unknown>, path: string): unknown {
  if (Object.hasOwn(value, path)) return value[path];
  let result: unknown = value;
  for (const key of path.split('.')) {
    if (!record(result) || !Object.hasOwn(result, key)) return undefined;
    result = result[key];
  }
  return result;
}

function text(value: unknown, limit = 256): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

export interface LogQueryRow {
  id: string;
  timestamp: string;
  namespace: string;
  pod: string;
  container: string;
  message: string;
}

@Injectable()
export class LogCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ClusterAccessService,
    private readonly authorization: AuthorizationService,
    private readonly namespaceIdentity: NamespaceIdentityService,
  ) {}

  async previewCollection(actor: ClusterAccessSubject | undefined, input: unknown) {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    this.access.assertPlatformAdmin(actor);
    const shape = querySchema.innerType().shape;
    const parsed = z.object({
      clusterId: shape.clusterId, dataSourceId: shape.dataSourceId,
      retentionDays: z.number().int().min(1).max(365).default(14),
      caSecretName: collectorCaSecretSchema.optional(),
    }).strict().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid collection preview');
    const { clusterId, dataSourceId, retentionDays, caSecretName } = parsed.data;
    await this.access.assertCanRead(actor, clusterId);
    const source = await this.prisma.monitoringDataSource.findFirst({
      where: { id: dataSourceId, clusterId, kind: 'elasticsearch', enabled: true },
      select: { id: true, clusterId: true, kind: true, enabled: true, endpoint: true },
    });
    if (!source || source.id !== dataSourceId || source.clusterId !== clusterId ||
        source.kind !== 'elasticsearch' || !source.enabled) {
      throw new NotFoundException('Log source not found or unavailable');
    }
    try {
      const config = { clusterId, endpoint: source.endpoint, retentionDays, caSecretName };
      return { ...buildCollectorConfig(config), manifests: buildCollectorManifests(config) };
    } catch {
      throw new ServiceUnavailableException('Collector requires a valid HTTPS log source');
    }
  }

  async sources(actor: ClusterAccessSubject | undefined, clusterId: unknown) {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    const parsed = querySchema.innerType().shape.clusterId.safeParse(clusterId);
    if (!parsed.success) throw new BadRequestException('Invalid cluster ID');
    if (this.access.isPlatformAdmin(actor)) {
      await this.access.assertCanRead(actor, parsed.data);
    } else {
      if (!this.access.isKnownPlatformRole(actor)) throw new ForbiddenException('Log access denied');
      const grants = await this.authorization.listEffectiveGrants(actor.id, undefined, parsed.data);
      if (!grants.some(grant => grant.capabilities.some(item => item.capability === 'logs'))) {
        throw new ForbiddenException('Log access denied');
      }
    }
    const sources = await this.prisma.monitoringDataSource.findMany({
      where: { clusterId: parsed.data, kind: 'elasticsearch', enabled: true },
      select: { id: true, name: true, clusterId: true, kind: true, enabled: true },
      orderBy: { name: 'asc' },
    });
    return { items: sources.map(({ id, name, clusterId, kind, enabled }) => ({ id, name, clusterId, kind, enabled })) };
  }

  async query(
    actor: ClusterAccessSubject | undefined,
    input: unknown,
  ): Promise<{ rows: LogQueryRow[] }> {
    if (!actor?.id) throw new UnauthorizedException('Authentication required');
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid log query');
    const query = parsed.data;
    let namespaceUid: string | undefined;
    if (this.access.isPlatformAdmin(actor)) {
      await this.access.assertCanRead(actor, query.clusterId);
    } else {
      if (!this.access.isKnownPlatformRole(actor) || !query.namespace) {
        throw new ForbiddenException('Explicit namespace and log grant required');
      }
      const grants = await this.authorization.listEffectiveGrants(actor.id, undefined, query.clusterId);
      if (!grants.some(grant =>
        grant.namespaces.some(scope => scope.namespaceName === query.namespace) &&
        grant.capabilities.some(item => item.capability === 'logs'),
      )) throw new ForbiddenException('Log access denied');
      namespaceUid = await this.namespaceIdentity.resolve(query.clusterId, query.namespace);
      const decision = await this.authorization.authorize({
        userId: actor.id,
        clusterId: query.clusterId,
        namespaceUid,
        capability: 'logs',
        mutation: false,
      });
      if (!decision.allowed) throw new ForbiddenException('Log access denied');
    }
    const source = await this.prisma.monitoringDataSource.findFirst({
      where: {
        id: query.dataSourceId,
        clusterId: query.clusterId,
        kind: 'elasticsearch',
        enabled: true,
      },
    });
    if (
      !source ||
      source.id !== query.dataSourceId ||
      source.clusterId !== query.clusterId ||
      source.kind !== 'elasticsearch' ||
      !source.enabled
    ) {
      throw new NotFoundException('Log source not found or unavailable');
    }
    const metadata = metadataSchema.safeParse(
      record(source.metadata) ? source.metadata.logQuery : undefined,
    );
    const envName = /^env:(KUBENOVA_ES_API_KEY_[A-Z0-9_]+)$/.exec(
      source.secretRef ?? '',
    )?.[1];
    const apiKey = envName ? process.env[envName] : undefined;
    if (
      !metadata.success ||
      !apiKey ||
      !/^[A-Za-z0-9+/=_-]{1,4096}$/.test(apiKey)
    ) {
      throw new ServiceUnavailableException(
        'Log source configuration unavailable',
      );
    }
    const config = metadata.data;
    if (namespaceUid && !config.namespaceUidField) {
      throw new ServiceUnavailableException('Log source namespace identity mapping required');
    }
    let endpoint: URL;
    try {
      endpoint = new URL(source.endpoint);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${config.indexPattern}/_search`;
    } catch {
      throw new ServiceUnavailableException(
        'Log source configuration unavailable',
      );
    }
    const filters: Record<string, unknown>[] = [
      { term: { [config.clusterField]: query.clusterId } },
      {
        range: {
          [config.timestampField]: {
            gte: new Date(query.from).toISOString(),
            lte: new Date(query.to).toISOString(),
          },
        },
      },
    ];
    if (query.namespace)
      filters.push({ term: { [config.namespaceField]: query.namespace } });
    if (query.pod)
      filters.push({ term: { 'kubernetes.pod_name': query.pod } });
    if (query.container)
      filters.push({ term: { 'kubernetes.container_name': query.container } });
    if (namespaceUid && config.namespaceUidField)
      filters.push({ term: { [config.namespaceUidField]: namespaceUid } });
    const body = {
      size: query.limit,
      track_total_hits: false,
      timeout: '4s',
      _source: [
        config.timestampField,
        config.namespaceField,
        config.messageField,
        'kubernetes.pod_name',
        'kubernetes.container_name',
      ],
      sort: [{ [config.timestampField]: 'desc' }],
      query: {
        bool: {
          filter: filters,
          must: query.keyword
            ? [{ match: { [config.messageField]: query.keyword } }]
            : [],
        },
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `ApiKey ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const data = await this.readResponse(response);
      if (
        !record(data) ||
        data.timed_out === true ||
        (record(data._shards) && Number(data._shards.failed) > 0) ||
        !record(data.hits) ||
        !Array.isArray(data.hits.hits) ||
        data.hits.hits.length > query.limit
      )
        throw new Error();
      const rows = data.hits.hits.map((hit: unknown): LogQueryRow => {
        if (!record(hit) || typeof hit._id !== 'string' || !record(hit._source))
          throw new Error();
        const rawTimestamp = readField(hit._source, config.timestampField);
        if (
          typeof rawTimestamp !== 'string' ||
          !Number.isFinite(Date.parse(rawTimestamp))
        )
          throw new Error();
        return {
          id: text(hit._id),
          timestamp: new Date(rawTimestamp).toISOString(),
          namespace: text(readField(hit._source, config.namespaceField)),
          pod: text(readField(hit._source, 'kubernetes.pod_name')),
          container: text(readField(hit._source, 'kubernetes.container_name')),
          message: text(readField(hit._source, config.messageField), 8192),
        };
      });
      return { rows };
    } catch {
      controller.abort();
      throw new BadGatewayException('Log source query failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private async readResponse(response: Response): Promise<unknown> {
    const maxBytes = 2_097_152;
    if (
      Number(response.headers.get('content-length')) > maxBytes ||
      !response.body
    )
      throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error();
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
