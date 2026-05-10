"use client";

import type { QueryClient } from "@tanstack/react-query";

export type RealtimeDomain =
  | "workloads"
  | "network"
  | "configs"
  | "storage"
  | "namespaces"
  | "clusters";

export type RealtimeAction = "upsert" | "delete" | "unknown";

export type RealtimeEvent = {
  clusterId: string;
  domains: RealtimeDomain[];
  kind: string;
  phase: string;
  action?: RealtimeAction;
  resource?: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    state?: string;
  };
  timestamp: string;
};

export type ListPatchCandidate = {
  id?: string;
  key?: string;
  name?: string;
  名称?: string;
  namespace?: string;
  名称空间?: string;
  clusterId?: string;
  clusterName?: string;
  集群?: string;
  kind?: string;
  state?: string;
  状态?: string;
  metadata?: {
    uid?: string;
    resourceVersion?: string;
  };
};

type QueryPrefix = readonly unknown[];

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameText(left: unknown, right: unknown): boolean {
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function pickText(item: ListPatchCandidate, keys: string[]): string {
  for (const key of keys) {
    const value = (item as Record<string, unknown>)[key];
    const normalized = normalize(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function topologyQueryKeyForResource(resourceKind: string): QueryPrefix | null {
  switch (resourceKind) {
    case "pods":
      return ["topology-network"];
    case "deployments":
      return ["topology-deployments"];
    case "statefulsets":
      return ["topology-statefulsets"];
    case "daemonsets":
      return ["topology-daemonsets"];
    case "namespaces":
      return ["topology-network"];
    case "clusters":
      return ["topology-network"];
    case "Service":
    case "Endpoints":
    case "EndpointSlice":
    case "Ingress":
    case "IngressRoute":
      return ["topology-network"];
    default:
      return null;
  }
}

export function resourceKindKey(kind: string): string {
  const normalized = normalize(kind).toLowerCase();
  if (normalized === "pod") return "pods";
  if (normalized === "deployment") return "deployments";
  if (normalized === "statefulset") return "statefulsets";
  if (normalized === "daemonset") return "daemonsets";
  if (normalized === "replicaset") return "replicasets";
  if (normalized === "job") return "jobs";
  if (normalized === "cronjob") return "cronjobs";
  if (normalized === "helmrelease") return "releases";
  if (normalized === "helmrepository") return "repositories";
  if (normalized === "service") return "Service";
  if (normalized === "endpoints") return "Endpoints";
  if (normalized === "endpointslice") return "EndpointSlice";
  if (normalized === "ingress") return "Ingress";
  if (normalized === "ingressroute") return "IngressRoute";
  if (normalized === "configmap") return "configmaps";
  if (normalized === "secret") return "secrets";
  if (normalized === "serviceaccount") return "serviceaccounts";
  if (normalized === "persistentvolume") return "PV";
  if (normalized === "persistentvolumeclaim") return "PVC";
  if (normalized === "storageclass") return "SC";
  if (normalized === "namespace") return "namespaces";
  if (normalized === "cluster") return "clusters";
  return kind;
}

function getEventResourceKind(event: RealtimeEvent): string {
  return event.resource?.kind
    ? resourceKindKey(event.resource.kind)
    : resourceKindKey(event.kind);
}

export function getRealtimeQueryPrefixes(event: RealtimeEvent): QueryPrefix[] {
  const resourceKind = getEventResourceKind(event);

  switch (resourceKind) {
    case "pods":
      return [["workloads", "pods"]];
    case "deployments":
      return [["workloads", "deployments"], ["workloads", "pods"]];
    case "statefulsets":
      return [["workloads", "StatefulSet"], ["workloads", "statefulsets"], ["workloads", "pods"]];
    case "daemonsets":
      return [["workloads", "DaemonSet"], ["workloads", "daemonsets"], ["workloads", "pods"]];
    case "replicasets":
      return [["workloads", "ReplicaSet"], ["workloads", "replicasets"], ["workloads", "pods"]];
    case "jobs":
      return [["workloads", "Job"], ["workloads", "jobs"], ["workloads", "pods"]];
    case "cronjobs":
      return [["workloads", "CronJob"], ["workloads", "cronjobs"], ["workloads", "pods"]];
    case "Service":
      return [["network", "Service"]];
    case "Endpoints":
      return [["network", "Endpoints"]];
    case "EndpointSlice":
      return [["network", "EndpointSlice"]];
    case "Ingress":
      return [["network", "Ingress"]];
    case "IngressRoute":
      return [["network", "IngressRoute"]];
    case "configmaps":
      return [["configs", "configmaps"]];
    case "secrets":
      return [["configs", "secrets"]];
    case "serviceaccounts":
      return [["serviceaccounts"], ["configs", "serviceaccounts"]];
    case "repositories":
      return [["helm", "repositories"]];
    case "releases":
      return [["helm", "releases"]];
    case "PV":
      return [["storage", "PV"]];
    case "PVC":
      return [["storage", "PVC"]];
    case "SC":
      return [["storage", "SC"]];
    case "namespaces":
      return [
        ["namespaces"],
        ["serviceaccounts", "namespaces"],
        ["workloads", "pods"],
        ["workloads", "deployments"],
        ["workloads", "statefulsets"],
        ["workloads", "daemonsets"],
        ["workloads", "replicasets"],
        ["workloads", "jobs"],
        ["workloads", "cronjobs"],
        ["network", "Service"],
        ["network", "Endpoints"],
        ["network", "EndpointSlice"],
        ["network", "Ingress"],
        ["network", "IngressRoute"],
        ["configs", "configmaps"],
        ["configs", "secrets"],
        ["serviceaccounts"],
        ["storage", "PV"],
        ["storage", "PVC"],
        ["storage", "SC"],
      ];
    case "clusters":
      return [
        ["clusters"],
        ["clusters", "all"],
        ["clusters", "list"],
        ["clusters", "all-for-workload-create-workspace"],
        ["clusters", "all-for-helm"],
        ["clusters", "all-for-helm-repositories"],
        ["clusters", "list-for-pods"],
        ["clusters", "inspection"],
        ["clusters", "autoscaling"],
        ["serviceaccounts", "clusters"],
      ];
    default:
      return [];
  }
}

export function getTopologyQueryPrefixes(event: RealtimeEvent): QueryPrefix[] {
  const clusterId = normalize(event.clusterId);
  if (!clusterId) {
    return [];
  }

  const resourceKind = event.resource?.kind
    ? resourceKindKey(event.resource.kind)
    : resourceKindKey(event.kind);
  const topologyKinds = new Set([
    "pods",
    "deployments",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "jobs",
    "cronjobs",
    "Service",
    "Endpoints",
    "EndpointSlice",
    "Ingress",
    "IngressRoute",
    "configmaps",
    "secrets",
    "serviceaccounts",
    "repositories",
    "releases",
    "PV",
    "PVC",
    "SC",
    "namespaces",
    "clusters",
  ]);

  if (!topologyKinds.has(resourceKind)) {
    return [];
  }

  const queryKey = topologyQueryKeyForResource(resourceKind);
  return queryKey ? [[...queryKey, clusterId]] : [];
}

function isPatchCandidate(item: unknown): item is ListPatchCandidate {
  return Boolean(item && typeof item === "object");
}

function matchesIdentity(item: ListPatchCandidate, event: RealtimeEvent): boolean {
  const resourceKind = getEventResourceKind(event);
  const itemCluster = pickText(
    item,
    resourceKind === "clusters"
      ? ["clusterId", "clusterName", "集群", "id"]
      : ["clusterId", "clusterName", "集群"],
  );
  const itemNamespace = pickText(
    item,
    resourceKind === "namespaces"
      ? ["namespace", "名称空间", "name", "名称"]
      : ["namespace", "名称空间"],
  );
  const itemName = pickText(
    item,
    resourceKind === "namespaces"
      ? ["namespace", "名称空间", "name", "名称"]
      : ["name", "名称"],
  );
  const itemResourceVersion = normalize(item.metadata?.resourceVersion);
  const clusterMatch = !normalize(event.clusterId) || sameText(itemCluster, event.clusterId);
  const namespaceMatch =
    !normalize(event.resource?.namespace) || sameText(itemNamespace, event.resource?.namespace);
  const nameMatch = !normalize(event.resource?.name) || sameText(itemName, event.resource?.name);
  const uidMatch =
    Boolean(normalize(event.resource?.uid)) &&
    (sameText(item.id, event.resource?.uid) || sameText(item.key, event.resource?.uid));
  const resourceVersionMatch =
    !normalize(event.resource?.resourceVersion) ||
    !itemResourceVersion ||
    sameText(itemResourceVersion, event.resource?.resourceVersion);

  return (((clusterMatch && namespaceMatch && nameMatch) || uidMatch) && resourceVersionMatch);
}

function mergeCandidate<T extends ListPatchCandidate>(item: T, event: RealtimeEvent): T {
  const nextCluster = normalize(event.clusterId) || item.clusterId || item.clusterName || item.集群;
  const nextNamespace = event.resource?.namespace ?? item.namespace ?? item.名称空间;
  const nextName = event.resource?.name ?? item.name ?? item.名称;
  const nextState =
    event.action === "delete"
      ? "deleted"
      : event.resource?.state ?? item.state ?? item.状态;
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      uid: item.metadata?.uid ?? event.resource?.uid,
      resourceVersion: event.resource?.resourceVersion ?? item.metadata?.resourceVersion,
    },
    clusterId: nextCluster,
    clusterName: item.clusterName ?? nextCluster,
    集群: item.集群 ?? nextCluster,
    kind: event.resource?.kind ? event.resource.kind : item.kind,
    namespace: nextNamespace,
    名称空间: item.名称空间 ?? nextNamespace,
    name: nextName,
    名称: item.名称 ?? nextName,
    state: nextState,
    状态: item.状态 ?? nextState,
  } as T;
}

export function applyRealtimePatch(
  queryClient: QueryClient,
  event: RealtimeEvent,
): boolean {
  const queryPrefixes = getRealtimeQueryPrefixes(event);
  let patched = false;

  const patchList = (queryKey: QueryPrefix) => {
    let prefixPatched = false;
    queryClient.setQueriesData({ queryKey }, (current: unknown) => {
      if (!current || typeof current !== "object") {
        return current;
      }
      const result = current as {
        items?: unknown[];
      };
      if (!Array.isArray(result.items)) {
        return current;
      }

      const items = result.items;
      let itemMatched = false;
      const nextItems = items.reduce<unknown[]>((acc, item) => {
        if (!isPatchCandidate(item)) {
          acc.push(item);
          return acc;
        }
        if (!matchesIdentity(item, event)) {
          acc.push(item);
          return acc;
        }
        itemMatched = true;
        if (event.action === "delete") {
          return acc;
        }
        acc.push(mergeCandidate(item, event));
        return acc;
      }, []);

      if (!itemMatched) {
        return current;
      }
      prefixPatched = true;
      patched = true;
      return { ...result, items: nextItems };
    });
    return prefixPatched;
  };

  for (const queryKey of queryPrefixes) {
    if (patchList(queryKey)) {
      return true;
    }
  }

  return patched;
}
