import type { Prisma } from '@prisma/client';
import type {
  LegacyTopologySource,
  PersistedResource,
  TopologyGraphResource,
  TopologyGraphV2Resource,
  TopologyRow,
  TopologySource,
} from './topology-graph.contract';

export type JsonRecord = Record<string, Prisma.JsonValue | undefined>;

export class TopologyResourceProjector {
  projectLegacy(
    rows: TopologyRow[],
    warnings: Map<string, number>,
  ): TopologyGraphResource[] {
    return rows
      .map(({ source, row }) => this.toLegacyResource(row, source, warnings))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  projectV2(
    rows: TopologyRow[],
    warnings: Map<string, number>,
  ): TopologyGraphV2Resource[] {
    return rows
      .map(({ source, row }) => {
        const v2Source = this.v2Source(source);
        const legacy = this.toLegacyResource(row, v2Source, warnings);
        const metadata =
          asRecord(asRecord(row.statusJson)?.metadata) ??
          asRecord(asRecord(row.spec)?.metadata);
        const observedAt = toIsoString(row.updatedAt);
        return {
          ...legacy,
          source: v2Source,
          identity: {
            clusterId: row.clusterId,
            uid: asString(metadata?.uid),
            apiVersion:
              asString(asRecord(row.statusJson)?.apiVersion) ??
              asString(asRecord(row.spec)?.apiVersion),
            resourceVersion: asString(metadata?.resourceVersion),
            kind: row.kind,
            namespace: row.namespace,
            name: row.name,
          },
          freshness: {
            status: 'fresh' as const,
            observedAt,
            ageMs: null,
            staleAfterMs: 0,
          },
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private toLegacyResource(
    row: PersistedResource,
    source: LegacyTopologySource,
    warnings: Map<string, number>,
  ): TopologyGraphResource {
    const labels = asStringRecord(row.labels);
    const statusJson = asRecord(row.statusJson);
    const status = resolveStatus(row);
    return {
      id: `${source}:${row.id}`,
      recordId: row.id,
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: row.kind,
      name: row.name,
      source,
      status,
      instanceName:
        asString(labels?.['app.kubernetes.io/instance']) ??
        asString(labels?.instance),
      nodeName: asString(statusJson?.nodeName),
      summary: summaryFor(row, status),
      detailLines: detailLinesFor(row, status),
      tags: Object.entries(labels ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .sort((left, right) => left.localeCompare(right)),
      warnings:
        warnings.get(
          warningKey(row.clusterId, row.namespace, row.kind, row.name),
        ) ?? 0,
    };
  }

  private v2Source(source: LegacyTopologySource): TopologySource {
    return source === 'gateway' ? 'network' : source;
  }
}

function summaryFor(row: PersistedResource, status: string): string {
  if (row.replicas !== undefined && row.replicas !== null)
    return `${row.readyReplicas ?? 0}/${row.replicas} ready`;
  if (row.capacity) return row.capacity;
  if (row.dataKeys) return `${asArray(row.dataKeys).length} keys`;
  return status;
}

function detailLinesFor(row: PersistedResource, status: string): string[] {
  const lines = [`State: ${row.state}`, `Status: ${status}`];
  if (row.replicas !== undefined && row.replicas !== null)
    lines.push(`Ready replicas: ${row.readyReplicas ?? 0}/${row.replicas}`);
  if (row.capacity) lines.push(`Capacity: ${row.capacity}`);
  if (row.storageClass) lines.push(`Storage class: ${row.storageClass}`);
  if (row.bindingMode) lines.push(`Binding mode: ${row.bindingMode}`);
  if (row.currentRev !== undefined && row.currentRev !== null)
    lines.push(`Revision: ${row.currentRev}`);
  return lines;
}

function resolveStatus(row: PersistedResource): string {
  const status = asRecord(row.statusJson);
  return asString(status?.phase) ?? asString(status?.state) ?? row.state;
}

export function indexWarnings(
  alerts: Array<{
    clusterId: string | null;
    namespace: string | null;
    resourceType: string | null;
    resourceName: string | null;
  }>,
): Map<string, number> {
  const warnings = new Map<string, number>();
  for (const alert of alerts) {
    if (!alert.clusterId || !alert.resourceType || !alert.resourceName)
      continue;
    const key = warningKey(
      alert.clusterId,
      alert.namespace,
      alert.resourceType,
      alert.resourceName,
    );
    warnings.set(key, (warnings.get(key) ?? 0) + 1);
  }
  return warnings;
}

export function warningKey(
  clusterId: string,
  namespace: string | null,
  kind: string,
  name: string,
): string {
  return `${clusterId}\u0000${namespace ?? ''}\u0000${kind}\u0000${name}`;
}

export function asRecord(
  value: Prisma.JsonValue | null | undefined,
): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function asStringRecord(
  value: Prisma.JsonValue | null | undefined,
): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      const stringValue = asString(item);
      return stringValue === null ? [] : [[key, stringValue] as const];
    }),
  );
}

export function asArray(
  value: Prisma.JsonValue | null | undefined,
): Prisma.JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(
  value: Prisma.JsonValue | null | undefined,
): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return null;
}

export function toIsoString(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
