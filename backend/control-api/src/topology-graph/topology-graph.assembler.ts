import { createHash } from 'node:crypto';
import { enforceTopologyGraphV2Capacity } from './topology-graph.capacity';
import type {
  LegacyTopologySource,
  TopologyGraphRelation,
  TopologyGraphResource,
  TopologyGraphResponse,
  TopologyGraphV2Relation,
  TopologyGraphV2Resource,
  TopologyGraphV2Response,
  TopologyRow,
  TopologySource,
  TopologySourceCoverage,
} from './topology-graph.contract';
import { toIsoString } from './topology-resource.projector';

const LEGACY_SOURCES: LegacyTopologySource[] = [
  'workloads',
  'network',
  'storage',
  'configuration',
  'gateway',
];

export const TOPOLOGY_V2_SOURCES: TopologySource[] = [
  'workloads',
  'network',
  'storage',
  'configuration',
];

export class TopologyGraphAssembler {
  assembleLegacy(input: {
    resources: TopologyGraphResource[];
    relations: TopologyGraphRelation[];
    warningRecords: number;
    generatedAt?: string;
  }): TopologyGraphResponse {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const counts = Object.fromEntries(
      LEGACY_SOURCES.map((source) => [
        source,
        {
          records: input.resources.filter(
            (resource) => resource.source === source,
          ).length,
          complete: true as const,
        },
      ]),
    ) as TopologyGraphResponse['coverage']['sources'];
    return {
      resources: input.resources,
      relations: input.relations,
      coverage: { sources: counts, warningRecords: input.warningRecords },
      timestamp: generatedAt,
    };
  }

  assembleV2(input: {
    clusterId: string | null;
    enabledSources: ReadonlySet<TopologySource>;
    rows: TopologyRow[];
    resources: TopologyGraphV2Resource[];
    relations: TopologyGraphV2Relation[];
    warningRecords: number;
    generatedAt?: string;
    revision?: string;
  }): TopologyGraphV2Response {
    enforceTopologyGraphV2Capacity({
      nodes: input.resources.length,
      relations: input.relations.length,
    });
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const dataAsOf = latestObservedAt(input.rows);
    const coverage = Object.fromEntries(
      TOPOLOGY_V2_SOURCES.map((source) => [
        source,
        this.sourceCoverage(source, input.enabledSources, input.rows),
      ]),
    ) as Record<TopologySource, TopologySourceCoverage>;
    const revision =
      input.revision ??
      graphRevision(input.clusterId, input.resources, input.relations);
    return {
      schemaVersion: '2.0',
      clusterId: input.clusterId,
      revision,
      generatedAt,
      dataAsOf,
      freshness: {
        status: dataAsOf ? 'fresh' : 'unavailable',
        observedAt: dataAsOf,
        ageMs: null,
        staleAfterMs: 0,
      },
      resources: input.resources,
      relations: input.relations,
      coverage: {
        sources: coverage,
        warningRecords: input.warningRecords,
      },
    };
  }

  private sourceCoverage(
    source: TopologySource,
    enabledSources: ReadonlySet<TopologySource>,
    rows: TopologyRow[],
  ): TopologySourceCoverage {
    if (!enabledSources.has(source))
      return {
        records: 0,
        status: 'unavailable',
        dataAsOf: null,
        reason: 'not-requested',
      };
    const matchingRows = rows.filter(
      (item) =>
        (item.source === 'gateway' ? 'network' : item.source) === source,
    );
    return {
      records: matchingRows.length,
      status: 'complete',
      dataAsOf: latestObservedAt(matchingRows),
    };
  }
}

function latestObservedAt(rows: TopologyRow[]): string | null {
  let latest: string | null = null;
  for (const { row } of rows) {
    const value = toIsoString(row.updatedAt);
    if (value && (!latest || value > latest)) latest = value;
  }
  return latest;
}

function graphRevision(
  clusterId: string | null,
  resources: TopologyGraphV2Resource[],
  relations: TopologyGraphV2Relation[],
): string {
  const payload = JSON.stringify({
    clusterId,
    resources,
    relations,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
