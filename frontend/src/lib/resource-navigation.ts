import type { ResourceDetailRequest } from "@/lib/api/resources";

const KIND_ALIASES: Record<string, string> = {
  cluster: "Cluster",
  clusters: "Cluster",
  namespace: "Namespace",
  namespaces: "Namespace",
  node: "Node",
  nodes: "Node",
  pod: "Pod",
  pods: "Pod",
  deployment: "Deployment",
  deployments: "Deployment",
  statefulset: "StatefulSet",
  statefulsets: "StatefulSet",
  daemonset: "DaemonSet",
  daemonsets: "DaemonSet",
  replicaset: "ReplicaSet",
  replicasets: "ReplicaSet",
  job: "Job",
  jobs: "Job",
  cronjob: "CronJob",
  cronjobs: "CronJob",
  service: "Service",
  services: "Service",
  ingress: "Ingress",
  ingresses: "Ingress",
  ingressroute: "IngressRoute",
  ingressroutes: "IngressRoute",
  gateway: "Gateway",
  gateways: "Gateway",
  gatewayclass: "GatewayClass",
  gatewayclasses: "GatewayClass",
  httproute: "HTTPRoute",
  httproutes: "HTTPRoute",
  endpoint: "Endpoints",
  endpoints: "Endpoints",
  endpointslice: "EndpointSlice",
  endpointslices: "EndpointSlice",
  networkpolicy: "NetworkPolicy",
  networkpolicies: "NetworkPolicy",
  configmap: "ConfigMap",
  configmaps: "ConfigMap",
  secret: "Secret",
  secrets: "Secret",
  serviceaccount: "ServiceAccount",
  serviceaccounts: "ServiceAccount",
  persistentvolume: "PersistentVolume",
  persistentvolumes: "PersistentVolume",
  pv: "PersistentVolume",
  persistentvolumeclaim: "PersistentVolumeClaim",
  persistentvolumeclaims: "PersistentVolumeClaim",
  pvc: "PersistentVolumeClaim",
  storageclass: "StorageClass",
  storageclasses: "StorageClass",
  sc: "StorageClass",
};

function normalizeKind(input: string | null | undefined): string {
  const key = (input ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return KIND_ALIASES[key] ?? "";
}

function cleanPart(input: string | null | undefined): string {
  return (input ?? "").trim();
}

export function resolveClusterId(
  value: string | null | undefined,
  clusterMap: Record<string, string>,
): string {
  const text = cleanPart(value);
  if (!text || text === "all") return "";
  if (clusterMap[text] !== undefined) return text;
  const match = Object.entries(clusterMap).find(([, name]) => name === text);
  return match?.[0] ?? text;
}

export function buildClusterDetailRequest(
  clusterId: string | null | undefined,
  clusterMap: Record<string, string> = {},
): ResourceDetailRequest | null {
  const id = resolveClusterId(clusterId, clusterMap);
  if (!id) return null;
  return {
    kind: "Cluster",
    id,
    name: clusterMap[id] ?? id,
    label: clusterMap[id] ?? id,
  };
}

export function buildNamespaceDetailRequest(input: {
  clusterId?: string | null;
  namespace?: string | null;
  clusterMap?: Record<string, string>;
}): ResourceDetailRequest | null {
  const clusterId = resolveClusterId(input.clusterId, input.clusterMap ?? {});
  const namespace = cleanPart(input.namespace);
  if (!clusterId || !namespace || namespace === "all") return null;
  return {
    kind: "Namespace",
    id: `live-namespace:${clusterId}:${namespace}`,
    namespace,
    name: namespace,
    label: namespace,
  };
}

export function buildNodeDetailRequest(input: {
  clusterId?: string | null;
  nodeName?: string | null;
  clusterMap?: Record<string, string>;
}): ResourceDetailRequest | null {
  const clusterId = resolveClusterId(input.clusterId, input.clusterMap ?? {});
  const nodeName = cleanPart(input.nodeName);
  if (!clusterId || !nodeName) return null;
  return {
    kind: "Node",
    id: `live-node:${clusterId}:${nodeName}`,
    name: nodeName,
    label: nodeName,
  };
}

export function parseResourceRef(value: string | null | undefined): {
  kind: string;
  namespace?: string;
  name: string;
} | null {
  const text = cleanPart(value).replace(/^resource:/i, "");
  if (!text || text === "-") return null;
  const parts = text
    .split(/[/:]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const kind = normalizeKind(parts[0]);
  if (!kind) return null;
  if (parts.length >= 3) {
    return { kind, namespace: parts[1], name: parts.slice(2).join("/") };
  }
  return { kind, name: parts[1] };
}

export function buildResourceRefDetailRequest(input: {
  resourceRef?: string | null;
  resourceKind?: string | null;
  resourceName?: string | null;
  clusterId?: string | null;
  namespace?: string | null;
  clusterMap?: Record<string, string>;
}): ResourceDetailRequest | null {
  const parsed = parseResourceRef(input.resourceRef);
  const kind = parsed?.kind ?? normalizeKind(input.resourceKind);
  const name = parsed?.name ?? cleanPart(input.resourceName);
  const namespace = parsed?.namespace ?? cleanPart(input.namespace);
  const clusterId = resolveClusterId(input.clusterId, input.clusterMap ?? {});
  if (!kind || !name || !clusterId) return null;
  if (kind === "Cluster") return buildClusterDetailRequest(name, input.clusterMap);
  if (kind === "Namespace") return buildNamespaceDetailRequest({ clusterId, namespace: name, clusterMap: input.clusterMap });
  if (kind === "Node") return buildNodeDetailRequest({ clusterId, nodeName: name, clusterMap: input.clusterMap });
  const clusterScoped = new Set(["PersistentVolume", "StorageClass", "GatewayClass"]);
  const id = clusterScoped.has(kind)
    ? `${clusterId}//${name}`
    : `${clusterId}/${namespace || "default"}/${name}`;
  return {
    kind,
    id,
    namespace: namespace || undefined,
    name,
    label: name,
  };
}
