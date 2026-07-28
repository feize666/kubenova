import type { Prisma } from '@prisma/client';

export type LegacyTopologySource =
  | 'workloads'
  | 'network'
  | 'storage'
  | 'configuration'
  | 'gateway';

export type TopologySource = Exclude<LegacyTopologySource, 'gateway'>;

export type TopologyRelationRole =
  | 'owner'
  | 'network'
  | 'storage'
  | 'config'
  | 'policy'
  | 'gateway';

export type TopologyRelationType =
  | 'OWNS'
  | 'SELECTS'
  | 'PUBLISHES'
  | 'RESOLVES'
  | 'ROUTES_TO'
  | 'GOVERNS'
  | 'PROVISIONS'
  | 'ACCEPTS'
  | 'MOUNTS'
  | 'BINDS'
  | 'USES_STORAGE_CLASS'
  | 'USES_CONFIG'
  | 'USES_SECRET'
  | 'USES_SERVICE_ACCOUNT';

export type TopologyCoverageStatus =
  | 'complete'
  | 'partial'
  | 'stale'
  | 'unavailable';

export type TopologyFreshnessStatus = 'fresh' | 'stale' | 'unavailable';

export interface PersistedResource {
  id: string;
  clusterId: string;
  namespace: string | null;
  kind: string;
  name: string;
  state: string;
  spec?: Prisma.JsonValue | null;
  statusJson?: Prisma.JsonValue | null;
  labels?: Prisma.JsonValue | null;
  replicas?: number | null;
  readyReplicas?: number | null;
  capacity?: string | null;
  storageClass?: string | null;
  bindingMode?: string | null;
  dataKeys?: Prisma.JsonValue | null;
  currentRev?: number | null;
  updatedAt?: Date | string | null;
}

export interface TopologyRow {
  source: LegacyTopologySource;
  row: PersistedResource;
}

export interface TopologyGraphQuery {
  clusterId?: string;
  namespace?: string;
  sources?: readonly string[];
}

export interface TopologyGraphResource {
  id: string;
  recordId: string;
  clusterId: string;
  namespace: string | null;
  kind: string;
  name: string;
  source: LegacyTopologySource;
  status: string;
  instanceName: string | null;
  nodeName: string | null;
  summary: string;
  detailLines: string[];
  tags: string[];
  warnings: number;
}

export interface TopologyGraphRelation {
  id: string;
  source: string;
  target: string;
  label: string;
  role: TopologyRelationRole;
  direction: 'outbound';
  evidence: string[];
  ports: string[];
}

export interface TopologyGraphResponse {
  resources: TopologyGraphResource[];
  relations: TopologyGraphRelation[];
  coverage: {
    sources: Record<LegacyTopologySource, { records: number; complete: true }>;
    warningRecords: number;
  };
  timestamp: string;
}

export interface TopologyResourceIdentity {
  clusterId: string;
  uid?: string | null;
  apiVersion?: string | null;
  resourceVersion?: string | null;
  kind: string;
  namespace: string | null;
  name: string;
}

export interface TopologyFreshness {
  status: TopologyFreshnessStatus;
  observedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
}

export interface TopologyGraphV2Resource extends Omit<
  TopologyGraphResource,
  'source'
> {
  source: TopologySource;
  identity: TopologyResourceIdentity;
  freshness: TopologyFreshness;
}

export interface TopologyGraphV2Relation extends TopologyGraphRelation {
  type: TopologyRelationType;
  confidence: number;
}

export interface TopologySourceCoverage {
  records: number;
  status: TopologyCoverageStatus;
  dataAsOf: string | null;
  reason?: string;
}

export interface TopologyGraphV2Response {
  schemaVersion: '2.0';
  clusterId: string | null;
  revision: string;
  generatedAt: string;
  dataAsOf: string | null;
  freshness: TopologyFreshness;
  resources: TopologyGraphV2Resource[];
  relations: TopologyGraphV2Relation[];
  coverage: {
    sources: Record<TopologySource, TopologySourceCoverage>;
    warningRecords: number;
  };
}
