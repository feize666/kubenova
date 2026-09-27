import type { TopologyRendererGraphNode } from "../renderers";
import { normalizeTopologyKind } from "../kind";
import type { CapacityResourceAggregation, TopologyCapacityMetadata } from "./capacity";
import type {
  KubejojoLegacyRelationRole,
  KubejojoRelationType,
  KubejojoStableIdentity,
} from "./relations";

export type KubejojoResource = TopologyRendererGraphNode["resource"] & {
  id: string;
  namespace?: string | null;
  instanceName?: string | null;
  nodeName?: string | null;
  weight?: number;
  identity?: KubejojoStableIdentity;
  identityKey?: string;
  aggregation?: CapacityResourceAggregation;
};

export type KubejojoRelationRole = KubejojoLegacyRelationRole;

export type KubejojoRelation = {
  id: string;
  source: string;
  target: string;
  label?: string;
  role?: KubejojoRelationRole;
  type?: KubejojoRelationType;
  direction?: "outbound" | "inbound";
  ports?: string[];
  evidence?: string[];
  confidence?: number;
};

export type KubejojoGroupBy = "namespace" | "instance" | "node";
export type KubejojoGroupKind = "scope" | "component" | "isolated";

export type KubejojoGraphNode = Omit<TopologyRendererGraphNode, "resource" | "nodes" | "children"> & {
  resource?: KubejojoResource;
  nodes?: KubejojoGraphNode[];
  edges?: KubejojoRelation[];
  overlayEdges?: KubejojoRelation[];
  weight?: number;
  groupKind?: KubejojoGroupKind;
  collapsedPreferred?: boolean;
  capacity?: TopologyCapacityMetadata;
};

export type KubejojoSelectionPathItem = {
  id: string;
  label: string;
  subtitle?: string;
  kind: "root" | KubejojoGroupKind | "resource";
  resourceCount: number;
};

export type KubejojoLayoutPolicy = {
  algorithm: "layered" | "rectpacking";
  direction: "RIGHT";
  aspectRatio: number;
};

/**
 * One size for every canvas card. Layout, CSS and hit testing all read these
 * numbers so a card can never be laid out at one size and painted at another.
 */
export const KUBEJOJO_LAYOUT_METRICS = Object.freeze({
  nodeWidth: 220,
  nodeHeight: 70,
  layeredNodeSpacing: 60,
  layeredLayerSpacing: 60,
  groupPadding: 16,
  packedNodeSpacing: 20,
  packedPaddingTop: 48,
  packedPaddingSide: 24,
});

/**
 * Headlamp's `DEFAULT_NODE_WEIGHTS`, reproduced verbatim. The weight is the
 * layout partition: a higher weight is placed further left, which produces
 * Deployment -> ReplicaSet -> Pod -> Service -> Ingress without any per-kind
 * rank table.
 */
export const KUBEJOJO_NODE_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  HorizontalPodAutoscaler: 1000,
  Deployment: 980,
  StatefulSet: 960,
  DaemonSet: 960,
  CronJob: 960,
  JobSet: 960,
  LeaderWorkerSet: 960,
  Job: 920,
  ReplicaSet: 960,
  Pod: 800,
  ServiceAccount: 960,
  Role: 790,
  ClusterRole: 790,
  Service: 790,
  NetworkPolicy: 790,
  PersistentVolumeClaim: 790,
  ConfigMap: 790,
  Secret: 790,
  Endpoints: 780,
  EndpointSlice: 780,
  MutatingWebhookConfiguration: 780,
  ValidatingWebhookConfiguration: 780,
  IngressClass: 780,
  Ingress: 780,
  RoleBinding: 800,
  ClusterRoleBinding: 800,
  StorageClass: 770,
  CSIDriver: 760,
  PersistentVolume: 750,
  CustomResourceDefinition: 600,
});

/**
 * KubeNova extensions for kinds Headlamp does not model. They slot into the
 * Headlamp tiers instead of replacing them, so the canonical access path stays
 * intact while Gateway API and autoscaling resources keep their own columns.
 */
export const KUBEJOJO_NODE_WEIGHT_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({
  VerticalPodAutoscaler: 995,
  ReplicationController: 960,
  PodDisruptionBudget: 790,
  ResourceQuota: 790,
  LimitRange: 790,
  RuntimeClass: 780,
  PriorityClass: 780,
  GatewayClass: 785,
  Gateway: 770,
  HTTPRoute: 770,
  GRPCRoute: 770,
  TCPRoute: 770,
  TLSRoute: 770,
  UDPRoute: 770,
  IngressRoute: 770,
  Lease: 600,
});

export const KUBEJOJO_DEFAULT_NODE_WEIGHT = 500;

/** Weight of one concrete Kubernetes kind, or undefined when unknown. */
export function weightForKind(kind?: string | null): number | undefined {
  const normalized = normalizeTopologyKind(kind);
  const candidate = KUBEJOJO_NODE_WEIGHTS[normalized] ?? KUBEJOJO_NODE_WEIGHT_OVERRIDES[normalized];
  return Number.isFinite(candidate) ? candidate : undefined;
}

/**
 * Weight of a capacity aggregate. When several kinds fold into one card the
 * weighted average keeps the aggregate in the column its members dominate, so
 * a Service aggregate never drifts to the left of a Pod aggregate.
 */
export function aggregatedWeight(resource?: KubejojoGraphNode["resource"]): number | undefined {
  const members = Object.entries(resource?.aggregation?.membersByKind ?? {});
  if (!members.length) return undefined;
  let total = 0;
  let weighted = 0;
  members.forEach(([kind, count]) => {
    if (!Number.isFinite(count) || count <= 0) return;
    total += count;
    weighted += (weightForKind(kind) ?? KUBEJOJO_DEFAULT_NODE_WEIGHT) * count;
  });
  return total > 0 ? weighted / total : undefined;
}

/** Every leaf resource below a node, in document order. */
export function leavesKubejojo(node: KubejojoGraphNode): KubejojoGraphNode[] {
  return node.nodes?.length ? node.nodes.flatMap(leavesKubejojo) : [node];
}

/**
 * Effective layout weight: an explicit weight wins, then the node's own
 * weight, then the Headlamp table, then the local overrides.
 */
export function getKubejojoWeight(node: KubejojoGraphNode): number {
  const explicit = node.weight ?? node.resource?.weight;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  return weightForKind(node.resource?.kind)
    ?? aggregatedWeight(node.resource)
    ?? KUBEJOJO_DEFAULT_NODE_WEIGHT;
}

/** Depth-first walk over a node and all of its descendants. */
export function eachKubejojo(node: KubejojoGraphNode, visit: (item: KubejojoGraphNode) => void): void {
  visit(node);
  node.nodes?.forEach((child) => eachKubejojo(child, visit));
}

/** Heaviest first, then stable by id so the canvas never reshuffles. */
export function compareKubejojoNodes(left: KubejojoGraphNode, right: KubejojoGraphNode): number {
  return getKubejojoWeight(right) - getKubejojoWeight(left)
    || left.id.localeCompare(right.id, "en");
}
