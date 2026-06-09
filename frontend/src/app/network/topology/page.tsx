"use client";

import "reactflow/dist/style.css";

import {
  AimOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  CheckOutlined,
  ClusterOutlined,
  CompressOutlined,
  CloseOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExpandOutlined,
  FileTextOutlined,
  FilterOutlined,
  GatewayOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Alert, Empty, Input, Skeleton, Tooltip } from "antd";
import { useRouter } from "next/navigation";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "reactflow";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsPageHeader } from "@/components/ops";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { listAutoscalingPolicies, type AutoscalingPolicyItem } from "@/lib/api/autoscaling";
import { getClusters } from "@/lib/api/clusters";
import { getConfigs, type ConfigResourceItem } from "@/lib/api/configs";
import type { Cluster } from "@/lib/api/types";
import { getNetworkResources, type NetworkResource } from "@/lib/api/network";
import {
  getDynamicResources,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
  type ResourceIdentity,
} from "@/lib/api/resources";
import { getStorageResources, type StorageResource } from "@/lib/api/storage";
import { getTopologyNamespaceSummaries, type TopologyNamespaceSummaryItem } from "@/lib/api/topology-summary";
import { getWorkloadsByKind, type WorkloadListItem } from "@/lib/api/workloads";
import { getClusterDisplayName } from "@/lib/cluster-display-name";

const ALL_NAMESPACE = "__all__";
const QUERY_STALE_MS = 30_000;
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 86;
const GROUP_WIDTH = 340;
const GROUP_HEADER = 44;
const STACK_GAP = 24;
const STACK_PREVIEW_LIMIT = 6;
const LARGE_GRAPH_STACK_PREVIEW_LIMIT = 4;
const LARGE_GRAPH_NODE_LIMIT = 80;
const LARGE_GRAPH_EDGE_LIMIT = 110;
const CHILD_NODE_STYLE = { width: NODE_WIDTH, height: NODE_HEIGHT } as const;
const EDGE_PATH_OPTIONS = { borderRadius: 24, offset: 28 } as const;
const EDGE_STYLE_DEFAULT = { strokeWidth: 1.45 } as const;
const EDGE_STYLE_OWNER = { strokeWidth: 1.7 } as const;
const EDGE_STYLE_RELATED = { strokeWidth: 2.1 } as const;
const NOOP_NODE_ACTIONS = {
  onSelect: () => undefined,
  onOpenEntity: () => undefined,
};
const handleReactFlowError = (id: string, message: string) => {
  if (id === "002") return;
  console.error(message);
};

const SOURCE_KEYS = ["workloads", "network", "storage", "configuration", "gateway"] as const;
type SourceKey = (typeof SOURCE_KEYS)[number];
type GroupBy = "namespace" | "instance" | "node";
type NodeStatus = "success" | "warning" | "error";

const KIND_LABEL: Record<string, string> = {
  Cluster: "集群",
  Namespace: "名称空间",
  Deployment: "Deployment",
  StatefulSet: "StatefulSet",
  DaemonSet: "DaemonSet",
  ReplicaSet: "ReplicaSet",
  Pod: "Pod",
  Job: "Job",
  CronJob: "CronJob",
  Service: "Service",
  Ingress: "Ingress",
  IngressRoute: "IngressRoute",
  Endpoints: "Endpoints",
  EndpointSlice: "EndpointSlice",
  NetworkPolicy: "NetworkPolicy",
  GatewayClass: "GatewayClass",
  Gateway: "Gateway",
  HTTPRoute: "HTTPRoute",
  PersistentVolume: "PV",
  PersistentVolumeClaim: "PVC",
  StorageClass: "StorageClass",
  ConfigMap: "ConfigMap",
  Secret: "Secret",
  ServiceAccount: "ServiceAccount",
  HorizontalPodAutoscaler: "HPA",
  VerticalPodAutoscaler: "VPA",
  Group: "分组",
};

const GROUP_BY_LABEL: Record<GroupBy, string> = {
  namespace: "名称空间",
  instance: "实例",
  node: "节点",
};
type TopologyKind =
  | "Cluster"
  | "Namespace"
  | "Deployment"
  | "StatefulSet"
  | "DaemonSet"
  | "ReplicaSet"
  | "Pod"
  | "Job"
  | "CronJob"
  | "Service"
  | "Ingress"
  | "IngressRoute"
  | "Endpoints"
  | "EndpointSlice"
  | "NetworkPolicy"
  | "GatewayClass"
  | "Gateway"
  | "HTTPRoute"
  | "PersistentVolume"
  | "PersistentVolumeClaim"
  | "StorageClass"
  | "ConfigMap"
  | "Secret"
  | "ServiceAccount"
  | "HorizontalPodAutoscaler"
  | "VerticalPodAutoscaler"
  | "Group";

type TopologyRaw =
  | WorkloadListItem
  | NetworkResource
  | StorageResource
  | ConfigResourceItem
  | AutoscalingPolicyItem
  | DynamicResourceItem
  | TopologyNamespaceSummaryItem
  | Cluster
  | Record<string, unknown>;

type TopologyNodeData = {
  label: string;
  subtitle: string;
  kind: TopologyKind | string;
  source: SourceKey | "scope";
  status: NodeStatus;
  namespace?: string;
  clusterId?: string;
  nodeName?: string;
  instance?: string;
  count?: number;
  collapsedCount?: number;
  detail?: TopologyDetailRequest | null;
  yaml?: TopologyYamlTarget | null;
  children?: GraphNodeEntity[];
  onSelect?: (id: string | null) => void;
  onOpenEntity?: (entity: GraphNodeEntity) => void;
};

type GraphEntity = {
  id: string;
  label: string;
  subtitle: string;
  kind: TopologyKind | string;
  source: SourceKey;
  namespace: string;
  clusterId: string;
  status: NodeStatus;
  weight: number;
  nodeName?: string;
  instance?: string;
  labels?: Record<string, string>;
  selector?: Record<string, string>;
  ownerRefs?: Array<Record<string, unknown>>;
  spec?: Record<string, unknown>;
  raw: TopologyRaw;
  detail: TopologyDetailRequest;
  yaml: TopologyYamlTarget | null;
};

type GraphNodeEntity = Pick<GraphEntity, "id" | "label" | "kind" | "status" | "detail" | "yaml">;

type GraphRelation = {
  id: string;
  source: string;
  target: string;
  label?: string;
  role: "owner" | "selector" | "network" | "storage" | "config" | "gateway" | "scope";
};

type GraphModel = {
  entities: GraphEntity[];
  relations: GraphRelation[];
  namespaces: string[];
  sourceCounts: Record<SourceKey, number>;
  statusCounts: Record<NodeStatus, number>;
};

type RelationSummaryItem = {
  id: string;
  label: string;
  kind: string;
  role: GraphRelation["role"];
  direction: "in" | "out";
  status: NodeStatus;
  entity: GraphEntity;
};

type TopologyDetailRequest = {
  kind: string;
  id: string;
  label?: string;
  snapshot?: {
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
    labels?: Record<string, string>;
  };
};

type TopologyYamlTarget = {
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
};

type TopologyView = {
  nodes: Node<TopologyNodeData>[];
  edges: Edge[];
};

type TopologyNodeActions = {
  onSelect: (id: string | null) => void;
  onOpenEntity: (entity: GraphNodeEntity) => void;
};

const TopologyNodeActionsContext = createContext<TopologyNodeActions>(NOOP_NODE_ACTIONS);

const SOURCE_META: Record<SourceKey, { label: string; icon: ReactNode; color: string; enabled: boolean }> = {
  workloads: { label: "工作负载", icon: <DeploymentUnitOutlined />, color: "#60a5fa", enabled: true },
  network: { label: "网络", icon: <BranchesOutlined />, color: "#22d3ee", enabled: true },
  storage: { label: "存储", icon: <DatabaseOutlined />, color: "#34d399", enabled: true },
  configuration: { label: "配置", icon: <AppstoreOutlined />, color: "#a78bfa", enabled: false },
  gateway: { label: "网关", icon: <GatewayOutlined />, color: "#f59e0b", enabled: false },
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  success: "正常",
  warning: "告警",
  error: "异常",
};

const RELATION_ROLE_LABEL: Record<GraphRelation["role"], string> = {
  owner: "归属",
  selector: "选择器",
  network: "网络",
  storage: "存储",
  config: "配置",
  gateway: "网关",
  scope: "作用域",
};

const KIND_META: Record<string, { color: string; icon: ReactNode; source: SourceKey | "scope"; weight: number }> = {
  Cluster: { color: "#8b5cf6", icon: <ClusterOutlined />, source: "scope", weight: 1100 },
  Namespace: { color: "#94a3b8", icon: <AppstoreOutlined />, source: "scope", weight: 1080 },
  Deployment: { color: "#60a5fa", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 980 },
  StatefulSet: { color: "#60a5fa", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 960 },
  DaemonSet: { color: "#60a5fa", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 960 },
  ReplicaSet: { color: "#38bdf8", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 940 },
  Pod: { color: "#22c55e", icon: <ApiOutlined />, source: "workloads", weight: 800 },
  Job: { color: "#93c5fd", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 920 },
  CronJob: { color: "#93c5fd", icon: <DeploymentUnitOutlined />, source: "workloads", weight: 940 },
  Service: { color: "#22d3ee", icon: <BranchesOutlined />, source: "network", weight: 790 },
  Ingress: { color: "#06b6d4", icon: <GatewayOutlined />, source: "network", weight: 780 },
  IngressRoute: { color: "#06b6d4", icon: <GatewayOutlined />, source: "network", weight: 780 },
  Endpoints: { color: "#67e8f9", icon: <BranchesOutlined />, source: "network", weight: 770 },
  EndpointSlice: { color: "#67e8f9", icon: <BranchesOutlined />, source: "network", weight: 770 },
  NetworkPolicy: { color: "#f97316", icon: <FilterOutlined />, source: "network", weight: 770 },
  GatewayClass: { color: "#f59e0b", icon: <GatewayOutlined />, source: "gateway", weight: 800 },
  Gateway: { color: "#f59e0b", icon: <GatewayOutlined />, source: "gateway", weight: 790 },
  HTTPRoute: { color: "#fbbf24", icon: <GatewayOutlined />, source: "gateway", weight: 780 },
  PersistentVolume: { color: "#10b981", icon: <DatabaseOutlined />, source: "storage", weight: 780 },
  PersistentVolumeClaim: { color: "#34d399", icon: <DatabaseOutlined />, source: "storage", weight: 770 },
  StorageClass: { color: "#059669", icon: <DatabaseOutlined />, source: "storage", weight: 760 },
  ConfigMap: { color: "#a78bfa", icon: <FileTextOutlined />, source: "configuration", weight: 760 },
  Secret: { color: "#c084fc", icon: <FileTextOutlined />, source: "configuration", weight: 760 },
  ServiceAccount: { color: "#818cf8", icon: <FileTextOutlined />, source: "configuration", weight: 750 },
  HorizontalPodAutoscaler: { color: "#f97316", icon: <ExpandOutlined />, source: "workloads", weight: 760 },
  VerticalPodAutoscaler: { color: "#fb923c", icon: <ExpandOutlined />, source: "workloads", weight: 755 },
  Group: { color: "#94a3b8", icon: <AppstoreOutlined />, source: "scope", weight: 1000 },
};

const WORKLOAD_KINDS = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod", "Job", "CronJob"] as const;
const NETWORK_KINDS = ["Service", "Ingress", "IngressRoute", "Endpoints", "EndpointSlice", "NetworkPolicy"] as const;
const STORAGE_KINDS = ["PV", "PVC", "SC"] as const;
const CONFIG_KINDS = ["configmaps", "secrets"] as const;
const DYNAMIC_SOURCES = [
  { source: "gateway" as SourceKey, group: "gateway.networking.k8s.io", version: "v1", resource: "gatewayclasses", kind: "GatewayClass", namespaced: false },
  { source: "gateway" as SourceKey, group: "gateway.networking.k8s.io", version: "v1", resource: "gateways", kind: "Gateway", namespaced: true },
  { source: "gateway" as SourceKey, group: "gateway.networking.k8s.io", version: "v1", resource: "httproutes", kind: "HTTPRoute", namespaced: true },
  { source: "configuration" as SourceKey, group: "", version: "v1", resource: "serviceaccounts", kind: "ServiceAccount", namespaced: true },
];

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeLabels(value: unknown): Record<string, string> | undefined {
  const record = normalizeRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getSpec(raw: unknown): Record<string, unknown> | undefined {
  return normalizeRecord((raw as { spec?: unknown })?.spec);
}

function readResourceStatus(raw: unknown): Record<string, unknown> | undefined {
  const record = raw as { statusJson?: unknown; status?: unknown };
  return normalizeRecord(record.statusJson) ?? normalizeRecord(record.status);
}

function getLabels(raw: unknown): Record<string, string> | undefined {
  return normalizeLabels((raw as { labels?: unknown })?.labels) ?? normalizeLabels(normalizeRecord((raw as { metadata?: unknown })?.metadata)?.labels);
}

function getInstance(labels?: Record<string, string>): string | undefined {
  return labels?.["app.kubernetes.io/instance"] ?? labels?.app ?? labels?.release;
}

function resolveNodeStatus(raw: unknown, kind: string): NodeStatus {
  const record = raw as { state?: unknown; status?: unknown; podPhase?: unknown; readyReplicas?: unknown; replicas?: unknown };
  const state = String(record.state ?? "").toLowerCase();
  const status = String(record.status ?? record.podPhase ?? "").toLowerCase();
  if (state === "deleted" || state === "disabled") return "warning";
  if (["failed", "error", "degraded", "crashloopbackoff", "imagepullbackoff"].some((item) => status.includes(item))) return "error";
  if (["pending", "unknown", "warning"].some((item) => status.includes(item))) return "warning";
  if (kind !== "Pod" && typeof record.replicas === "number" && typeof record.readyReplicas === "number" && record.readyReplicas < record.replicas) {
    return record.readyReplicas === 0 ? "error" : "warning";
  }
  return "success";
}

function makeEntityId(kind: string, clusterId: string, namespace: string, name: string) {
  return [clusterId || "cluster", namespace || "cluster", kind, name].map((part) => encodeURIComponent(part)).join("/");
}

function makeDetail(raw: { kind: string; id: string; name: string; spec?: Record<string, unknown>; status?: Record<string, unknown>; labels?: Record<string, string> }): TopologyDetailRequest {
  return {
    kind: raw.kind,
    id: raw.id,
    label: raw.name,
    snapshot: {
      spec: raw.spec,
      status: raw.status,
      labels: raw.labels,
    },
  };
}

function makeYaml(clusterId: string, namespace: string, kind: string, name: string): TopologyYamlTarget | null {
  if (!clusterId || !kind || !name) return null;
  const clusterScoped = kind === "PersistentVolume" || kind === "StorageClass";
  return { identity: { clusterId, namespace: clusterScoped ? "default" : namespace || "default", kind, name } };
}

function makeDynamicYaml(item: DynamicResourceItem, meta: (typeof DYNAMIC_SOURCES)[number]): TopologyYamlTarget {
  const dynamicIdentity: DynamicResourceIdentity = {
    clusterId: item.clusterId,
    group: meta.group,
    version: meta.version,
    resource: meta.resource,
    namespace: meta.namespaced ? item.namespace : undefined,
    name: item.name,
  };
  return {
    identity: {
      clusterId: item.clusterId,
      namespace: item.namespace ?? "",
      kind: meta.resource,
      name: item.name,
    },
    dynamicIdentity,
  };
}

function normalizeStorageKind(kind: StorageResource["kind"]) {
  if (kind === "PV") return "PersistentVolume";
  if (kind === "PVC") return "PersistentVolumeClaim";
  return "StorageClass";
}

function storageToEntity(item: StorageResource): GraphEntity {
  const kind = normalizeStorageKind(item.kind);
  const labels = getLabels(item);
  const spec = getSpec(item);
  const namespace = item.namespace || "cluster";
  const id = item.id || makeEntityId(kind, item.clusterId, namespace, item.name);
  return {
    id,
    label: item.name,
    subtitle: kind,
    kind,
    source: "storage",
    namespace,
    clusterId: item.clusterId,
    status: resolveNodeStatus(item, kind),
    weight: KIND_META[kind]?.weight ?? 500,
    labels,
    spec,
    raw: item,
    detail: makeDetail({ kind, id, name: item.name, spec, status: readResourceStatus(item), labels }),
    yaml: makeYaml(item.clusterId, namespace, kind, item.name),
  };
}

function configToEntity(item: ConfigResourceItem): GraphEntity {
  const kind = item.kind;
  const labels = getLabels(item);
  const id = item.id || makeEntityId(kind, item.clusterId, item.namespace, item.name);
  return {
    id,
    label: item.name,
    subtitle: kind,
    kind,
    source: "configuration",
    namespace: item.namespace || "default",
    clusterId: item.clusterId,
    status: resolveNodeStatus(item, kind),
    weight: KIND_META[kind]?.weight ?? 500,
    labels,
    raw: item,
    detail: makeDetail({ kind, id, name: item.name, labels }),
    yaml: makeYaml(item.clusterId, item.namespace, kind, item.name),
  };
}

function autoscalingToEntity(item: AutoscalingPolicyItem): GraphEntity {
  const kind = item.type === "HPA" ? "HorizontalPodAutoscaler" : "VerticalPodAutoscaler";
  const name = item.resourceName || `${item.workloadName}-${item.type.toLowerCase()}`;
  const spec = { workloadKind: item.workloadKind, workloadName: item.workloadName, config: item.config };
  const detailId = [item.clusterId, item.namespace, name].join("/");
  return {
    id: item.id || makeEntityId(kind, item.clusterId, item.namespace, name),
    label: name,
    subtitle: kind,
    kind,
    source: "workloads",
    namespace: item.namespace || "default",
    clusterId: item.clusterId,
    status: resolveNodeStatus(item, kind),
    weight: KIND_META[kind]?.weight ?? 500,
    spec,
    raw: item,
    detail: makeDetail({ kind, id: detailId, name, spec }),
    yaml: makeYaml(item.clusterId, item.namespace, kind, name),
  };
}

function workloadToEntity(item: WorkloadListItem): GraphEntity {
  const kind = item.kind || "Workload";
  const labels = getLabels(item);
  const spec = getSpec(item);
  const status = resolveNodeStatus(item, kind);
  const id = item.id || makeEntityId(kind, item.clusterId, item.namespace, item.name);
  const selector = normalizeLabels(item.selector) ?? normalizeLabels(normalizeRecord(normalizeRecord(spec?.selector)?.matchLabels));
  const ownerRefs = Array.isArray(item.ownerRefs) ? (item.ownerRefs as Array<Record<string, unknown>>) : [];
  return {
    id,
    label: item.name,
    subtitle: kind,
    kind,
    source: "workloads",
    namespace: item.namespace || "default",
    clusterId: item.clusterId,
    status,
    weight: KIND_META[kind]?.weight ?? 500,
    nodeName: item.nodeName ?? undefined,
    instance: getInstance(labels),
    labels,
    selector,
    ownerRefs,
    spec,
    raw: item,
    detail: makeDetail({ kind, id, name: item.name, spec, status: readResourceStatus(item), labels }),
    yaml: makeYaml(item.clusterId, item.namespace, kind, item.name),
  };
}

function networkToEntity(item: NetworkResource): GraphEntity {
  const kind = item.kind;
  const labels = getLabels(item);
  const spec = getSpec(item);
  const id = item.id || makeEntityId(kind, item.clusterId, item.namespace, item.name);
  return {
    id,
    label: item.name,
    subtitle: kind,
    kind,
    source: "network",
    namespace: item.namespace || "default",
    clusterId: item.clusterId,
    status: resolveNodeStatus(item, kind),
    weight: KIND_META[kind]?.weight ?? 500,
    instance: getInstance(labels),
    labels,
    selector: normalizeLabels(normalizeRecord(spec?.selector)),
    spec,
    raw: item,
    detail: makeDetail({ kind, id, name: item.name, spec, status: readResourceStatus(item), labels }),
    yaml: makeYaml(item.clusterId, item.namespace, kind, item.name),
  };
}

function dynamicToEntity(item: DynamicResourceItem, meta: (typeof DYNAMIC_SOURCES)[number]): GraphEntity {
  const labels = getLabels(item);
  const kind = item.kind || meta.kind;
  const id = item.id || makeEntityId(kind, item.clusterId, item.namespace ?? "", item.name);
  const yaml = makeDynamicYaml(item, meta);
  return {
    id,
    label: item.name,
    subtitle: kind,
    kind,
    source: meta.source,
    namespace: item.namespace || "cluster",
    clusterId: item.clusterId,
    status: resolveNodeStatus(item, kind),
    weight: KIND_META[kind]?.weight ?? 500,
    instance: getInstance(labels),
    labels,
    raw: item,
    detail: {
      kind: "dynamic",
      id: ["dynamic", item.clusterId, meta.group, meta.version, meta.resource, item.namespace || "", item.name].join(":"),
      label: item.name,
      snapshot: { labels },
    },
    yaml,
  };
}

function labelsMatch(selector: Record<string, string> | undefined, labels: Record<string, string> | undefined) {
  if (!selector || !labels || Object.keys(selector).length === 0) return false;
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function sameScope(left: GraphEntity, right: GraphEntity) {
  if (left.clusterId !== right.clusterId) return false;
  if (!left.namespace || !right.namespace || left.namespace === "cluster" || right.namespace === "cluster") return true;
  return left.namespace === right.namespace;
}

function getResourceUid(entity: GraphEntity) {
  return readString((entity.raw as { uid?: unknown })?.uid) ?? readString(normalizeRecord((entity.raw as { metadata?: unknown })?.metadata)?.uid);
}

function makeKindNameKey(clusterId: string, kind: string, name: string) {
  return `${clusterId}:${kind}:${name}`;
}

function toGraphNodeEntity(entity: GraphEntity): GraphNodeEntity {
  return {
    id: entity.id,
    label: entity.label,
    kind: entity.kind,
    status: entity.status,
    detail: entity.detail,
    yaml: entity.yaml,
  };
}

function specServiceName(entity: GraphEntity): string | undefined {
  const spec = entity.spec;
  const rules = Array.isArray(spec?.rules) ? spec.rules : [];
  for (const rule of rules) {
    const http = normalizeRecord(normalizeRecord(rule)?.http);
    const paths = Array.isArray(http?.paths) ? http.paths : [];
    for (const path of paths) {
      const backend = normalizeRecord(normalizeRecord(path)?.backend);
      const service = normalizeRecord(backend?.service);
      const name = readString(service?.name);
      if (name) return name;
    }
  }
  return readString(normalizeRecord(spec?.backendRef)?.name);
}

function podSpecOf(entity: GraphEntity): Record<string, unknown> | undefined {
  if (entity.kind === "Pod") return entity.spec;
  return normalizeRecord(normalizeRecord(entity.spec?.template)?.spec);
}

function extractVolumeRefs(entity: GraphEntity) {
  const podSpec = podSpecOf(entity);
  const refs: Array<{ kind: "PersistentVolumeClaim" | "ConfigMap" | "Secret"; name: string }> = [];
  const volumes = Array.isArray(podSpec?.volumes) ? podSpec.volumes : [];
  volumes.forEach((volume) => {
    const record = normalizeRecord(volume);
    const pvc = readString(normalizeRecord(record?.persistentVolumeClaim)?.claimName);
    const configMap = readString(normalizeRecord(record?.configMap)?.name);
    const secret = readString(normalizeRecord(record?.secret)?.secretName);
    if (pvc) refs.push({ kind: "PersistentVolumeClaim", name: pvc });
    if (configMap) refs.push({ kind: "ConfigMap", name: configMap });
    if (secret) refs.push({ kind: "Secret", name: secret });
  });
  return refs;
}

function extractServiceAccountName(entity: GraphEntity) {
  return readString(podSpecOf(entity)?.serviceAccountName);
}

function storageClassName(entity: GraphEntity) {
  return readString(entity.spec?.storageClassName) ?? readString((entity.raw as { storageClass?: unknown })?.storageClass);
}

function claimVolumeName(entity: GraphEntity) {
  return readString(entity.spec?.volumeName);
}

function autoscalingTarget(entity: GraphEntity) {
  const raw = entity.raw as AutoscalingPolicyItem;
  return { kind: raw.workloadKind, name: raw.workloadName };
}

function buildRelations(entities: GraphEntity[]): GraphRelation[] {
  const relations: GraphRelation[] = [];
  const relationIds = new Set<string>();
  const byKind = new Map<string, GraphEntity[]>();
  const byUid = new Map<string, GraphEntity>();
  const byKindName = new Map<string, GraphEntity[]>();
  entities.forEach((entity) => {
    const items = byKind.get(entity.kind);
    if (items) items.push(entity);
    else byKind.set(entity.kind, [entity]);
    const uid = getResourceUid(entity);
    if (uid) byUid.set(uid, entity);
    byUid.set(entity.id, entity);
    const kindNameKey = makeKindNameKey(entity.clusterId, entity.kind, entity.label);
    const kindNameItems = byKindName.get(kindNameKey);
    if (kindNameItems) kindNameItems.push(entity);
    else byKindName.set(kindNameKey, [entity]);
  });
  const push = (source: GraphEntity, target: GraphEntity, label: string, role: GraphRelation["role"]) => {
    if (source.id === target.id) return;
    const id = `${role}:${source.id}->${target.id}`;
    if (relationIds.has(id)) return;
    relationIds.add(id);
    relations.push({ id, source: source.id, target: target.id, label, role });
  };

  entities.forEach((entity) => {
    entity.ownerRefs?.forEach((ref) => {
      const uidTarget = readString(ref.uid) ? byUid.get(readString(ref.uid)!) : undefined;
      if (uidTarget && sameScope(entity, uidTarget)) push(uidTarget, entity, "owns", "owner");
      const kind = readString(ref.kind);
      const name = readString(ref.name);
      if (!kind || !name) return;
      (byKindName.get(makeKindNameKey(entity.clusterId, kind, name)) ?? []).forEach((target) => {
        if (target.id !== uidTarget?.id && sameScope(entity, target)) push(target, entity, "owns", "owner");
      });
    });
  });

  const pods = byKind.get("Pod") ?? [];
  (byKind.get("Service") ?? []).forEach((service) => {
    pods.forEach((pod) => {
      if (sameScope(service, pod) && labelsMatch(service.selector, pod.labels)) push(service, pod, "selects", "network");
    });
  });
  [...(byKind.get("Ingress") ?? []), ...(byKind.get("IngressRoute") ?? [])].forEach((ingress) => {
    const serviceName = specServiceName(ingress);
    (byKind.get("Service") ?? []).forEach((service) => {
      if (sameScope(ingress, service) && serviceName && service.label === serviceName) push(ingress, service, "routes", "network");
    });
  });
  (byKind.get("HTTPRoute") ?? []).forEach((route) => {
    const spec = route.spec;
    const parentRefs = Array.isArray(spec?.parentRefs) ? spec.parentRefs : [];
    (byKind.get("Gateway") ?? []).forEach((gateway) => {
      if (sameScope(route, gateway) && parentRefs.some((ref) => readString(normalizeRecord(ref)?.name) === gateway.label)) push(route, gateway, "parents", "gateway");
    });
    const rules = Array.isArray(spec?.rules) ? spec.rules : [];
    const backendNames = new Set<string>();
    rules.forEach((rule) => {
      const refs = Array.isArray(normalizeRecord(rule)?.backendRefs) ? (normalizeRecord(rule)?.backendRefs as unknown[]) : [];
      refs.forEach((ref) => {
        const name = readString(normalizeRecord(ref)?.name);
        if (name) backendNames.add(name);
      });
    });
    (byKind.get("Service") ?? []).forEach((service) => {
      if (sameScope(route, service) && backendNames.has(service.label)) push(route, service, "routes", "gateway");
    });
  });
  (byKind.get("Gateway") ?? []).forEach((gateway) => {
    const className = readString(gateway.spec?.gatewayClassName);
    (byKind.get("GatewayClass") ?? []).forEach((gatewayClass) => {
      if (gateway.clusterId === gatewayClass.clusterId && className === gatewayClass.label) push(gateway, gatewayClass, "class", "gateway");
    });
  });
  (byKind.get("NetworkPolicy") ?? []).forEach((policy) => {
    const selector = normalizeLabels(normalizeRecord(normalizeRecord(policy.spec?.podSelector)?.matchLabels));
    pods.forEach((pod) => {
      if (sameScope(policy, pod) && labelsMatch(selector, pod.labels)) push(policy, pod, "policy", "network");
    });
  });
  [...(byKind.get("HorizontalPodAutoscaler") ?? []), ...(byKind.get("VerticalPodAutoscaler") ?? [])].forEach((policy) => {
    const target = autoscalingTarget(policy);
    (byKind.get(target.kind) ?? []).forEach((entity) => {
      if (sameScope(policy, entity) && entity.kind === target.kind && entity.label === target.name) push(policy, entity, "scales", "owner");
    });
  });
  entities.filter((entity) => entity.source === "workloads").forEach((workload) => {
    const refs = extractVolumeRefs(workload);
    refs.forEach((ref) => {
      (byKind.get(ref.kind) ?? []).forEach((target) => {
        if (sameScope(workload, target) && target.label === ref.name) push(workload, target, ref.kind === "PersistentVolumeClaim" ? "mounts" : "uses", ref.kind === "PersistentVolumeClaim" ? "storage" : "config");
      });
    });
    const serviceAccount = extractServiceAccountName(workload);
    if (serviceAccount) {
      (byKind.get("ServiceAccount") ?? []).forEach((target) => {
        if (sameScope(workload, target) && target.label === serviceAccount) push(workload, target, "runs-as", "config");
      });
    }
  });
  (byKind.get("PersistentVolumeClaim") ?? []).forEach((pvc) => {
    const volumeName = claimVolumeName(pvc);
    (byKind.get("PersistentVolume") ?? []).forEach((pv) => {
      if (pvc.clusterId === pv.clusterId && volumeName && pv.label === volumeName) push(pvc, pv, "binds", "storage");
    });
    const scName = storageClassName(pvc);
    (byKind.get("StorageClass") ?? []).forEach((sc) => {
      if (pvc.clusterId === sc.clusterId && scName && sc.label === scName) push(pvc, sc, "class", "storage");
    });
  });
  (byKind.get("PersistentVolume") ?? []).forEach((pv) => {
    const scName = storageClassName(pv);
    (byKind.get("StorageClass") ?? []).forEach((sc) => {
      if (pv.clusterId === sc.clusterId && scName && sc.label === scName) push(pv, sc, "class", "storage");
    });
  });
  return relations;
}

function buildGraphModel({
  workloads,
  network,
  storage,
  configs,
  autoscaling,
  dynamic,
}: {
  workloads: WorkloadListItem[];
  network: NetworkResource[];
  storage: StorageResource[];
  configs: ConfigResourceItem[];
  autoscaling: AutoscalingPolicyItem[];
  dynamic: Array<{ item: DynamicResourceItem; meta: (typeof DYNAMIC_SOURCES)[number] }>;
}): GraphModel {
  const entities = [
    ...workloads.map(workloadToEntity),
    ...network.map(networkToEntity),
    ...storage.map(storageToEntity),
    ...configs.map(configToEntity),
    ...autoscaling.map(autoscalingToEntity),
    ...dynamic.map(({ item, meta }) => dynamicToEntity(item, meta)),
  ];
  const unique = Array.from(new Map(entities.map((entity) => [entity.id, entity])).values());
  const sourceCounts = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0])) as Record<SourceKey, number>;
  const statusCounts: Record<NodeStatus, number> = { success: 0, warning: 0, error: 0 };
  unique.forEach((entity) => {
    sourceCounts[entity.source] += 1;
    statusCounts[entity.status] += 1;
  });
  return {
    entities: unique,
    relations: buildRelations(unique),
    namespaces: Array.from(new Set(unique.map((entity) => entity.namespace).filter((item) => item && item !== "cluster"))).sort(),
    sourceCounts,
    statusCounts,
  };
}

function getGroupKey(entity: GraphEntity, groupBy: GroupBy) {
  if (groupBy === "namespace") return entity.namespace || "default";
  if (groupBy === "node") return entity.nodeName || "Unscheduled";
  return entity.instance || "Ungrouped";
}

function getGroupLabel(groupBy: GroupBy) {
  return GROUP_BY_LABEL[groupBy];
}

function getTopologyLayer(entity: GraphEntity): number {
  if (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob"].includes(entity.kind)) return 0;
  if (entity.kind === "Pod") return 1;
  if (["Service", "NetworkPolicy", "Ingress", "IngressRoute", "Gateway", "HTTPRoute"].includes(entity.kind)) return 2;
  if (["Endpoints", "EndpointSlice", "GatewayClass"].includes(entity.kind)) return 3;
  return 2;
}

function getLayeredChildPosition(entity: GraphEntity, layerIndexes: Map<number, number>) {
  const layer = getTopologyLayer(entity);
  const index = layerIndexes.get(layer) ?? 0;
  layerIndexes.set(layer, index + 1);
  return {
    x: 24 + layer * (NODE_WIDTH + 96),
    y: GROUP_HEADER + 16 + index * (NODE_HEIGHT + 28),
  };
}

function getConnectedEntityIds(seedId: string, relations: GraphRelation[]) {
  const graph = new Map<string, Set<string>>();
  relations.forEach((relation) => {
    if (!graph.has(relation.source)) graph.set(relation.source, new Set());
    if (!graph.has(relation.target)) graph.set(relation.target, new Set());
    graph.get(relation.source)?.add(relation.target);
    graph.get(relation.target)?.add(relation.source);
  });
  const seen = new Set<string>([seedId]);
  const queue = [seedId];
  while (queue.length) {
    const current = queue.shift()!;
    graph.get(current)?.forEach((next) => {
      if (seen.has(next)) return;
      seen.add(next);
      queue.push(next);
    });
  }
  return seen;
}

function getResourcePagePath(kind: string): string | null {
  const map: Record<string, string> = {
    Pod: "/workloads/pods",
    Deployment: "/workloads/deployments",
    StatefulSet: "/workloads/statefulsets",
    DaemonSet: "/workloads/daemonsets",
    ReplicaSet: "/workloads/replicasets",
    Job: "/workloads/jobs",
    CronJob: "/workloads/cronjobs",
    Service: "/network/services",
    Ingress: "/network/ingress",
    IngressRoute: "/network/ingressroute",
    Endpoints: "/network/endpoints",
    EndpointSlice: "/network/endpointslices",
    NetworkPolicy: "/network/networkpolicy",
    GatewayClass: "/network/gateway-api",
    Gateway: "/network/gateway-api",
    HTTPRoute: "/network/gateway-api",
    PersistentVolume: "/storage/pv",
    PersistentVolumeClaim: "/storage/pvc",
    StorageClass: "/storage/sc",
    ConfigMap: "/configs/configmaps",
    Secret: "/configs/secrets",
    ServiceAccount: "/configs/serviceaccounts",
    HorizontalPodAutoscaler: "/workloads/autoscaling/hpa",
    VerticalPodAutoscaler: "/workloads/autoscaling/vpa",
  };
  return map[kind] ?? null;
}

function getGatewayKindParam(kind: string): string | null {
  if (kind === "GatewayClass") return "gatewayclass";
  if (kind === "Gateway") return "gateway";
  if (kind === "HTTPRoute") return "httproute";
  return null;
}

function buildResourcePageUrl(data: Pick<TopologyNodeData, "kind" | "clusterId" | "namespace" | "label">): string | null {
  const path = getResourcePagePath(String(data.kind));
  if (!path) return null;
  const params = new URLSearchParams();
  if (data.clusterId) params.set("clusterId", data.clusterId);
  if (data.namespace && data.namespace !== "cluster") params.set("namespace", data.namespace);
  if (data.label) params.set("keyword", data.label);
  const gatewayKind = getGatewayKindParam(String(data.kind));
  if (gatewayKind) params.set("kind", gatewayKind);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function countByStatus(items: Array<{ status: NodeStatus }>) {
  return items.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { success: 0, warning: 0, error: 0 } as Record<NodeStatus, number>,
  );
}

function getTopKindCounts(items: GraphNodeEntity[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5);
}

function getRelationSummaries(node: Node<TopologyNodeData> | null, model: GraphModel): RelationSummaryItem[] {
  if (!node || node.data.kind === "Group") return [];
  const entityById = new Map(model.entities.map((entity) => [entity.id, entity]));
  return model.relations.flatMap((relation) => {
    if (relation.source !== node.id && relation.target !== node.id) return [];
    const direction = relation.source === node.id ? "out" : "in";
    const relatedId = direction === "out" ? relation.target : relation.source;
    const entity = entityById.get(relatedId);
    if (!entity) return [];
    return [{
      id: `${relation.id}:${direction}`,
      label: entity.label,
      kind: entity.kind,
      role: relation.role,
      direction,
      status: entity.status,
      entity,
    }];
  });
}

function getTopDensityKinds(model: GraphModel) {
  const counts = new Map<string, number>();
  model.entities.forEach((entity) => {
    if (!["storage", "configuration", "network", "gateway"].includes(entity.source)) return;
    counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6);
}

function DensityOverview({ model }: { model: GraphModel }) {
  const densitySources = (["network", "storage", "configuration", "gateway"] as SourceKey[])
    .map((source) => {
      const entities = model.entities.filter((entity) => entity.source === source);
      return {
        source,
        count: entities.length,
        status: countByStatus(entities),
      };
    });
  const relationRows = (["network", "storage", "config", "gateway"] as GraphRelation["role"][])
    .map((role) => ({
      role,
      count: model.relations.filter((relation) => relation.role === role).length,
    }));
  const topKinds = getTopDensityKinds(model);
  return (
    <div className="resource-map-density">
      <div className="resource-map-density__hero">
        <span>资源密度</span>
        <strong>{model.entities.length}</strong>
        <small>{model.relations.length} 条关系 / {model.statusCounts.error + model.statusCounts.warning} 个风险</small>
      </div>
      <div className="resource-map-density-grid">
        {densitySources.map((item) => (
          <div key={item.source} className="resource-map-density-card" style={{ "--density-color": SOURCE_META[item.source].color } as React.CSSProperties}>
            <span className="resource-map-density-card__icon">{SOURCE_META[item.source].icon}</span>
            <div>
              <strong>{SOURCE_META[item.source].label}</strong>
              <small>{item.count} 资源</small>
            </div>
            <em>{item.status.error ? `${item.status.error} 异常` : item.status.warning ? `${item.status.warning} 告警` : "稳定"}</em>
          </div>
        ))}
      </div>
      <div className="resource-map-density-panel">
        <div className="resource-map-section-title">关系分布</div>
        {relationRows.map((row) => (
          <div key={row.role} className="resource-map-density-row">
            <span>{RELATION_ROLE_LABEL[row.role]}</span>
            <i style={{ "--density-scale": `${Math.min(100, Math.max(4, row.count * 10))}%` } as React.CSSProperties} />
            <strong>{row.count}</strong>
          </div>
        ))}
      </div>
      {topKinds.length ? (
        <div className="resource-map-density-panel">
          <div className="resource-map-section-title">高频类型</div>
          <div className="resource-map-kind-strip">
            {topKinds.map(([kind, count]) => (
              <span key={kind}>{KIND_LABEL[kind] ?? kind}<strong>{count}</strong></span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getCopyValue(node: Node<TopologyNodeData>) {
  if (node.data.kind === "Group") return node.data.label;
  return [node.data.namespace, node.data.label].filter(Boolean).join("/");
}

function getYamlDisabledReason(node: Node<TopologyNodeData>) {
  if (node.data.yaml) return null;
  if (node.data.kind === "Group") return "分组没有单一 YAML";
  return "当前节点缺少可解析资源身份";
}

function buildVisibleGraph(model: GraphModel, options: { selectedSources: Set<SourceKey>; namespace: string; query: string; errorsOnly: boolean; groupBy: GroupBy; selectedId?: string | null; expandAll: boolean; }) {
  const query = options.query.trim().toLowerCase();
  const isLargeGraph = model.entities.length > LARGE_GRAPH_NODE_LIMIT || model.relations.length > LARGE_GRAPH_EDGE_LIMIT;
  const stackPreviewLimit = isLargeGraph ? LARGE_GRAPH_STACK_PREVIEW_LIMIT : STACK_PREVIEW_LIMIT;
  const filtered = model.entities.filter((entity) => {
    if (!options.selectedSources.has(entity.source)) return false;
    if (options.namespace !== ALL_NAMESPACE && entity.namespace !== options.namespace) return false;
    if (options.errorsOnly && entity.status === "success") return false;
    if (query && !`${entity.label} ${entity.subtitle} ${entity.namespace} ${entity.kind}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const ids = new Set(filtered.map((entity) => entity.id));
  const entityById = new Map(filtered.map((entity) => [entity.id, entity]));
  const relations = model.relations.filter((relation) => ids.has(relation.source) && ids.has(relation.target));
  const selectedEntity = options.selectedId ? filtered.find((entity) => entity.id === options.selectedId) : undefined;
  const groups = new Map<string, GraphEntity[]>();
  filtered.forEach((entity) => {
    const key = getGroupKey(entity, options.groupBy);
    const items = groups.get(key);
    if (items) items.push(entity);
    else groups.set(key, [entity]);
  });

  const groupEntries = Array.from(groups.entries()).sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const nodes: Node<TopologyNodeData>[] = [];
  const groupIds = new Map<string, string>();
  const entityVisibleIds = new Set<string>();
  const selectedGroupKey = selectedEntity ? getGroupKey(selectedEntity, options.groupBy) : null;
  const selectedGroupId = options.selectedId?.startsWith(`group:${options.groupBy}:`) ? options.selectedId : null;
  const focusedIds = selectedEntity ? getConnectedEntityIds(selectedEntity.id, relations) : null;

  groupEntries.forEach(([groupKey, children], groupIndex) => {
    const orderedChildren = [...children].sort(
      (left, right) => getTopologyLayer(left) - getTopologyLayer(right) || right.weight - left.weight || left.label.localeCompare(right.label),
    );
    const groupId = `group:${options.groupBy}:${groupKey}`;
    const isFocusedGroup = groupKey === selectedGroupKey || selectedGroupId === groupId;
    const expanded = (options.expandAll && filtered.length <= 50) || isFocusedGroup;
    const visibleChildren = focusedIds && groupKey === selectedGroupKey ? orderedChildren.filter((entity) => focusedIds.has(entity.id)) : orderedChildren;
    const previewChildren = orderedChildren.slice(0, stackPreviewLimit);
    groupIds.set(groupKey, groupId);
    const layerCounts = visibleChildren.reduce((counts, entity) => {
      const layer = getTopologyLayer(entity);
      counts.set(layer, (counts.get(layer) ?? 0) + 1);
      return counts;
    }, new Map<number, number>());
    const maxLayer = Math.max(0, ...Array.from(layerCounts.keys()));
    const maxRows = Math.max(1, ...Array.from(layerCounts.values()));
    const stackColumns = previewChildren.length > 1 ? 2 : 1;
    const stackRows = Math.max(1, Math.ceil(previewChildren.length / stackColumns));
    const width = expanded ? Math.max(GROUP_WIDTH, (maxLayer + 1) * NODE_WIDTH + maxLayer * 96 + 48) : stackColumns * NODE_WIDTH + (stackColumns - 1) * STACK_GAP + 48;
    const height = expanded ? GROUP_HEADER + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * 28 + 36 : GROUP_HEADER + stackRows * NODE_HEIGHT + Math.max(0, stackRows - 1) * STACK_GAP + 38;
    const col = groupIndex % 2;
    const row = Math.floor(groupIndex / 2);
    nodes.push({
      id: groupId,
      type: "topologyNode",
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x: col * 660, y: row * 330 },
      draggable: false,
      selectable: true,
      style: { width, height, zIndex: 0 },
      data: {
        label: groupKey,
        subtitle: getGroupLabel(options.groupBy),
        kind: "Group",
        source: "scope",
        status: orderedChildren.some((item) => item.status === "error") ? "error" : orderedChildren.some((item) => item.status === "warning") ? "warning" : "success",
        count: orderedChildren.length,
        collapsedCount: expanded ? undefined : orderedChildren.length,
        children: (expanded ? visibleChildren : previewChildren).map(toGraphNodeEntity),
      },
    });
    if (!expanded) return;
    const layerIndexes = new Map<number, number>();
    visibleChildren.forEach((entity) => {
      entityVisibleIds.add(entity.id);
      nodes.push({
        id: entity.id,
        type: "topologyNode",
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        parentNode: groupId,
        extent: "parent",
        draggable: false,
        selectable: true,
        position: getLayeredChildPosition(entity, layerIndexes),
        style: CHILD_NODE_STYLE,
        data: {
          label: entity.label,
          subtitle: entity.subtitle,
          kind: entity.kind,
          source: entity.source,
          status: entity.status,
          namespace: entity.namespace,
          clusterId: entity.clusterId,
          nodeName: entity.nodeName,
          instance: entity.instance,
          detail: entity.detail,
          yaml: entity.yaml,
        },
      });
    });
  });

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  relations.forEach((relation) => {
    const sourceVisible = entityVisibleIds.has(relation.source);
    const targetVisible = entityVisibleIds.has(relation.target);
    const sourceEntity = entityById.get(relation.source);
    const targetEntity = entityById.get(relation.target);
    if (!sourceEntity || !targetEntity) return;
    const source = sourceVisible ? relation.source : groupIds.get(getGroupKey(sourceEntity, options.groupBy));
    const target = targetVisible ? relation.target : groupIds.get(getGroupKey(targetEntity, options.groupBy));
    if (!source || !target || source === target) return;
    const id = sourceVisible && targetVisible ? relation.id : `collapsed:${relation.role}:${source}->${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    const isRelated = Boolean(focusedIds?.has(sourceEntity.id) || focusedIds?.has(targetEntity.id));
    edges.push({
      id,
      source,
      target,
      type: "smoothstep",
      animated: false,
      label: !isLargeGraph && sourceVisible && targetVisible ? relation.label : undefined,
      className: `resource-map-edge resource-map-edge--${relation.role} ${isRelated ? "is-related" : ""}`,
      pathOptions: EDGE_PATH_OPTIONS,
      interactionWidth: 18,
      style: isRelated ? EDGE_STYLE_RELATED : relation.role === "owner" ? EDGE_STYLE_OWNER : EDGE_STYLE_DEFAULT,
    });
  });
  return { nodes, edges, filteredCount: filtered.length };
}

function layoutView(view: TopologyView): TopologyView {
  const rootGroups = view.nodes.filter((node) => !node.parentNode);
  let x = 40;
  let y = 52;
  let rowHeight = 0;
  const maxWidth = 1480;
  const positions = new Map<string, { x: number; y: number }>();
  rootGroups.forEach((node) => {
    const width = Number(node.style?.width ?? GROUP_WIDTH);
    const height = Number(node.style?.height ?? NODE_HEIGHT);
    if (x > 40 && x + width > maxWidth) {
      x = 40;
      y += rowHeight + 96;
      rowHeight = 0;
    }
    positions.set(node.id, { x, y });
    x += width + 92;
    rowHeight = Math.max(rowHeight, height);
  });
  return {
    nodes: view.nodes.map((node) => (node.parentNode ? node : { ...node, position: positions.get(node.id) ?? node.position })),
    edges: view.edges,
  };
}

function ResourceMapNodeBase({ id, data, selected }: NodeProps<TopologyNodeData>) {
  const nodeActions = useContext(TopologyNodeActionsContext);
  const meta = KIND_META[data.kind] ?? KIND_META.Group;
  const isGroup = data.kind === "Group";
  const isCollapsedGroup = isGroup && Boolean(data.collapsedCount);
  const statusIcon = data.status === "error" ? <WarningOutlined /> : data.status === "warning" ? <InfoCircleOutlined /> : <CheckOutlined />;
  return (
    <div
      className={`resource-map-node ${isGroup ? "resource-map-node--group" : ""} is-${data.status} ${selected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      style={{ "--node-accent": meta.color } as React.CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        nodeActions.onSelect(id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          nodeActions.onSelect(id);
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="resource-map-node__handle" />
      <Handle type="source" position={Position.Right} className="resource-map-node__handle" />
      {isGroup ? (
        <>
          <div className="resource-map-node__group-head">
            <span className="resource-map-node__icon">{meta.icon}</span>
            <span className="resource-map-node__group-title">{data.label}</span>
            <span className="resource-map-node__badge">{data.count ?? 0}</span>
            {!isCollapsedGroup ? (
              <button
                type="button"
                className="resource-map-node__collapse"
                onClick={(event) => {
                  event.stopPropagation();
                  nodeActions.onSelect(null);
                }}
              >
                收起
              </button>
            ) : null}
          </div>
          {isCollapsedGroup ? (
            <div className="resource-map-node__stack-grid">
              {(data.children ?? []).map((child, index) => {
                const childMeta = KIND_META[child.kind] ?? KIND_META.Group;
                return (
                  <button
                    key={child.id}
                    type="button"
                    className={`resource-map-stack-card is-${child.status}`}
                    style={{ "--node-accent": childMeta.color } as React.CSSProperties}
                    onClick={(event) => {
                      event.stopPropagation();
                      nodeActions.onOpenEntity(child);
                    }}
                  >
                    <span className="resource-map-stack-card__icon">{childMeta.icon}</span>
                    <span className="resource-map-stack-card__copy">
                      <small>{KIND_LABEL[child.kind] ?? child.kind}</small>
                      <strong>{child.label}</strong>
                    </span>
                    {index === 0 ? <span className="resource-map-stack-card__badge">{Math.max(1, data.count ?? 1)}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="resource-map-node__icon">{meta.icon}</div>
          <div className="resource-map-node__text">
            <span>{data.subtitle}</span>
            <strong>{data.label}</strong>
          </div>
          <div className="resource-map-node__status">{statusIcon}</div>
        </>
      )}
    </div>
  );
}

const ResourceMapNode = memo(ResourceMapNodeBase);
const nodeTypes: NodeTypes = { topologyNode: ResourceMapNode };

function AutoFit({ nodes, version }: { nodes: Node[]; version: string }) {
  const flow = useReactFlow();
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    if (!nodesRef.current.length) return;
    const id = window.setTimeout(() => {
      const bounds = getNodesBounds(nodesRef.current);
      const canvas = document.querySelector(".resource-map-canvas")?.getBoundingClientRect();
      const viewport = getViewportForBounds(
        bounds,
        Math.max(640, canvas?.width ?? window.innerWidth - 360),
        Math.max(420, canvas?.height ?? window.innerHeight - 160),
        0.72,
        1.25,
        0.16,
      );
      flow.setViewport(viewport, { duration: 420 });
    }, 80);
    return () => window.clearTimeout(id);
  }, [flow, version]);
  return null;
}

function ZoomPercent() {
  const { zoom } = useViewport();
  return <Panel position="bottom-left" className="resource-map-zoom-percent">{Math.round(zoom * 100)}%</Panel>;
}

function FlowCanvas({
  view,
  selectedNodeId,
  setSelectedNodeId,
  onOpenEntity,
  onOpenNodeDetail,
  onMoveState,
  motionEnabled,
  fitVersion,
}: {
  view: TopologyView;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  onOpenEntity: (entity: GraphNodeEntity) => void;
  onOpenNodeDetail: (node: Node<TopologyNodeData>) => void;
  onMoveState: (moving: boolean) => void;
  motionEnabled: boolean;
  fitVersion: string;
}) {
  const flow = useReactFlow();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const movedRef = useRef(false);
  const selectableNodes = useMemo(
    () =>
      view.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [selectedNodeId, view.nodes],
  );
  const nodeActions = useMemo(
    () => ({
      onSelect: setSelectedNodeId,
      onOpenEntity,
    }),
    [onOpenEntity, setSelectedNodeId],
  );
  const handleWheelZoom = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault();
    const viewport = flow.getViewport();
    const nextZoom = Math.min(1.8, Math.max(0.18, viewport.zoom * (event.deltaY < 0 ? 1.16 : 0.86)));
    if (Math.abs(nextZoom - viewport.zoom) < 0.001) return;
    const bounds = hostRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const flowX = (pointerX - viewport.x) / viewport.zoom;
    const flowY = (pointerY - viewport.y) / viewport.zoom;
    flow.setViewport(
      {
        x: pointerX - flowX * nextZoom,
        y: pointerY - flowY * nextZoom,
        zoom: nextZoom,
      },
      { duration: 80 },
    );
  }, [flow]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.addEventListener("wheel", handleWheelZoom, { passive: false });
    return () => host.removeEventListener("wheel", handleWheelZoom);
  }, [handleWheelZoom]);
  return (
    <div ref={hostRef} className="resource-map-flow-host">
      <TopologyNodeActionsContext.Provider value={nodeActions}>
        <ReactFlow
          nodes={selectableNodes}
          edges={view.edges}
          nodeTypes={nodeTypes}
          minZoom={0.18}
          maxZoom={1.8}
          proOptions={REACT_FLOW_PRO_OPTIONS}
          zoomOnScroll={false}
          zoomOnPinch
          panOnDrag
          panOnScroll={false}
          selectionOnDrag={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onNodeDoubleClick={(_, node) => onOpenNodeDetail(node)}
          onPaneClick={() => {
            if (movedRef.current) return;
            setSelectedNodeId(null);
          }}
          onMoveStart={() => {
            movedRef.current = false;
            onMoveState(true);
          }}
          onMove={() => {
            movedRef.current = true;
          }}
          onMoveEnd={() => {
            window.setTimeout(() => {
              movedRef.current = false;
            }, 0);
            onMoveState(false);
          }}
          onError={handleReactFlowError}
          className={`${motionEnabled ? "has-motion" : "is-static"} ${selectedNodeId ? "has-selection" : ""}`}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="var(--map-dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          <ZoomPercent />
          <Panel position="top-left" className="resource-map-breadcrumbs">
            <span>根</span>
            {selectedNodeId ? (
              <>
                <span>/</span>
                <strong>{selectedNodeId.startsWith("group:") ? "分组" : "资源"}</strong>
                <button type="button" onClick={() => setSelectedNodeId(null)}>收起</button>
              </>
            ) : null}
          </Panel>
          <AutoFit nodes={view.nodes} version={fitVersion} />
        </ReactFlow>
      </TopologyNodeActionsContext.Provider>
    </div>
  );
}

function DetailRail({
  node,
  model,
  clusterMap,
  onClose,
  onOpenDetail,
  onOpenYaml,
  onJump,
  onOpenEntity,
  onCopy,
}: {
  node: Node<TopologyNodeData> | null;
  model: GraphModel;
  clusterMap: Record<string, string>;
  onClose: () => void;
  onOpenDetail: () => void;
  onOpenYaml: () => void;
  onJump: () => void;
  onOpenEntity: (entity: GraphNodeEntity) => void;
  onCopy: (value: string) => void;
}) {
  const children = node?.data.children ?? [];
  const jumpUrl = node ? buildResourcePageUrl(node.data) : null;
  const childStatusCounts = countByStatus(children);
  const topKindCounts = getTopKindCounts(children);
  const relationSummaries = getRelationSummaries(node, model);
  const yamlDisabledReason = node ? getYamlDisabledReason(node) : null;
  const clusterDisplayName = node?.data.clusterId ? getClusterDisplayName(clusterMap, node.data.clusterId) : "-";
  return (
    <aside className={`resource-map-rail ${node ? "is-open" : ""}`}>
      {node ? (
        <>
          <div className="resource-map-rail__head">
            <div className="resource-map-rail__title">
              <span>{node.data.subtitle}</span>
              <strong>{node.data.label}</strong>
            </div>
            <button type="button" aria-label="关闭" onClick={onClose}><CloseOutlined /></button>
          </div>
          <div className="resource-map-rail__body">
            <div className={`resource-map-health is-${node.data.status}`}>
              <span>{STATUS_LABEL[node.data.status]}</span>
              <strong>{node.data.kind === "Group" ? `${children.length} 个资源` : KIND_LABEL[String(node.data.kind)] ?? node.data.kind}</strong>
            </div>
            <div className="resource-map-facts">
              <RailFact label="类型" value={KIND_LABEL[String(node.data.kind)] ?? String(node.data.kind)} />
              <RailFact label="状态" value={STATUS_LABEL[node.data.status]} />
              <RailFact label="名称空间" value={node.data.namespace ?? "-"} />
              <RailFact label="集群" value={clusterDisplayName} />
              {node.data.instance ? <RailFact label="实例" value={node.data.instance} /> : null}
              {node.data.nodeName ? <RailFact label="节点" value={node.data.nodeName} /> : null}
            </div>
            <div className="resource-map-actions">
              <OpsIconActionButton icon={<InfoCircleOutlined />} onClick={onOpenDetail} disabled={!node.data.detail || Boolean(children.length)}>
                详情
              </OpsIconActionButton>
              <Tooltip title={yamlDisabledReason ?? "查看 YAML"}>
                <OpsIconActionButton icon={<FileTextOutlined />} onClick={onOpenYaml} disabled={!node.data.yaml || Boolean(children.length)}>
                  YAML
                </OpsIconActionButton>
              </Tooltip>
              <OpsIconActionButton icon={<LinkOutlined />} onClick={onJump} disabled={!jumpUrl || Boolean(children.length)}>
                资源页
              </OpsIconActionButton>
              <OpsIconActionButton icon={<CopyOutlined />} onClick={() => onCopy(getCopyValue(node))}>
                复制
              </OpsIconActionButton>
            </div>
            {children.length ? (
              <div className="resource-map-section">
                <div className="resource-map-section-title">分组健康</div>
                <div className="resource-map-health-grid">
                  <span className="is-success">正常 <strong>{childStatusCounts.success}</strong></span>
                  <span className="is-warning">告警 <strong>{childStatusCounts.warning}</strong></span>
                  <span className="is-error">异常 <strong>{childStatusCounts.error}</strong></span>
                </div>
                {topKindCounts.length ? (
                  <div className="resource-map-kind-strip">
                    {topKindCounts.map(([kind, count]) => (
                      <span key={kind}>{KIND_LABEL[kind] ?? kind}<strong>{count}</strong></span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {children.length ? (
              <div className="resource-map-list">
                <div className="resource-map-section-title">组内资源</div>
                {children
                  .slice()
                  .sort((left, right) => (right.status === "error" ? 1 : 0) - (left.status === "error" ? 1 : 0) || left.label.localeCompare(right.label))
                  .slice(0, 24)
                  .map((child) => (
                    <button key={child.id} type="button" className={`resource-map-list__item is-${child.status}`} onClick={() => onOpenEntity(child)}>
                      <span>{KIND_META[child.kind]?.icon ?? <ApiOutlined />}</span>
                      <div><strong>{child.label}</strong><small>{KIND_LABEL[child.kind] ?? child.kind}</small></div>
                      <em>{STATUS_LABEL[child.status]}</em>
                    </button>
                  ))}
              </div>
            ) : relationSummaries.length ? (
              <div className="resource-map-list">
                <div className="resource-map-section-title">关联资源</div>
                {relationSummaries.slice(0, 16).map((relation) => (
                  <button key={relation.id} type="button" className={`resource-map-list__item is-${relation.status}`} onClick={() => onOpenEntity(relation.entity)}>
                    <span>{KIND_META[relation.kind]?.icon ?? <NodeIndexOutlined />}</span>
                    <div>
                      <strong>{relation.label}</strong>
                      <small>{RELATION_ROLE_LABEL[relation.role]} / {relation.direction === "out" ? "下游" : "上游"} / {KIND_LABEL[relation.kind] ?? relation.kind}</small>
                    </div>
                    <em>{STATUS_LABEL[relation.status]}</em>
                  </button>
                ))}
              </div>
            ) : (
              <Alert type="info" showIcon title="暂无已识别关联" description="可继续用详情或 YAML 查看资源原始引用。" />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="resource-map-rail__head">
            <div className="resource-map-rail__title">
              <span>Topology / Storage / Config</span>
              <strong>资源密度摘要</strong>
            </div>
          </div>
          <div className="resource-map-rail__body">
            <DensityOverview model={model} />
          </div>
        </>
      )}
    </aside>
  );
}

function RailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <Tooltip title={value} placement="topLeft">
        <strong>{value}</strong>
      </Tooltip>
    </div>
  );
}

export default function NetworkTopologyPage() {
  const router = useRouter();
  const { accessToken: token } = useAuth();
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACE);
  const [selectedSources, setSelectedSources] = useState<Set<SourceKey>>(() => new Set(SOURCE_KEYS.filter((key) => SOURCE_META[key].enabled)));
  const [groupBy, setGroupBy] = useState<GroupBy>("namespace");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<TopologyDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<TopologyYamlTarget | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [fitVersion, setFitVersion] = useState("initial");
  const selectedSourceKey = useMemo(() => SOURCE_KEYS.filter((key) => selectedSources.has(key)).join(","), [selectedSources]);

  const clusterQuery = useQuery({
    queryKey: ["topology-map", "clusters", token],
    queryFn: ({ signal }) => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!, { signal }),
    enabled: Boolean(token),
    staleTime: QUERY_STALE_MS,
  });
  const clusters = useMemo(() => clusterQuery.data?.items ?? [], [clusterQuery.data?.items]);
  const clusterMap = useMemo(
    () => Object.fromEntries(clusters.map((cluster) => [cluster.id, cluster.name])),
    [clusters],
  );
  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.id === selectedClusterId) ?? clusters[0] ?? null,
    [clusters, selectedClusterId],
  );

  const namespaceSummaryQuery = useQuery({
    queryKey: ["topology-map", "namespace-summary", selectedCluster?.id, token],
    queryFn: ({ signal }) => getTopologyNamespaceSummaries({ clusterId: selectedCluster?.id }, token, { signal }),
    enabled: Boolean(token && selectedCluster?.id),
    staleTime: QUERY_STALE_MS,
  });

  const workloadQueries = useQueries({
    queries: WORKLOAD_KINDS.map((kind) => ({
      queryKey: ["topology-map", "workloads", kind, selectedCluster?.id, selectedNamespace, token],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getWorkloadsByKind(
          kind,
          {
            clusterId: selectedCluster?.id,
            namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace,
            projection: "topology",
            pageSize: 500,
          },
          token,
          { signal },
        ),
      enabled: Boolean(token && selectedCluster?.id && selectedSources.has("workloads")),
      staleTime: QUERY_STALE_MS,
    })),
  });

  const networkQuery = useQuery({
    queryKey: ["topology-map", "network", selectedCluster?.id, selectedNamespace, token],
    queryFn: async ({ signal }) => {
      const results = await Promise.all(NETWORK_KINDS.map((kind) => getNetworkResources({ kind, clusterId: selectedCluster?.id, namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace, pageSize: 500 }, token, { signal }).catch(() => ({ items: [] }))));
      return results.flatMap((result) => result.items ?? []);
    },
    enabled: Boolean(token && selectedCluster?.id && selectedSources.has("network")),
    staleTime: QUERY_STALE_MS,
  });

  const storageQuery = useQuery({
    queryKey: ["topology-map", "storage", selectedCluster?.id, selectedNamespace, token],
    queryFn: async () => {
      const results = await Promise.all(STORAGE_KINDS.map((kind) => getStorageResources({ kind, clusterId: selectedCluster?.id, namespace: kind === "PVC" && selectedNamespace !== ALL_NAMESPACE ? selectedNamespace : undefined, pageSize: 500 }, token).catch(() => ({ items: [] }))));
      return results.flatMap((result) => result.items ?? []);
    },
    enabled: Boolean(token && selectedCluster?.id && selectedSources.has("storage")),
    staleTime: QUERY_STALE_MS,
  });

  const configQuery = useQuery({
    queryKey: ["topology-map", "configs", selectedCluster?.id, selectedNamespace, token],
    queryFn: async () => {
      const results = await Promise.all(CONFIG_KINDS.map((kind) => getConfigs(kind, { clusterId: selectedCluster?.id, namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace, pageSize: 500 }, token!).catch(() => ({ items: [] }))));
      return results.flatMap((result) => result.items ?? []);
    },
    enabled: Boolean(token && selectedCluster?.id && selectedSources.has("configuration")),
    staleTime: QUERY_STALE_MS,
  });

  const autoscalingQuery = useQuery({
    queryKey: ["topology-map", "autoscaling", selectedCluster?.id, selectedNamespace, token],
    queryFn: () => listAutoscalingPolicies({ clusterId: selectedCluster?.id, namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace, pageSize: 500 }, token).catch(() => ({ items: [], total: 0, overview: { totalPolicies: 0, hpaPolicies: 0, vpaPolicies: 0, coveredWorkloads: 0, uncoveredWorkloads: 0 } })),
    enabled: Boolean(token && selectedCluster?.id && selectedSources.has("workloads")),
    staleTime: QUERY_STALE_MS,
  });

  const dynamicQuery = useQuery({
    queryKey: ["topology-map", "dynamic", selectedCluster?.id, selectedNamespace, token, selectedSourceKey],
    queryFn: async ({ signal }) => {
      const active = DYNAMIC_SOURCES.filter((meta) => selectedSources.has(meta.source));
      const results = await Promise.all(active.map((meta) => getDynamicResources({ clusterId: selectedCluster!.id, group: meta.group, version: meta.version, resource: meta.resource, namespace: meta.namespaced && selectedNamespace !== ALL_NAMESPACE ? selectedNamespace : undefined, pageSize: 500, missingAsEmpty: true }, token, { signal }).then((response) => response.items.map((item) => ({ item, meta }))).catch(() => [])));
      return results.flat();
    },
    enabled: Boolean(token && selectedCluster?.id && (selectedSources.has("gateway") || selectedSources.has("configuration"))),
    staleTime: QUERY_STALE_MS,
  });

  const deploymentItems = workloadQueries[0]?.data?.items;
  const statefulSetItems = workloadQueries[1]?.data?.items;
  const daemonSetItems = workloadQueries[2]?.data?.items;
  const replicaSetItems = workloadQueries[3]?.data?.items;
  const podItems = workloadQueries[4]?.data?.items;
  const jobItems = workloadQueries[5]?.data?.items;
  const cronJobItems = workloadQueries[6]?.data?.items;
  const workloads = useMemo(
    () => [
      ...(deploymentItems ?? []),
      ...(statefulSetItems ?? []),
      ...(daemonSetItems ?? []),
      ...(replicaSetItems ?? []),
      ...(podItems ?? []),
      ...(jobItems ?? []),
      ...(cronJobItems ?? []),
    ],
    [cronJobItems, daemonSetItems, deploymentItems, jobItems, podItems, replicaSetItems, statefulSetItems],
  );
  const isLoading = clusterQuery.isLoading || namespaceSummaryQuery.isLoading || workloadQueries.some((query) => query.isLoading) || networkQuery.isLoading || storageQuery.isLoading || configQuery.isLoading || autoscalingQuery.isLoading || dynamicQuery.isLoading;
  const error = clusterQuery.error ?? namespaceSummaryQuery.error ?? workloadQueries.find((query) => query.error)?.error ?? networkQuery.error ?? storageQuery.error ?? configQuery.error ?? autoscalingQuery.error ?? dynamicQuery.error;

  const model = useMemo(
    () => buildGraphModel({
      workloads,
      network: networkQuery.data ?? [],
      storage: storageQuery.data ?? [],
      configs: configQuery.data ?? [],
      autoscaling: autoscalingQuery.data?.items ?? [],
      dynamic: dynamicQuery.data ?? [],
    }),
    [autoscalingQuery.data?.items, configQuery.data, dynamicQuery.data, networkQuery.data, storageQuery.data, workloads],
  );
  const namespaceOptions = useMemo(() => {
    const summaryNamespaces = (namespaceSummaryQuery.data?.items ?? []).map((item) => item.namespace).filter((item): item is string => Boolean(item));
    return Array.from(new Set([...summaryNamespaces, ...model.namespaces])).sort();
  }, [model.namespaces, namespaceSummaryQuery.data?.items]);

  const effectiveNamespace =
    selectedNamespace === ALL_NAMESPACE || namespaceOptions.includes(selectedNamespace)
      ? selectedNamespace
      : ALL_NAMESPACE;

  const visible = useMemo(() => buildVisibleGraph(model, { selectedSources, namespace: effectiveNamespace, query: queryText, errorsOnly, groupBy, selectedId: selectedNodeId, expandAll }), [effectiveNamespace, errorsOnly, expandAll, groupBy, model, queryText, selectedNodeId, selectedSources]);
  const view = useMemo(() => layoutView({ nodes: visible.nodes, edges: visible.edges }), [visible.edges, visible.nodes]);
  const selectedNode = useMemo(() => view.nodes.find((node) => node.id === selectedNodeId) ?? null, [selectedNodeId, view.nodes]);
  const motionEnabled = !isMoving && view.nodes.length <= LARGE_GRAPH_NODE_LIMIT && view.edges.length <= LARGE_GRAPH_EDGE_LIMIT;
  const canExpandAll = visible.filteredCount <= 50;

  const toggleSource = useCallback((source: SourceKey) => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      if (next.size === 0) next.add(source);
      return next;
    });
    setSelectedNodeId(null);
  }, []);

  const refresh = useCallback(() => {
    clusterQuery.refetch();
    namespaceSummaryQuery.refetch();
    workloadQueries.forEach((query) => query.refetch());
    networkQuery.refetch();
    storageQuery.refetch();
    configQuery.refetch();
    autoscalingQuery.refetch();
    dynamicQuery.refetch();
    setFitVersion(String(Date.now()));
  }, [autoscalingQuery, clusterQuery, configQuery, dynamicQuery, namespaceSummaryQuery, networkQuery, storageQuery, workloadQueries]);

  const openDetail = useCallback(() => {
    if (selectedNode?.data.detail) setDetailRequest(selectedNode.data.detail);
  }, [selectedNode]);

  const openYaml = useCallback(() => {
    if (selectedNode?.data.yaml) setYamlTarget(selectedNode.data.yaml);
  }, [selectedNode]);

  const openEntity = useCallback((entity: GraphNodeEntity) => {
    setSelectedNodeId(entity.id);
  }, []);

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const openNodeDetail = useCallback((node: Node<TopologyNodeData>) => {
    setSelectedNodeId(node.id);
    if (node.data.detail) setDetailRequest(node.data.detail);
  }, []);

  const jumpToResource = useCallback(() => {
    if (!selectedNode) return;
    const url = buildResourcePageUrl(selectedNode.data);
    if (url) router.push(url);
  }, [router, selectedNode]);

  const copyText = useCallback((value: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }, []);

  return (
    <section className="resource-map-shell">
      <OpsPageHeader
        className="resource-map-header"
        title="资源拓扑"
        subtitle="网络资源关系、工作负载依赖与异常影响路径"
        scope={<span>网络</span>}
        actions={(
          <div className="resource-map-header__stats">
          <span><strong>{model.entities.length}</strong> 资源</span>
          <span><strong>{model.relations.length}</strong> 关系</span>
          <span><strong>{model.statusCounts.error + model.statusCounts.warning}</strong> 告警</span>
          </div>
        )}
      />

      <div className="resource-map-toolbar">
        <div className="resource-map-toolbar__scope">
          <select value={selectedCluster?.id ?? ""} onChange={(event) => { setSelectedClusterId(event.target.value); setSelectedNodeId(null); }}>
            {clusters.map((cluster) => <option key={cluster.id} value={cluster.id}>{cluster.name}</option>)}
          </select>
          <select value={selectedNamespace} onChange={(event) => { setSelectedNamespace(event.target.value); setSelectedNodeId(null); }}>
            <option value={ALL_NAMESPACE}>全部名称空间</option>
            {namespaceOptions.map((namespace) => <option key={namespace} value={namespace}>{namespace}</option>)}
          </select>
        </div>
        <div className="resource-map-toolbar__filters">
          <div className="resource-map-source-chips">
            {SOURCE_KEYS.map((source) => (
              <button key={source} type="button" className={selectedSources.has(source) ? "is-active" : ""} onClick={() => toggleSource(source)} style={{ "--source-color": SOURCE_META[source].color } as React.CSSProperties}>
                {SOURCE_META[source].icon}<span>{SOURCE_META[source].label}</span><strong>{model.sourceCounts[source]}</strong>
              </button>
            ))}
          </div>
          <div className="resource-map-segments">
            {(["namespace", "instance", "node"] as GroupBy[]).map((item) => <button key={item} type="button" className={groupBy === item ? "is-active" : ""} onClick={() => { setGroupBy(item); setSelectedNodeId(null); }}>{GROUP_BY_LABEL[item]}</button>)}
          </div>
        </div>
        <div className="resource-map-toolbar__actions">
          <button type="button" className={errorsOnly ? "is-active" : ""} onClick={() => setErrorsOnly((value) => !value)}><WarningOutlined /> 异常</button>
          <button type="button" className={expandAll && canExpandAll ? "is-active" : ""} disabled={!canExpandAll} onClick={() => setExpandAll((value) => !value)}>{expandAll && canExpandAll ? <CompressOutlined /> : <ExpandOutlined />} {expandAll && canExpandAll ? "收起" : "展开"}</button>
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索资源" value={queryText} onChange={(event) => setQueryText(event.target.value)} />
          <Tooltip title="刷新"><OpsIconActionButton size="small" onClick={refresh}><ReloadOutlined /></OpsIconActionButton></Tooltip>
          <Tooltip title="适配视图"><OpsIconActionButton size="small" onClick={() => setFitVersion(String(Date.now()))}><AimOutlined /></OpsIconActionButton></Tooltip>
        </div>
      </div>

      {error ? <Alert type="warning" showIcon title="拓扑数据加载不完整" description={error instanceof Error ? error.message : "部分资源暂不可用"} /> : null}

      <div className="resource-map-workbench">
        <div className="resource-map-canvas">
          {isLoading ? (
            <div className="resource-map-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>
          ) : view.nodes.length === 0 ? (
            <Empty description="暂无可展示数据，请调整筛选条件或切换名称空间" />
          ) : (
            <ReactFlowProvider>
              <FlowCanvas view={view} selectedNodeId={selectedNodeId} setSelectedNodeId={selectNode} onOpenEntity={openEntity} onOpenNodeDetail={openNodeDetail} onMoveState={setIsMoving} motionEnabled={motionEnabled} fitVersion={fitVersion} />
            </ReactFlowProvider>
          )}
          <div className="resource-map-motion-state">
            <span className={motionEnabled ? "is-on" : ""} />
            {motionEnabled ? "流动连线" : "性能降级"}
          </div>
        </div>
        <DetailRail node={selectedNode} model={model} clusterMap={clusterMap} onClose={() => setSelectedNodeId(null)} onOpenDetail={openDetail} onOpenYaml={openYaml} onJump={jumpToResource} onOpenEntity={openEntity} onCopy={copyText} />
      </div>

      <ResourceDetailDrawer open={Boolean(detailRequest)} onClose={() => setDetailRequest(null)} token={token} request={detailRequest} onNavigateRequest={(request) => setDetailRequest(request)} />
      <ResourceYamlDrawer open={Boolean(yamlTarget)} onClose={() => setYamlTarget(null)} token={token} identity={yamlTarget?.identity ?? null} dynamicIdentity={yamlTarget?.dynamicIdentity ?? null} onUpdated={refresh} />

      <style jsx global>{`
        body.topology-overview-active { overflow: hidden; }
        .resource-map-shell {
          --map-page-bg: var(--ops-bg);
          --map-panel-bg: var(--ops-surface-overlay);
          --map-canvas-bg: var(--ops-surface-overlay);
          --map-card-bg: var(--ops-surface-overlay);
          --map-card-bg-soft: var(--ops-subtle-bg);
          --map-text: var(--ops-text);
          --map-heading: var(--ops-text);
          --map-muted: var(--ops-text-muted);
          --map-border: var(--ops-border-subtle);
          --map-border-strong: var(--ops-border-strong);
          --map-shadow: var(--ops-shadow-subtle);
          --map-grid: rgba(100,116,139,.08);
          --map-edge: var(--ops-text-faint);
          height: calc(100dvh - 104px); min-height: 640px; display: flex; flex-direction: column; gap: 12px; padding: 14px; color: var(--map-text); background: var(--map-page-bg);
        }
        [data-theme="dark"] .resource-map-shell {
          --map-panel-bg: color-mix(in srgb, var(--ops-surface) 88%, transparent);
          --map-canvas-bg: var(--ops-bg);
          --map-card-bg: var(--ops-surface);
          --map-grid: rgba(148,163,184,.07);
        }
        .resource-map-header.ops-page-header { min-height: 52px; background: var(--map-panel-bg); border-color: var(--map-border); box-shadow: var(--map-shadow); }
        .resource-map-header .ops-page-header__scope { color: var(--map-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
        .resource-map-header .ops-page-header__title { font-size: 24px; line-height: 1.1; font-weight: 780; color: var(--map-heading); }
        .resource-map-header .ops-page-header__subtitle { color: var(--map-muted); }
        .resource-map-header__stats { display: flex; gap: 8px; }
        .resource-map-header__stats span { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--map-border); background: var(--map-panel-bg); border-radius: 8px; padding: 7px 10px; color: var(--map-muted); text-transform: none; }
        .resource-map-header__stats strong { color: var(--map-heading); }
        .resource-map-toolbar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--map-border); background: var(--map-panel-bg); box-shadow: var(--map-shadow); border-radius: 8px; padding: 8px; }
        .resource-map-toolbar__scope,
        .resource-map-toolbar__filters,
        .resource-map-toolbar__actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .resource-map-toolbar__filters { overflow: hidden; }
        .resource-map-toolbar__actions { justify-content: flex-end; }
        .resource-map-toolbar select, .resource-map-toolbar button { height: 34px; border-radius: 8px; border: 1px solid var(--map-border-strong); background: var(--map-card-bg-soft); color: var(--map-text); padding: 0 10px; font-size: 13px; white-space: nowrap; box-shadow: none; }
        .resource-map-toolbar button { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
        .resource-map-toolbar button:hover { border-color: color-mix(in srgb, #2563eb 34%, var(--map-border)); background: color-mix(in srgb, var(--map-card-bg-soft) 82%, var(--map-card-bg)); }
        .resource-map-toolbar button.is-active { background: color-mix(in srgb, var(--source-color, #0ea5e9) 16%, var(--map-card-bg)); border-color: color-mix(in srgb, var(--source-color, #0ea5e9) 58%, var(--map-border)); color: var(--map-heading); }
        .resource-map-toolbar button:disabled { opacity: .45; cursor: not-allowed; }
        .resource-map-toolbar .ant-input-affix-wrapper { width: 220px; height: 34px; border-radius: 8px; background: var(--map-card-bg-soft); border-color: var(--map-border-strong); color: var(--map-text); }
        .resource-map-toolbar .ant-input { background: transparent; color: var(--map-text); }
        .resource-map-source-chips, .resource-map-segments { display: inline-flex; align-items: center; gap: 0; }
        .resource-map-source-chips { min-width: 0; overflow: auto hidden; scrollbar-width: none; }
        .resource-map-source-chips::-webkit-scrollbar { display: none; }
        .resource-map-source-chips button, .resource-map-segments button { border-radius: 0; margin-left: -1px; }
        .resource-map-source-chips button { flex: 0 0 auto; min-width: 84px; justify-content: center; }
        .resource-map-source-chips button span { white-space: nowrap; }
        .resource-map-segments button { min-width: 48px; justify-content: center; }
        .resource-map-source-chips button:first-child, .resource-map-segments button:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
        .resource-map-source-chips button:last-child, .resource-map-segments button:last-child { border-radius: 0 8px 8px 0; }
        .resource-map-source-chips button.is-active { box-shadow: inset 0 -2px 0 var(--source-color); }
        .resource-map-source-chips strong { color: var(--source-color); font-variant-numeric: tabular-nums; }
        .resource-map-workbench { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 370px; gap: 12px; }
        .resource-map-canvas { position: relative; overflow: hidden; border-radius: 8px; border: 1px solid var(--map-border); background: var(--map-canvas-bg); box-shadow: none; }
        .resource-map-canvas::before { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--map-grid) 1px, transparent 1px), linear-gradient(90deg, var(--map-grid) 1px, transparent 1px); background-size: 40px 40px; mask-image: linear-gradient(180deg, #000 0 72%, transparent 100%); }
        .resource-map-flow-host { position: relative; width: 100%; height: 100%; min-height: 420px; }
        .resource-map-canvas .react-flow { width: 100%; height: 100%; background: transparent; }
        .resource-map-canvas .react-flow__pane { cursor: grab; }
        .resource-map-canvas .react-flow__pane:active { cursor: grabbing; }
        .resource-map-loading { max-width: 760px; margin: 80px auto; padding: 32px; }
        .resource-map-node { width: 100%; height: 100%; position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; border-radius: 8px; color: var(--map-text); background: var(--map-card-bg); border: 1px solid var(--map-border); box-shadow: none; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
        .resource-map-node::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(90deg, var(--node-accent), transparent 34%); opacity: .1; }
        .resource-map-node::after { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 999px 999px 0; background: var(--node-accent); opacity: .8; }
        .resource-map-node:hover, .resource-map-node.is-selected { border-color: var(--node-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--node-accent) 30%, transparent); transform: translateY(-1px); }
        .resource-map-node__handle { opacity: 0; }
        .resource-map-node__icon { width: 40px; height: 40px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--node-accent); background: color-mix(in srgb, var(--node-accent) 13%, var(--map-card-bg)); border: 1px solid color-mix(in srgb, var(--node-accent) 22%, transparent); }
        .resource-map-node__text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .resource-map-node__text span { color: var(--map-muted); font-size: 12px; }
        .resource-map-node__text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--map-heading); font-size: 15px; }
        .resource-map-node__status { margin-left: auto; width: 24px; height: 24px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--map-card-bg-soft); border: 1px solid var(--map-border); }
        .resource-map-node.is-error .resource-map-node__status { color: #fb7185; }
        .resource-map-node.is-warning .resource-map-node__status { color: #fbbf24; }
        .resource-map-node.is-success .resource-map-node__status { color: #34d399; }
        .resource-map-node--group { display: block; padding: 0; background: color-mix(in srgb, var(--map-card-bg-soft) 84%, transparent); border-style: solid; box-shadow: none; }
        .resource-map-node--group::after { display: none; }
        .resource-map-node__group-head { height: 44px; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--map-border); background: color-mix(in srgb, var(--node-accent) 6%, transparent); }
        .resource-map-node__group-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; color: var(--map-heading); }
        .resource-map-node__badge { min-width: 28px; height: 24px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--node-accent) 14%, transparent); color: var(--node-accent); font-size: 12px; }
        .resource-map-node__collapse { height: 26px; border-radius: 999px; border: 1px solid var(--map-border); background: var(--map-panel-bg); color: var(--map-muted); padding: 0 9px; font-size: 12px; cursor: pointer; }
        .resource-map-node__collapse:hover { border-color: var(--node-accent); color: var(--map-heading); }
        .resource-map-node__stack-grid { position: absolute; inset: 56px 24px 22px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
        .resource-map-stack-card { position: relative; min-width: 0; height: 86px; display: flex; align-items: center; gap: 14px; border: 1px solid var(--map-border); border-radius: 8px; background: var(--map-card-bg); color: var(--map-text); padding: 12px 14px; text-align: left; cursor: pointer; box-shadow: none; transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
        .resource-map-stack-card:hover { border-color: var(--node-accent); transform: translateY(-1px); }
        .resource-map-stack-card__icon { width: 46px; height: 46px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--node-accent); background: color-mix(in srgb, var(--node-accent) 14%, var(--map-card-bg)); }
        .resource-map-stack-card__copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .resource-map-stack-card__copy small { color: var(--map-muted); font-size: 13px; }
        .resource-map-stack-card__copy strong { color: var(--map-heading); font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
        .resource-map-stack-card__badge { position: absolute; right: -14px; top: -14px; min-width: 34px; height: 34px; padding: 0 8px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: var(--map-panel-bg); border: 1px solid var(--map-border); color: var(--map-heading); font-size: 14px; font-weight: 760; }
        .resource-map-edge .react-flow__edge-path { stroke: var(--map-edge); stroke-opacity: .72; transition: stroke-opacity .15s ease, stroke-width .15s ease; }
        .resource-map-edge--owner .react-flow__edge-path { stroke: var(--map-edge-owner); }
        .resource-map-edge--network .react-flow__edge-path, .resource-map-edge--gateway .react-flow__edge-path { stroke: var(--map-edge-network); }
        .resource-map-edge--config .react-flow__edge-path { stroke: var(--map-edge-config); }
        .resource-map-edge--storage .react-flow__edge-path { stroke: var(--map-edge-storage); }
        .resource-map-edge.is-related .react-flow__edge-path,
        .resource-map-edge:hover .react-flow__edge-path { stroke-opacity: .96; }
        .has-motion .resource-map-edge .react-flow__edge-path { stroke-dasharray: 10 11; animation: resource-map-flow 1.9s linear infinite; }
        .is-static .resource-map-edge .react-flow__edge-path { stroke-dasharray: none; animation: none; }
        @keyframes resource-map-flow { to { stroke-dashoffset: -30; } }
        @media (prefers-reduced-motion: reduce) { .has-motion .resource-map-edge .react-flow__edge-path { animation: none; stroke-dasharray: none; } }
        .resource-map-breadcrumbs { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 8px; background: var(--map-panel-bg); border: 1px solid var(--map-border); color: var(--map-muted); font-size: 12px; }
        .resource-map-breadcrumbs strong { color: var(--map-heading); }
        .resource-map-breadcrumbs button { height: 24px; border-radius: 999px; border: 1px solid var(--map-border); background: var(--map-card-bg-soft); color: var(--map-text); padding: 0 9px; font-size: 12px; cursor: pointer; }
        .resource-map-breadcrumbs button:hover { border-color: var(--map-edge-network); color: var(--map-heading); }
        .resource-map-motion-state { position: absolute; right: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 6px 10px; background: var(--map-panel-bg); border: 1px solid var(--map-border); color: var(--map-muted); font-size: 12px; pointer-events: none; }
        .resource-map-motion-state span { width: 7px; height: 7px; border-radius: 999px; background: #64748b; }
        .resource-map-motion-state span.is-on { background: #22c55e; }
        .resource-map-rail { min-width: 0; overflow: hidden; border-radius: 8px; border: 1px solid var(--map-border); background: var(--map-panel-bg); display: flex; flex-direction: column; box-shadow: var(--map-shadow); }
        .resource-map-rail > .ant-empty { margin: auto; color: var(--map-muted); }
        .resource-map-rail__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px; border-bottom: 1px solid var(--map-border); }
        .resource-map-rail__title { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .resource-map-rail__head span { color: var(--map-muted); font-size: 12px; }
        .resource-map-rail__head strong { color: var(--map-heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .resource-map-rail__head button { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--map-border); background: var(--map-card-bg-soft); color: var(--map-text); cursor: pointer; }
        .resource-map-rail__body { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }
        .resource-map-health { border: 1px solid var(--map-border); border-radius: 8px; padding: 12px; background: var(--map-card-bg-soft); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .resource-map-health span { font-size: 12px; color: var(--map-muted); }
        .resource-map-health strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--map-heading); }
        .resource-map-health.is-success { border-color: color-mix(in srgb, #22c55e 38%, var(--map-border)); }
        .resource-map-health.is-warning { border-color: color-mix(in srgb, #f59e0b 48%, var(--map-border)); }
        .resource-map-health.is-error { border-color: color-mix(in srgb, #fb7185 52%, var(--map-border)); }
        .resource-map-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .resource-map-facts div { min-width: 0; border: 1px solid var(--map-border); border-radius: 8px; padding: 10px; background: var(--map-card-bg-soft); }
        .resource-map-facts span { display: block; color: var(--map-muted); font-size: 11px; }
        .resource-map-facts strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--map-heading); font-size: 13px; }
        .resource-map-section { border: 1px solid var(--map-border); border-radius: 8px; background: var(--map-card-bg-soft); padding: 10px; }
        .resource-map-section-title { color: var(--map-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0; margin-bottom: 8px; }
        .resource-map-health-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
        .resource-map-health-grid span { min-width: 0; border: 1px solid var(--map-border); border-radius: 8px; padding: 8px; color: var(--map-muted); font-size: 12px; }
        .resource-map-health-grid strong { display: block; margin-top: 4px; color: var(--map-heading); font-size: 16px; }
        .resource-map-health-grid .is-success strong { color: #22c55e; }
        .resource-map-health-grid .is-warning strong { color: #f59e0b; }
        .resource-map-health-grid .is-error strong { color: #fb7185; }
        .resource-map-kind-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .resource-map-kind-strip span { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--map-border); border-radius: 999px; padding: 4px 8px; color: var(--map-muted); font-size: 12px; }
        .resource-map-kind-strip strong { color: var(--map-heading); }
        .resource-map-list { display: flex; flex-direction: column; gap: 7px; }
        .resource-map-list__item { display: flex; align-items: center; gap: 10px; border: 1px solid var(--map-border); border-radius: 8px; padding: 9px; background: var(--map-card-bg-soft); color: var(--map-text); text-align: left; cursor: pointer; }
        .resource-map-list__item > span { color: #0ea5e9; }
        .resource-map-list__item div { min-width: 0; flex: 1; }
        .resource-map-list__item strong, .resource-map-list__item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .resource-map-list__item strong { color: var(--map-heading); }
        .resource-map-list__item small { color: var(--map-muted); }
        .resource-map-list__item em { flex: 0 0 auto; color: var(--map-muted); font-style: normal; font-size: 12px; }
        .resource-map-list__item.is-error { border-color: color-mix(in srgb, #fb7185 42%, var(--map-border)); }
        .resource-map-list__item.is-warning { border-color: color-mix(in srgb, #f59e0b 38%, var(--map-border)); }
        .resource-map-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .resource-map-density { display: grid; gap: 12px; }
        .resource-map-density__hero { display: grid; gap: 4px; border: 1px solid var(--map-border); border-radius: 8px; padding: 14px; background: var(--map-card-bg); }
        .resource-map-density__hero span { color: var(--map-muted); font-size: 12px; }
        .resource-map-density__hero strong { color: var(--map-heading); font-size: 30px; line-height: 1; }
        .resource-map-density__hero small { color: var(--map-muted); font-size: 12px; line-height: 1.35; }
        .resource-map-density-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .resource-map-density-card { min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 8px; border: 1px solid color-mix(in srgb, var(--density-color) 24%, var(--map-border)); border-radius: 8px; padding: 9px; background: color-mix(in srgb, var(--density-color) 7%, var(--map-card-bg)); }
        .resource-map-density-card__icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--density-color); background: color-mix(in srgb, var(--density-color) 12%, transparent); }
        .resource-map-density-card div { min-width: 0; display: grid; gap: 2px; }
        .resource-map-density-card strong,
        .resource-map-density-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .resource-map-density-card strong { color: var(--map-heading); font-size: 13px; }
        .resource-map-density-card small { color: var(--map-muted); font-size: 11px; }
        .resource-map-density-card em { grid-column: 1 / -1; color: var(--density-color); font-size: 11px; font-style: normal; font-weight: 700; }
        .resource-map-density-panel { border: 1px solid var(--map-border); border-radius: 8px; padding: 10px; background: var(--map-card-bg-soft); }
        .resource-map-density-row { display: grid; grid-template-columns: 58px minmax(0, 1fr) 30px; align-items: center; gap: 8px; min-height: 26px; color: var(--map-muted); font-size: 12px; }
        .resource-map-density-row i { position: relative; height: 5px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--map-border) 74%, transparent); }
        .resource-map-density-row i::before { content: ""; position: absolute; inset-block: 0; left: 0; width: var(--density-scale); border-radius: inherit; background: var(--map-edge-network); }
        .resource-map-density-row strong { color: var(--map-heading); text-align: right; }
        .resource-map-canvas .react-flow__controls { box-shadow: var(--map-shadow); }
        .resource-map-canvas .react-flow__controls-button { background: var(--map-panel-bg); border-color: var(--map-border); color: var(--map-text); }
        .resource-map-canvas .react-flow__background { color: var(--map-dot); }
        .resource-map-zoom-percent { margin-bottom: -54px; min-width: 44px; height: 36px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: var(--map-panel-bg); border: 1px solid var(--map-border); box-shadow: var(--map-shadow); color: var(--map-text); font-size: 12px; font-weight: 740; pointer-events: none; }
        @media (max-width: 1280px) { .resource-map-toolbar { grid-template-columns: 1fr; } .resource-map-toolbar__actions { justify-content: flex-start; flex-wrap: wrap; } }
        @media (max-width: 1100px) { .resource-map-shell { height: auto; min-height: 100vh; } .resource-map-workbench { grid-template-columns: 1fr; } .resource-map-rail { min-height: 280px; } .resource-map-canvas { min-height: 640px; } }
        @media (max-width: 720px) { .resource-map-header { align-items: flex-start; flex-direction: column; } .resource-map-header__stats, .resource-map-toolbar__scope, .resource-map-toolbar__filters { flex-wrap: wrap; } .resource-map-toolbar select, .resource-map-toolbar .ant-input-affix-wrapper { width: 100%; } .resource-map-facts { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
}
