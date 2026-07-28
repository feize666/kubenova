import { apiRequest } from "./client";
import type { ApiRequestSignalOptions } from "./types";

export const TOPOLOGY_GRAPH_SCHEMA_VERSION = "2.0" as const;

export type TopologyGraphSource =
  | "workloads"
  | "network"
  | "storage"
  | "configuration";

export type TopologyGraphRelationType =
  | "owner"
  | "network"
  | "storage"
  | "config"
  | "policy"
  | "gateway";

export type TopologyGraphTypedRelationType =
  | "OWNS"
  | "SELECTS"
  | "PUBLISHES"
  | "RESOLVES"
  | "ROUTES_TO"
  | "GOVERNS"
  | "PROVISIONS"
  | "ACCEPTS"
  | "MOUNTS"
  | "BINDS"
  | "USES_STORAGE_CLASS"
  | "USES_CONFIG"
  | "USES_SECRET"
  | "USES_SERVICE_ACCOUNT";

export type TopologyGraphCoverageStatus =
  | "complete"
  | "partial"
  | "stale"
  | "unavailable";

export type TopologyGraphFreshnessStatus = "fresh" | "stale" | "unavailable";

export interface TopologyGraphResourceIdentity {
  clusterId: string;
  uid: string | null;
  apiVersion: string | null;
  resourceVersion: string | null;
  namespace: string | null;
  kind: string;
  name: string;
}

export interface TopologyGraphResource {
  id: string;
  recordId: string;
  source: TopologyGraphSource;
  clusterId: string;
  namespace: string | null;
  kind: string;
  name: string;
  status: string;
  instanceName: string | null;
  nodeName: string | null;
  summary: string;
  detailLines: string[];
  tags: string[];
  warnings: number;
  identity: TopologyGraphResourceIdentity;
  identityKey: string;
  observedAt: string | null;
}

export type TopologyGraphEvidenceKind =
  | "ownerReference"
  | "selector"
  | "endpoint"
  | "backendRef"
  | "volume"
  | "volumeClaim"
  | "storageClass"
  | "objectReference"
  | "serviceAccount"
  | "unknown";

export interface TopologyGraphRelationEvidence {
  kind: TopologyGraphEvidenceKind;
  detail: string;
  fieldPath?: string;
}

export interface TopologyGraphRelationPort {
  name?: string;
  protocol?: string;
  port?: number | string;
  targetPort?: number | string;
}

export interface TopologyGraphRelation {
  id: string;
  role: TopologyGraphRelationType;
  type: TopologyGraphTypedRelationType;
  source: string;
  target: string;
  label: string;
  direction: "outbound" | "inbound";
  evidence: string[];
  evidenceDetails: TopologyGraphRelationEvidence[];
  confidence: number;
  ports: string[];
  portDetails: TopologyGraphRelationPort[];
}

export interface TopologyGraphCoverageSource {
  records: number;
  complete: boolean;
  status: TopologyGraphCoverageStatus;
  lastSuccessfulAt: string | null;
  reason: string | null;
}

export interface TopologyGraphFreshness {
  status: TopologyGraphFreshnessStatus;
  observedAt: string | null;
  ageMs: number | null;
  staleAfterMs: number | null;
}

export interface TopologyGraphResponse {
  schemaVersion: string;
  revision: string;
  generatedAt: string;
  dataAsOf: string;
  freshness: TopologyGraphFreshness;
  resources: TopologyGraphResource[];
  relations: TopologyGraphRelation[];
  coverage: {
    sources: Record<TopologyGraphSource, TopologyGraphCoverageSource>;
    warningRecords: number;
  };
  /** V1 alias retained until the topology page is migrated. */
  timestamp: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSource(value: unknown): TopologyGraphSource {
  if (value === "workloads" || value === "storage" || value === "configuration") return value;
  return "network";
}

function normalizeCoverageStatus(value: unknown, complete: boolean): TopologyGraphCoverageStatus {
  if (value === "complete" || value === "partial" || value === "stale" || value === "unavailable") return value;
  return complete ? "complete" : "partial";
}

function relationTypeFromLegacy(role: TopologyGraphRelationType, label: string): TopologyGraphTypedRelationType {
  const normalizedLabel = label.toLowerCase();
  if (role === "owner") return "OWNS";
  if (role === "storage") {
    if (normalizedLabel.includes("storageclass") || normalizedLabel.includes("class")) return "USES_STORAGE_CLASS";
    if (normalizedLabel.includes("bind")) return "BINDS";
    return "MOUNTS";
  }
  if (role === "config") {
    if (normalizedLabel.includes("secret")) return "USES_SECRET";
    if (normalizedLabel.includes("serviceaccount")) return "USES_SERVICE_ACCOUNT";
    return "USES_CONFIG";
  }
  if (role === "policy") return "GOVERNS";
  if (role === "gateway") {
    if (normalizedLabel.includes("provision")) return "PROVISIONS";
    if (normalizedLabel.includes("accept")) return "ACCEPTS";
    return "ROUTES_TO";
  }
  if (normalizedLabel.includes("publish")) return "PUBLISHES";
  if (normalizedLabel.includes("resolve") || normalizedLabel.includes("endpoint")) return "RESOLVES";
  if (normalizedLabel.includes("ingress") || normalizedLabel.includes("route")) return "ROUTES_TO";
  return "SELECTS";
}

function normalizeRole(value: unknown, type?: TopologyGraphTypedRelationType): TopologyGraphRelationType {
  if (value === "owner" || value === "network" || value === "storage" || value === "config" || value === "policy" || value === "gateway") return value;
  if (type === "OWNS") return "owner";
  if (type === "MOUNTS" || type === "BINDS" || type === "USES_STORAGE_CLASS") return "storage";
  if (type === "USES_CONFIG" || type === "USES_SECRET" || type === "USES_SERVICE_ACCOUNT") return "config";
  if (type === "GOVERNS") return "policy";
  if (type === "PROVISIONS" || type === "ACCEPTS") return "gateway";
  return "network";
}

function normalizeTypedRelation(value: unknown, role: TopologyGraphRelationType, label: string): TopologyGraphTypedRelationType {
  const supported = new Set<TopologyGraphTypedRelationType>([
    "OWNS", "SELECTS", "PUBLISHES", "RESOLVES", "ROUTES_TO", "GOVERNS", "PROVISIONS",
    "ACCEPTS", "MOUNTS", "BINDS", "USES_STORAGE_CLASS", "USES_CONFIG", "USES_SECRET",
    "USES_SERVICE_ACCOUNT",
  ]);
  return typeof value === "string" && supported.has(value as TopologyGraphTypedRelationType)
    ? value as TopologyGraphTypedRelationType
    : relationTypeFromLegacy(role, label);
}

function normalizeEvidence(value: unknown): { labels: string[]; details: TopologyGraphRelationEvidence[] } {
  if (!Array.isArray(value)) return { labels: [], details: [] };
  const kinds = new Set<TopologyGraphEvidenceKind>([
    "ownerReference", "selector", "endpoint", "backendRef", "volume", "volumeClaim",
    "storageClass", "objectReference", "serviceAccount", "unknown",
  ]);
  const details = value.map((item): TopologyGraphRelationEvidence => {
    if (typeof item === "string") return { kind: "unknown", detail: item };
    const record = asObject(item);
    const rawKind = asString(record.kind, "unknown") as TopologyGraphEvidenceKind;
    const kind = kinds.has(rawKind) ? rawKind : "unknown";
    return {
      kind,
      detail: asString(record.detail, asString(record.value)),
      ...(asNullableString(record.fieldPath) ? { fieldPath: asString(record.fieldPath) } : {}),
    };
  });
  return { labels: details.map((item) => item.detail).filter(Boolean), details };
}

function normalizePorts(value: unknown): { labels: string[]; details: TopologyGraphRelationPort[] } {
  if (!Array.isArray(value)) return { labels: [], details: [] };
  const details = value.map((item): TopologyGraphRelationPort => {
    if (typeof item === "string") return { name: item };
    const record = asObject(item);
    return {
      ...(asNullableString(record.name) ? { name: asString(record.name) } : {}),
      ...(asNullableString(record.protocol) ? { protocol: asString(record.protocol) } : {}),
      ...(typeof record.port === "number" || typeof record.port === "string" ? { port: record.port } : {}),
      ...(typeof record.targetPort === "number" || typeof record.targetPort === "string" ? { targetPort: record.targetPort } : {}),
    };
  });
  const labels = details.map((port) => port.name ?? [port.protocol, port.port, port.targetPort ? `->${port.targetPort}` : ""].filter(Boolean).join(" ")).filter(Boolean);
  return { labels, details };
}

function makeIdentityKey(identity: TopologyGraphResourceIdentity): string {
  if (identity.uid) return `${identity.clusterId}:uid:${identity.uid}`;
  return [
    identity.clusterId,
    identity.apiVersion ?? "core",
    identity.kind,
    identity.namespace ?? "_cluster",
    identity.name,
  ].join(":");
}

function normalizeResource(value: unknown): TopologyGraphResource {
  const resource = asObject(value);
  const rawIdentity = asObject(resource.identity);
  const rawFreshness = asObject(resource.freshness);
  const identity: TopologyGraphResourceIdentity = {
    clusterId: asString(rawIdentity.clusterId, asString(resource.clusterId)),
    uid: asNullableString(rawIdentity.uid ?? resource.uid),
    apiVersion: asNullableString(rawIdentity.apiVersion ?? resource.apiVersion),
    resourceVersion: asNullableString(rawIdentity.resourceVersion ?? resource.resourceVersion),
    namespace: asNullableString(rawIdentity.namespace ?? resource.namespace),
    kind: asString(rawIdentity.kind, asString(resource.kind)),
    name: asString(rawIdentity.name, asString(resource.name)),
  };
  const identityKey = asString(resource.identityKey, makeIdentityKey(identity));
  return {
    id: asString(resource.id, identityKey),
    recordId: asString(resource.recordId),
    source: normalizeSource(resource.source),
    clusterId: identity.clusterId,
    namespace: identity.namespace,
    kind: identity.kind,
    name: identity.name,
    status: asString(resource.status, "unknown"),
    instanceName: asNullableString(resource.instanceName),
    nodeName: asNullableString(resource.nodeName),
    summary: asString(resource.summary),
    detailLines: asStringArray(resource.detailLines),
    tags: asStringArray(resource.tags),
    warnings: typeof resource.warnings === "number" ? resource.warnings : 0,
    identity,
    identityKey,
    observedAt: asNullableString(resource.observedAt ?? rawFreshness.observedAt),
  };
}

function normalizeRelation(value: unknown): TopologyGraphRelation {
  const relation = asObject(value);
  const label = asString(relation.label);
  const preliminaryType = typeof relation.type === "string" ? relation.type as TopologyGraphTypedRelationType : undefined;
  const role = normalizeRole(relation.role, preliminaryType);
  const type = normalizeTypedRelation(relation.type, role, label);
  const evidence = normalizeEvidence(relation.evidenceDetails ?? relation.evidence);
  const ports = normalizePorts(relation.portDetails ?? relation.ports);
  const rawConfidence = typeof relation.confidence === "number" ? relation.confidence : 1;
  return {
    id: asString(relation.id, `${type}:${asString(relation.source)}->${asString(relation.target)}`),
    role,
    type,
    source: asString(relation.source),
    target: asString(relation.target),
    label,
    direction: relation.direction === "inbound" ? "inbound" : "outbound",
    evidence: evidence.labels,
    evidenceDetails: evidence.details,
    confidence: Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence)),
    ports: ports.labels,
    portDetails: ports.details,
  };
}

function emptyCoverageSource(): TopologyGraphCoverageSource {
  return { records: 0, complete: false, status: "unavailable", lastSuccessfulAt: null, reason: null };
}

function normalizeCoverageSource(value: unknown): TopologyGraphCoverageSource {
  const source = asObject(value);
  const complete = source.complete === true || source.status === "complete";
  return {
    records: typeof source.records === "number" ? source.records : 0,
    complete,
    status: normalizeCoverageStatus(source.status, complete),
    lastSuccessfulAt: asNullableString(source.lastSuccessfulAt ?? source.dataAsOf),
    reason: asNullableString(source.reason),
  };
}

/** Normalize both persisted Graph V2 snapshots and the original V1 response. */
export function normalizeTopologyGraphResponse(value: unknown): TopologyGraphResponse {
  const response = asObject(value);
  const coverage = asObject(response.coverage);
  const rawSources = asObject(coverage.sources);
  const generatedAt = asString(response.generatedAt, asString(response.timestamp, new Date(0).toISOString()));
  const dataAsOf = asString(response.dataAsOf, generatedAt);
  const rawFreshness = asObject(response.freshness);
  const resources = Array.isArray(response.resources) ? response.resources.map(normalizeResource) : [];
  const relations = Array.isArray(response.relations) ? response.relations.map(normalizeRelation) : [];
  const sources = {
    workloads: rawSources.workloads ? normalizeCoverageSource(rawSources.workloads) : emptyCoverageSource(),
    network: rawSources.network ? normalizeCoverageSource(rawSources.network) : emptyCoverageSource(),
    storage: rawSources.storage ? normalizeCoverageSource(rawSources.storage) : emptyCoverageSource(),
    configuration: rawSources.configuration ? normalizeCoverageSource(rawSources.configuration) : emptyCoverageSource(),
  };
  if (rawSources.gateway) {
    const gateway = normalizeCoverageSource(rawSources.gateway);
    if (!rawSources.network) {
      sources.network = gateway;
    } else {
      sources.network.records += gateway.records;
      sources.network.complete = sources.network.complete && gateway.complete;
      if (sources.network.status === "complete" && gateway.status !== "complete") sources.network.status = gateway.status;
    }
  }
  const freshnessStatus = rawFreshness.status === "stale" || rawFreshness.status === "unavailable"
    ? rawFreshness.status
    : "fresh";
  return {
    schemaVersion: asString(response.schemaVersion, TOPOLOGY_GRAPH_SCHEMA_VERSION),
    revision: asString(response.revision, `legacy:${dataAsOf}`),
    generatedAt,
    dataAsOf,
    freshness: {
      status: freshnessStatus,
      observedAt: asNullableString(rawFreshness.observedAt ?? dataAsOf),
      ageMs: typeof rawFreshness.ageMs === "number" ? rawFreshness.ageMs : null,
      staleAfterMs: typeof rawFreshness.staleAfterMs === "number" ? rawFreshness.staleAfterMs : null,
    },
    resources: resources.sort((left, right) => left.identityKey.localeCompare(right.identityKey)),
    relations: relations.sort((left, right) => left.id.localeCompare(right.id)),
    coverage: {
      sources,
      warningRecords: typeof coverage.warningRecords === "number" ? coverage.warningRecords : 0,
    },
    timestamp: asString(response.timestamp, generatedAt),
  };
}

export async function getTopologyGraph(
  params: {
    clusterId?: string;
    namespace?: string;
    sources?: readonly TopologyGraphSource[];
  } = {},
  token?: string,
  requestOptions: ApiRequestSignalOptions = {},
): Promise<TopologyGraphResponse> {
  const response = await apiRequest<unknown>("/api/topology/graph", {
    method: "GET",
    query: {
      clusterId: params.clusterId,
      namespace: params.namespace,
      sources: params.sources?.join(","),
    },
    token,
    signal: requestOptions.signal,
  });
  return normalizeTopologyGraphResponse(response);
}

export async function getTopologyGraphV2(
  params: {
    clusterId: string;
    namespace?: string;
    sources?: readonly TopologyGraphSource[];
  },
  token?: string,
  requestOptions: ApiRequestSignalOptions = {},
): Promise<TopologyGraphResponse> {
  const response = await apiRequest<unknown>("/api/topology/graph/v2", {
    method: "GET",
    query: {
      clusterId: params.clusterId,
      namespace: params.namespace,
      sources: params.sources?.join(","),
    },
    token,
    signal: requestOptions.signal,
  });
  return normalizeTopologyGraphResponse(response);
}
