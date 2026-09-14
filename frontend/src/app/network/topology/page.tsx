"use client";

import {
  BranchesOutlined,
  ClockCircleOutlined,
  CompressOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExpandOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Descriptions, Drawer, Input, Segmented, Select, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth-context";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { NamespaceFilterSelect } from "@/components/namespace-select";
import { TopologySourceFilter } from "@/components/topology-source-filter";
import { OpsEmptyState, OpsErrorState, OpsIconActionButton, OpsLoadingState } from "@/components/ops";
import { ResourceDetailDrawer, type ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { getClusters } from "@/lib/api/clusters";
import type { DynamicResourceIdentity, ResourceIdentity } from "@/lib/api/resources";
import {
  getTopologyGraphV2,
  type TopologyGraphRelation,
  type TopologyGraphResource,
  type TopologyGraphSource,
} from "@/lib/api/topology-graph";
import { getTopologyNamespaceSummaries } from "@/lib/api/topology-summary";
import { emitResourceScopeChange, readStoredResourceNamespace } from "@/lib/resource-scope-events";
import { resolveWorkspaceClusterId, resolveWorkspaceResourceHref } from "@/lib/cluster-workspace";
import { buildResourceRefDetailRequest } from "@/lib/resource-navigation";
import {
  KubejojoTopologyCanvas,
  type KubejojoTopologySelection,
} from "@/modules/topology-kubejojo/TopologyCanvas";
import {
  isTopologyRootKind,
  projectTopologyRoot,
  resolveTopologyRoot,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
} from "@/modules/topology-kubejojo/engine";
import { normalizeTopologyKind } from "@/modules/topology-kubejojo/kind";
import { getIncompleteTopologySources } from "@/modules/topology-kubejojo/coverage";

const ALL_NAMESPACE = "__all__";
const QUERY_STALE_MS = 30_000;
const GLOBAL_EXPAND_LIMIT = 80;
const SELECTED_RELATION_PREVIEW_LIMIT = 50;
const SOURCE_KEYS: TopologyGraphSource[] = ["workloads", "network", "storage", "configuration"];

const SOURCE_META: Record<
  TopologyGraphSource,
  { label: string; lightColor: string; darkColor: string; icon: ReactNode }
> = {
  workloads: { label: "工作负载", lightColor: "#2563eb", darkColor: "#7dabff", icon: <DeploymentUnitOutlined /> },
  network: { label: "网络", lightColor: "#0e7490", darkColor: "#67e8f9", icon: <BranchesOutlined /> },
  storage: { label: "存储", lightColor: "#047857", darkColor: "#5ee0a0", icon: <DatabaseOutlined /> },
  configuration: { label: "配置", lightColor: "#9a6700", darkColor: "#f5c451", icon: <FileTextOutlined /> },
};

const GROUP_OPTIONS: Array<{ value: Exclude<KubejojoGroupBy, "namespace">; label: string }> = [
  { value: "instance", label: "实例" },
  { value: "node", label: "节点" },
];

const KIND_LABEL: Record<string, string> = {
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
  PersistentVolume: "PersistentVolume",
  PersistentVolumeClaim: "PersistentVolumeClaim",
  StorageClass: "StorageClass",
  ConfigMap: "ConfigMap",
  Secret: "Secret",
  ServiceAccount: "ServiceAccount",
};

const KIND_WEIGHT: Record<string, number> = {
  Ingress: 1040,
  Gateway: 1030,
  Deployment: 980,
  StatefulSet: 960,
  DaemonSet: 960,
  CronJob: 950,
  ReplicaSet: 940,
  Job: 920,
  Service: 880,
  EndpointSlice: 850,
  Endpoints: 840,
  Pod: 820,
  NetworkPolicy: 810,
  PersistentVolumeClaim: 780,
  PersistentVolume: 770,
  StorageClass: 760,
  ConfigMap: 750,
  Secret: 750,
  ServiceAccount: 740,
};

type DetailRequest = NonNullable<ResourceDetailDrawerProps["request"]>;

interface YamlTarget {
  identity: ResourceIdentity;
  dynamicIdentity?: DynamicResourceIdentity;
}

interface FilteredGraph {
  resources: TopologyGraphResource[];
  relations: TopologyGraphRelation[];
}

const normalizeKind = normalizeTopologyKind;

const RESOURCE_MANAGEMENT_ROUTES: Record<string, string> = {
  Pod: "/workloads/pods",
  Deployment: "/workloads/deployments",
  StatefulSet: "/workloads/statefulsets",
  DaemonSet: "/workloads/daemonsets",
  ReplicaSet: "/workloads/replicasets",
  Job: "/workloads/jobs",
  CronJob: "/workloads/cronjobs",
  Service: "/network/services",
  Ingress: "/network/ingress",
  IngressRoute: "/network/ingress",
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
};

function resourceStatus(resource: TopologyGraphResource): "healthy" | "warning" | "critical" | "unknown" {
  const status = resource.status.trim().toLowerCase();
  if (["error", "failed", "failure", "unhealthy", "critical"].includes(status)) return "critical";
  if (resource.warnings > 0 || ["warning", "pending", "degraded"].includes(status)) return "warning";
  if (["unknown", "unavailable"].includes(status)) return "unknown";
  return "healthy";
}

function resourceMatches(resource: TopologyGraphResource, query: string): boolean {
  if (!query) return true;
  return [
    resource.name,
    resource.kind,
    resource.namespace ?? "",
    resource.instanceName ?? "",
    ...resource.tags,
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function filterGraph(
  resources: TopologyGraphResource[],
  relations: TopologyGraphRelation[],
  selectedSources: ReadonlySet<TopologyGraphSource>,
  queryText: string,
  errorsOnly: boolean,
): FilteredGraph {
  const sourceResources = resources.filter((resource) => selectedSources.has(resource.source));
  const sourceIds = new Set(sourceResources.map((resource) => resource.id));
  const sourceRelations = relations.filter(
    (relation) => sourceIds.has(relation.source) && sourceIds.has(relation.target),
  );
  const query = queryText.trim().toLocaleLowerCase();
  if (!query && !errorsOnly) return { resources: sourceResources, relations: sourceRelations };

  const matched = new Set(
    sourceResources
      .filter((resource) => {
        if (errorsOnly && resourceStatus(resource) === "healthy") return false;
        return resourceMatches(resource, query);
      })
      .map((resource) => resource.id),
  );
  const visible = new Set(matched);
  sourceRelations.forEach((relation) => {
    if (matched.has(relation.source) || matched.has(relation.target)) {
      visible.add(relation.source);
      visible.add(relation.target);
    }
  });
  return {
    resources: sourceResources.filter((resource) => visible.has(resource.id)),
    relations: sourceRelations.filter(
      (relation) => visible.has(relation.source) && visible.has(relation.target),
    ),
  };
}

function toCanvasResource(resource: TopologyGraphResource): KubejojoResource {
  const kind = normalizeKind(resource.kind);
  return {
    id: resource.id,
    name: resource.name,
    kind,
    namespace: resource.namespace,
    instanceName: resource.instanceName,
    nodeName: resource.nodeName,
    source: resource.source,
    status: resourceStatus(resource),
    summary: resource.summary || KIND_LABEL[kind] || kind,
    detailLines: resource.detailLines,
    tags: resource.tags,
    warnings: resource.warnings > 0 ? [`${resource.warnings} 条活动告警`] : [],
    weight: KIND_WEIGHT[kind] ?? 500,
    identity: resource.identity,
    identityKey: resource.identityKey,
  };
}

function toCanvasRelation(relation: TopologyGraphRelation): KubejojoRelation {
  return {
    id: relation.id,
    source: relation.source,
    target: relation.target,
    label: relation.label,
    role: relation.role,
    type: relation.type,
    direction: relation.direction,
    ports: relation.ports,
    evidence: relation.evidence,
    confidence: relation.confidence,
  };
}

function detailRequest(resource: TopologyGraphResource): DetailRequest {
  const kind = normalizeKind(resource.kind);
  const dynamic = dynamicIdentity(resource);
  if (dynamic) {
    return {
      kind: "dynamic",
      id: [
        "dynamic",
        dynamic.clusterId,
        dynamic.group,
        dynamic.version,
        dynamic.resource,
        dynamic.namespace ?? "",
        dynamic.name,
      ].join(":"),
      kindLabel: KIND_LABEL[kind] ?? kind,
      apiVersion: resource.identity.apiVersion ?? undefined,
      namespace: resource.namespace ?? undefined,
      name: resource.name,
      label: resource.name,
    };
  }
  const stableRequest = buildResourceRefDetailRequest({
    resourceKind: kind,
    resourceName: resource.name,
    clusterId: resource.clusterId,
    namespace: resource.namespace,
  });
  return {
    kind,
    // Record ids are database implementation details. The detail API also
    // accepts a stable cluster/namespace/name identity, which keeps topology
    // navigation working across syncs and after records are recreated.
    id: stableRequest?.id ?? resource.recordId,
    kindLabel: KIND_LABEL[kind] ?? kind,
    apiVersion: resource.identity.apiVersion ?? undefined,
    namespace: resource.namespace ?? undefined,
    name: resource.name,
    label: resource.name,
    snapshot: {
      status: { value: resource.status, warnings: resource.warnings },
      labels: Object.fromEntries(
        resource.tags.map((tag) => {
          const [key, ...value] = tag.split("=");
          return [key, value.join("=")];
        }),
      ),
    },
  };
}

function dynamicIdentity(resource: TopologyGraphResource): DynamicResourceIdentity | undefined {
  const kind = normalizeKind(resource.kind);
  const meta = {
    GatewayClass: {
      group: "gateway.networking.k8s.io",
      version: "v1",
      resource: "gatewayclasses",
      namespaced: false,
    },
    Gateway: {
      group: "gateway.networking.k8s.io",
      version: "v1",
      resource: "gateways",
      namespaced: true,
    },
    HTTPRoute: {
      group: "gateway.networking.k8s.io",
      version: "v1",
      resource: "httproutes",
      namespaced: true,
    },
    PersistentVolume: {
      group: "",
      version: "v1",
      resource: "persistentvolumes",
      namespaced: false,
    },
    StorageClass: {
      group: "storage.k8s.io",
      version: "v1",
      resource: "storageclasses",
      namespaced: false,
    },
  }[kind];
  if (!meta) return undefined;
  return {
    clusterId: resource.clusterId,
    group: meta.group,
    version: meta.version,
    resource: meta.resource,
    namespace: meta.namespaced ? resource.namespace ?? undefined : undefined,
    name: resource.name,
  };
}

function yamlTarget(resource: TopologyGraphResource): YamlTarget {
  const dynamic = dynamicIdentity(resource);
  return {
    identity: {
      clusterId: resource.clusterId,
      namespace: resource.namespace ?? "",
      kind: normalizeKind(resource.kind),
      name: resource.name,
    },
    dynamicIdentity: dynamic,
  };
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "未知";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN") : "未知";
}

function freshnessMessage(data: Awaited<ReturnType<typeof getTopologyGraphV2>>): string {
  if (data.freshness.status === "unavailable") return "当前集群尚无可用的资源库存快照。";
  return `当前显示最近一次成功库存，数据时间 ${formatTimestamp(data.dataAsOf)}。`;
}

export default function NetworkTopologyPage() {
  const { accessToken: token } = useAuth();
  const workspace = useOptionalClusterWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState(() => {
    const storedNamespace = readStoredResourceNamespace(workspace?.clusterId ?? "");
    return storedNamespace || ALL_NAMESPACE;
  });
  const [selectedSources, setSelectedSources] = useState<Set<TopologyGraphSource>>(
    () => new Set(SOURCE_KEYS),
  );
  // Namespace is a request scope only; visual grouping is limited to the two
  // dimensions Headlamp exposes for a resource map.
  const [groupBy, setGroupBy] = useState<Exclude<KubejojoGroupBy, "namespace">>("instance");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [queryText, setQueryText] = useState("");
  const [topologyRootId, setTopologyRootId] = useState<string | null>(null);
  const [useRequestedRoot, setUseRequestedRoot] = useState(true);
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [topologySelection, setTopologySelection] = useState<KubejojoTopologySelection | null>(null);
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [yaml, setYaml] = useState<YamlTarget | null>(null);
  const [fitVersion, setFitVersion] = useState("initial");
  const [topologyDisplayMode, setTopologyDisplayMode] = useState<"core" | "full">("core");

  const clusterQuery = useQuery({
    queryKey: ["topology-v2", "clusters", token],
    queryFn: ({ signal }) => getClusters({ pageSize: 200, state: "active" }, token!, { signal }),
    enabled: Boolean(token),
    staleTime: QUERY_STALE_MS,
  });
  const clusters = clusterQuery.data?.items ?? [];
  const selectedCluster = workspace
    ? clusters.find((cluster) => cluster.id === workspace.clusterId) ?? null
    : clusters.find((cluster) => cluster.id === selectedClusterId) ?? clusters[0] ?? null;
  const effectiveClusterId = resolveWorkspaceClusterId(workspace?.clusterId, selectedCluster?.id ?? "");

  const namespaceQuery = useQuery({
    queryKey: ["topology-v2", "namespaces", effectiveClusterId, token],
    queryFn: ({ signal }) =>
      getTopologyNamespaceSummaries({ clusterId: effectiveClusterId }, token, { signal }),
    enabled: Boolean(token && effectiveClusterId),
    staleTime: QUERY_STALE_MS,
  });

  const requestedSources = useMemo(
    () => SOURCE_KEYS.filter((source) => selectedSources.has(source)),
    [selectedSources],
  );
  const graphQuery = useQuery({
    queryKey: [
      "topology-v2",
      "graph",
      effectiveClusterId,
      selectedNamespace,
      requestedSources,
      token,
    ],
    queryFn: ({ signal }) =>
      getTopologyGraphV2(
        {
          clusterId: effectiveClusterId,
          namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace,
          sources: requestedSources,
        },
        token,
        { signal },
      ),
    enabled: Boolean(token && effectiveClusterId && requestedSources.length),
    staleTime: QUERY_STALE_MS,
  });

  const requestedRoot = useMemo(
    () => ({
      kind: searchParams.get("rootKind"),
      name: searchParams.get("rootName"),
      namespace: searchParams.get("namespace"),
    }),
    [searchParams],
  );

  const filteredGraph = useMemo(
    () => filterGraph(
      graphQuery.data?.resources ?? [],
      graphQuery.data?.relations ?? [],
      selectedSources,
      queryText,
      errorsOnly,
    ),
    [errorsOnly, graphQuery.data, queryText, selectedSources],
  );
  const requestedTopologyRoot = useMemo(
    () => resolveTopologyRoot(
      filteredGraph.resources,
      requestedRoot.kind,
      requestedRoot.name,
      requestedRoot.namespace,
    ),
    [filteredGraph.resources, requestedRoot.kind, requestedRoot.name, requestedRoot.namespace],
  );
  const topologyRoot = useMemo(
    () => filteredGraph.resources.find((resource) => resource.id === topologyRootId)
      ?? (useRequestedRoot ? requestedTopologyRoot : null),
    [filteredGraph.resources, requestedTopologyRoot, topologyRootId, useRequestedRoot],
  );
  const workloadRoots = useMemo(
    () => filteredGraph.resources
      .filter((resource) => isTopologyRootKind(normalizeKind(resource.kind)))
      .sort((left, right) => (
        normalizeKind(left.kind).localeCompare(normalizeKind(right.kind), "en")
        || left.namespace?.localeCompare(right.namespace ?? "", "zh-CN")
        || left.name.localeCompare(right.name, "en")
      )),
    [filteredGraph.resources],
  );
  const graph = useMemo<FilteredGraph>(() => {
    if (!topologyRoot) return { resources: [], relations: [] };
    const projected = projectTopologyRoot(
      filteredGraph.resources,
      filteredGraph.relations,
      topologyRoot.id,
    );
    return { resources: projected.resources, relations: projected.relations };
  }, [filteredGraph, topologyRoot]);
  const canvasResources = useMemo(
    () => graph.resources.map(toCanvasResource),
    [graph.resources],
  );
  const canvasRelations = useMemo(
    () => graph.relations.map(toCanvasRelation),
    [graph.relations],
  );
  const selectedResourceId = topologySelection?.resourceId ?? null;
  const selectedResource = useMemo(
    () => graphQuery.data?.resources.find((resource) => resource.id === selectedResourceId) ?? null,
    [graphQuery.data?.resources, selectedResourceId],
  );
  const selectedRelations = useMemo(
    () => (graphQuery.data?.relations ?? []).filter(
      (relation) => relation.source === selectedResourceId || relation.target === selectedResourceId,
    ),
    [graphQuery.data?.relations, selectedResourceId],
  );
  const visibleSelectedRelations = useMemo(
    () => selectedRelations.slice(0, SELECTED_RELATION_PREVIEW_LIMIT),
    [selectedRelations],
  );
  const resourcesById = useMemo(
    () => new Map((graphQuery.data?.resources ?? []).map((resource) => [resource.id, resource])),
    [graphQuery.data?.resources],
  );
  const sourceCounts = useMemo(
    () => Object.fromEntries(
      SOURCE_KEYS.map((source) => [
        source,
        (graphQuery.data?.resources ?? []).filter((resource) => resource.source === source).length,
      ]),
    ) as Record<TopologyGraphSource, number>,
    [graphQuery.data?.resources],
  );
  const sourceWarningCounts = useMemo(
    () => Object.fromEntries(
      SOURCE_KEYS.map((source) => [
        source,
        (graphQuery.data?.resources ?? []).filter(
          (resource) => resource.source === source && resourceStatus(resource) !== "healthy",
        ).length,
      ]),
    ) as Record<TopologyGraphSource, number>,
    [graphQuery.data?.resources],
  );
  const namespaceOptions = useMemo(() => {
    const fromSummary = (namespaceQuery.data?.items ?? [])
      .map((item) => item.namespace)
      .filter((item): item is string => Boolean(item));
    const fromGraph = (graphQuery.data?.resources ?? [])
      .map((resource) => resource.namespace)
      .filter((item): item is string => Boolean(item));
    return Array.from(new Set([...fromSummary, ...fromGraph])).sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
  }, [graphQuery.data?.resources, namespaceQuery.data?.items]);

  const incompleteSources = graphQuery.data
    ? getIncompleteTopologySources(graphQuery.data.coverage.sources, requestedSources)
    : [];
  const warningCount = (graphQuery.data?.resources ?? []).filter(
    (resource) => resource.warnings > 0 || resourceStatus(resource) !== "healthy",
  ).length;
  const loading = clusterQuery.isLoading
    || graphQuery.isLoading
    || namespaceQuery.isLoading
    || clusterQuery.isFetching
    || graphQuery.isFetching
    || namespaceQuery.isFetching;
  const error = clusterQuery.error ?? graphQuery.error;
  const noClusters = !clusterQuery.isLoading && !clusterQuery.error && clusters.length === 0;
  const rawResourceCount = filteredGraph.resources.length;
  const canExpandAll = graph.resources.length > 0 && graph.resources.length <= GLOBAL_EXPAND_LIMIT;
  const effectiveExpandAll = expandAll && canExpandAll;
  const canvasExpandAll = effectiveExpandAll || Boolean(topologyRootId);
  const filtersActive = Boolean(
    queryInput.trim() || errorsOnly || selectedSources.size < SOURCE_KEYS.length,
  );

  const resetFocus = useCallback(() => {
    setUseRequestedRoot(false);
    setTopologyRootId(null);
    setFocusedGroupId(null);
    setTopologySelection(null);
    setExpandAll(false);
    setTopologyDisplayMode("core");
  }, []);

  const selectTopologyResource = useCallback((selection: KubejojoTopologySelection | null) => {
    setTopologySelection(selection);
  }, []);

  useEffect(() => {
    if (queryInput === queryText) return;
    const timeout = window.setTimeout(() => {
      setQueryText(queryInput);
      resetFocus();
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [queryInput, queryText, resetFocus]);

  const refresh = useCallback(() => {
    void clusterQuery.refetch();
    void namespaceQuery.refetch();
    void graphQuery.refetch();
    setFitVersion(String(Date.now()));
  }, [clusterQuery, graphQuery, namespaceQuery]);

  const toggleSource = useCallback((source: TopologyGraphSource) => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(source) && next.size > 1) next.delete(source);
      else next.add(source);
      return next;
    });
    resetFocus();
  }, [resetFocus]);

  const resetFilters = useCallback(() => {
    setSelectedSources(new Set(SOURCE_KEYS));
    setErrorsOnly(false);
    setQueryInput("");
    setQueryText("");
    resetFocus();
  }, [resetFocus]);

  const selectCluster = useCallback((clusterId: string) => {
    const nextNamespace = readStoredResourceNamespace(clusterId) || ALL_NAMESPACE;
    setSelectedClusterId(clusterId);
    setSelectedNamespace(nextNamespace);
    resetFocus();
    emitResourceScopeChange({
      clusterId,
      namespace: nextNamespace === ALL_NAMESPACE ? undefined : nextNamespace,
    });
  }, [resetFocus]);

  const selectNamespace = useCallback((namespace: string) => {
    setSelectedNamespace(namespace);
    resetFocus();
    if (effectiveClusterId) {
      emitResourceScopeChange({
        clusterId: effectiveClusterId,
        clusterName: selectedCluster?.name ?? effectiveClusterId,
        namespace: namespace === ALL_NAMESPACE ? undefined : namespace,
      });
    }
  }, [effectiveClusterId, resetFocus, selectedCluster?.name]);

  const openTopologyRoot = useCallback((resource: TopologyGraphResource) => {
    if (!isTopologyRootKind(normalizeKind(resource.kind))) return;
    setTopologyRootId(resource.id);
    setFocusedGroupId(null);
    setTopologySelection(null);
    setExpandAll(true);
    setFitVersion(String(Date.now()));
  }, []);

  const navigateToResource = useCallback((resource: TopologyGraphResource) => {
    const kind = normalizeKind(resource.kind);
    const routes = RESOURCE_MANAGEMENT_ROUTES;
    const params = new URLSearchParams({ keyword: resource.name });
    if (!workspace) params.set("clusterId", resource.clusterId);
    if (resource.namespace) params.set("namespace", resource.namespace);
    const targetPath = resolveWorkspaceResourceHref(
      workspace?.clusterId,
      routes[kind] ?? "/network/topology",
    );
    router.push(`${targetPath}?${params.toString()}`);
    setTopologySelection(null);
    setDetail(null);
  }, [router, workspace]);

  const navigateDetailRequest = useCallback((request: DetailRequest) => {
    const kind = normalizeKind(request.kind);
    const route = RESOURCE_MANAGEMENT_ROUTES[kind];
    if (!route || !request.name) {
      setDetail(request);
      return;
    }
    const idParts = request.id.split("/");
    const clusterId = workspace?.clusterId || (
      idParts[0] && !request.id.startsWith("dynamic:")
        ? idParts[0]
        : effectiveClusterId
    );
    const params = new URLSearchParams({
      ...(!workspace && clusterId ? { clusterId } : {}),
      keyword: request.name,
    });
    if (request.namespace) params.set("namespace", request.namespace);
    router.push(`${resolveWorkspaceResourceHref(workspace?.clusterId, route)}?${params.toString()}`);
    setDetail(null);
    setTopologySelection(null);
  }, [effectiveClusterId, router, workspace]);

  return (
    <section className={[
      "resource-map-shell",
      "resource-map-shell--workbench",
      focusedGroupId ? "resource-map-shell--focused" : "",
    ].filter(Boolean).join(" ")}>
      <ResourcePageHeader
        path="/network/topology"
        embedded
        className="resource-map-header"
        title="资源拓扑"
        description="单集群工作负载、网络、存储与配置关系"
        actions={(
          <div className="resource-map-header__stats" aria-label="拓扑摘要">
            <span><strong>{topologyRoot ? graph.resources.length : workloadRoots.length}</strong> {topologyRoot ? "资源" : "工作负载"}</span>
            <span><strong>{topologyRoot ? graph.relations.length : "-"}</strong> {topologyRoot ? "关系" : "待查看关系"}</span>
            <span><strong>{warningCount}</strong> 异常</span>
            {graphQuery.data ? (
              <span title={`revision ${graphQuery.data.revision}`}>
                <ClockCircleOutlined /> {formatTimestamp(graphQuery.data.dataAsOf)}
              </span>
            ) : null}
          </div>
        )}
      />

      <div
        className="resource-map-toolbar resource-filter-toolbar topology-control-toolbar"
        aria-label="拓扑控制栏"
        aria-busy={loading}
      >
        <div className="resource-map-toolbar__primary">
          <div className="resource-map-toolbar__scope">
            {!workspace ? (
              <div className="resource-map-context-field">
                <span className="resource-map-context-field__label">集群:</span>
                <Select
                  aria-label="选择集群"
                  value={selectedCluster?.id}
                  placeholder="选择集群"
                  disabled={clusters.length === 0}
                  options={clusters.map((cluster) => ({ value: cluster.id, label: cluster.name }))}
                  onChange={selectCluster}
                />
              </div>
            ) : null}
            <NamespaceFilterSelect
              className="resource-map-namespace-filter"
              value={selectedNamespace}
              namespaces={namespaceOptions}
              allValue={ALL_NAMESPACE}
              disabled={!effectiveClusterId}
              loading={namespaceQuery.isLoading}
              onChange={selectNamespace}
            />
          </div>

          <div className="resource-map-toolbar__actions">
            {topologyRoot ? (
              <Segmented<"core" | "full">
                className="resource-map-view-mode"
                aria-label="拓扑视图模式"
                value={topologyDisplayMode}
                options={[
                  { value: "core", label: "核心链路" },
                  { value: "full", label: "完整关联" },
                ]}
                onChange={(value) => {
                  setTopologyDisplayMode(value);
                  setFitVersion(String(Date.now()));
                }}
              />
            ) : null}
            <Button
              className={errorsOnly ? "is-active" : undefined}
              type={errorsOnly ? "primary" : "default"}
              icon={<WarningOutlined />}
              aria-pressed={errorsOnly}
              aria-label={errorsOnly ? "关闭仅异常筛选" : "仅显示异常资源"}
              onClick={() => {
                setErrorsOnly((value) => !value);
                resetFocus();
              }}
            >
              仅异常
            </Button>
            <Input
              allowClear
              aria-label="搜索拓扑资源"
              prefix={<SearchOutlined />}
              placeholder="搜索名称、类型或命名空间"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
            />
            {topologyRoot ? (
              <Tooltip
                title={canExpandAll
                  ? "展开当前工作负载的全部关联资源"
                  : `当前关联资源超过 ${GLOBAL_EXPAND_LIMIT} 个，请缩小范围或使用资源卡片逐级查看`}
              >
                <Button
                  icon={effectiveExpandAll ? <CompressOutlined /> : <ExpandOutlined />}
                  aria-pressed={effectiveExpandAll}
                  disabled={!canExpandAll}
                  onClick={() => {
                    setExpandAll((value) => !value);
                    setFocusedGroupId(null);
                    setFitVersion(String(Date.now()));
                  }}
                >
                  {effectiveExpandAll ? "收起" : "展开"}
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip title="刷新">
              <OpsIconActionButton aria-label="刷新拓扑" size="small" loading={graphQuery.isFetching || clusterQuery.isFetching} onClick={refresh}>
                <ReloadOutlined />
              </OpsIconActionButton>
            </Tooltip>
          </div>
        </div>

        <div className="resource-map-toolbar__secondary">
          <TopologySourceFilter
            items={SOURCE_KEYS.map((source) => ({
              id: source,
              label: SOURCE_META[source].label,
              icon: SOURCE_META[source].icon,
              count: sourceCounts[source],
              warningCount: sourceWarningCounts[source],
              color: SOURCE_META[source].lightColor,
              darkColor: SOURCE_META[source].darkColor,
            }))}
            selected={selectedSources}
            onToggle={toggleSource}
          />
          <div className="resource-map-toolbar__grouping">
            <span className="resource-map-toolbar__section-label">分组</span>
            <Segmented<Exclude<KubejojoGroupBy, "namespace">>
              aria-label="拓扑分组"
              value={groupBy}
              options={GROUP_OPTIONS}
              onChange={(value) => {
                setGroupBy(value);
                resetFocus();
              }}
            />
          </div>
        </div>
      </div>

      {graphQuery.data && graphQuery.data.freshness.status !== "fresh" ? (
        <Alert
          className="resource-map-status-alert"
          type={graphQuery.data.freshness.status === "unavailable" ? "error" : "warning"}
          showIcon
          title={graphQuery.data.freshness.status === "unavailable" ? "拓扑快照不可用" : "正在显示历史快照"}
          description={freshnessMessage(graphQuery.data)}
          action={<Button size="small" onClick={refresh}>重新获取</Button>}
        />
      ) : null}
      {incompleteSources.length ? (
        <Alert
          className="resource-map-status-alert"
          type="warning"
          showIcon
          title="拓扑覆盖不完整"
          description={`${incompleteSources.map((source) => SOURCE_META[source].label).join("、")}存在采集缺失或仅部分完成。`}
        />
      ) : null}
      {graphQuery.data && graphQuery.data.coverage.warningRecords > 0 ? (
        <Alert
          className="resource-map-status-alert"
          type="warning"
          showIcon
          title="拓扑中包含活动告警"
          description={`当前快照关联 ${graphQuery.data.coverage.warningRecords} 条活动告警。`}
        />
      ) : null}

      <div className="resource-map-workbench">
        <div className="resource-map-canvas">
          {loading ? (
            <div className="resource-map-canvas-state">
              <OpsLoadingState title="正在加载拓扑" description="正在读取资源库存快照。" />
            </div>
          ) : error ? (
            <div className="resource-map-canvas-state">
              <OpsErrorState
                title="拓扑数据加载失败"
                description={error instanceof Error ? error.message : "拓扑服务暂不可用。"}
                action={<Button onClick={refresh}>重试</Button>}
              />
            </div>
          ) : noClusters ? (
            <div className="resource-map-canvas-state">
              <OpsEmptyState title="暂无集群" description="连接集群后即可查看资源拓扑。" />
            </div>
          ) : !topologyRoot ? (
            <div className="resource-map-canvas-state topology-root-picker-state">
              <div className="topology-root-picker">
                <div className="topology-root-picker__intro">
                  <DeploymentUnitOutlined aria-hidden="true" />
                  <div>
                    <h3>选择工作负载查看资源拓扑</h3>
                    <p>命名空间仅用于筛选。选择 Deployment、StatefulSet、DaemonSet、Job 或 CronJob 后，展示完整的网络、存储与配置关联链路。</p>
                  </div>
                </div>
                {workloadRoots.length ? (
                  <div className="topology-root-picker__grid" role="list" aria-label="可查看拓扑的工作负载">
                    {workloadRoots.map((resource) => (
                      <button
                        key={resource.id}
                        type="button"
                        className="topology-root-picker__item"
                        onClick={() => openTopologyRoot(resource)}
                      >
                        <span className="topology-root-picker__kind">{KIND_LABEL[normalizeKind(resource.kind)] ?? normalizeKind(resource.kind)}</span>
                        <strong>{resource.name}</strong>
                        <small>{resource.namespace ?? "集群级"} · {resource.summary || "可查看关联拓扑"}</small>
                        <span className="topology-root-picker__action">查看拓扑</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <OpsEmptyState
                    title={rawResourceCount === 0 ? "暂无工作负载" : "没有可用的工作负载根节点"}
                    description={rawResourceCount === 0 ? "当前库存快照中没有可展示的资源。" : "当前筛选范围内没有 Deployment、StatefulSet、DaemonSet、Job 或 CronJob。"}
                    action={filtersActive ? <Button onClick={resetFilters}>清除筛选</Button> : undefined}
                  />
                )}
              </div>
            </div>
          ) : graph.resources.length === 0 ? (
            <div className="resource-map-canvas-state">
              <OpsEmptyState
                title={rawResourceCount === 0 ? "暂无拓扑资源" : "暂无匹配资源"}
                description={rawResourceCount === 0
                  ? "当前库存快照中没有可展示的资源。"
                  : "当前范围没有符合筛选条件的资源。"}
                action={filtersActive ? <Button onClick={resetFilters}>清除筛选</Button> : undefined}
              />
            </div>
          ) : (
            <KubejojoTopologyCanvas
              resources={canvasResources}
              relations={canvasRelations}
              groupBy={groupBy}
              focusedId={focusedGroupId}
              selectedNodeId={topologySelection?.canvasId ?? null}
              expandAll={canvasExpandAll}
              displayMode={topologyDisplayMode}
              onFocus={setFocusedGroupId}
              onSelectResource={selectTopologyResource}
              onOpen={(id) => {
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) navigateToResource(resource);
              }}
              onOpenTopologyRoot={(id) => {
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) openTopologyRoot(resource);
              }}
              topologyRootLabel={topologyRoot.name}
              topologyRootKind={KIND_LABEL[normalizeKind(topologyRoot.kind)] ?? normalizeKind(topologyRoot.kind)}
              onExitTopology={resetFocus}
              fitVersion={fitVersion}
            />
          )}
        </div>
      </div>

      <Drawer
        title={selectedResource ? `${KIND_LABEL[normalizeKind(selectedResource.kind)] ?? normalizeKind(selectedResource.kind)} / ${selectedResource.name}` : "资源详情"}
        placement="right"
        size={440}
        open={Boolean(selectedResource)}
        onClose={() => selectTopologyResource(null)}
        destroyOnClose
        rootClassName="resource-map-detail-drawer"
      >
        {selectedResource ? (
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            {topologySelection?.aggregation ? (
              <Alert
                type="info"
                showIcon
                title="当前选择为聚合节点"
                description={(
                  <div className="topology-aggregation-summary">
                    <span>
                      该节点代表 {topologySelection.aggregation.memberCount} 个资源，以下详情为代表资源
                      <strong>{selectedResource.name}</strong>。
                    </span>
                    <div className="topology-aggregation-summary__kinds" aria-label="聚合成员构成">
                      {Object.entries(topologySelection.aggregation.membersByKind)
                        .sort(([left], [right]) => left.localeCompare(right, "en"))
                        .map(([kind, count]) => <Tag key={kind}>{kind} {count}</Tag>)}
                    </div>
                  </div>
                )}
              />
            ) : null}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="状态">
                <Tag color={resourceStatus(selectedResource) === "critical"
                  ? "error"
                  : resourceStatus(selectedResource) === "warning"
                    ? "warning"
                    : resourceStatus(selectedResource) === "healthy"
                      ? "success"
                      : "default"}>
                  {selectedResource.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="集群">{selectedCluster?.name ?? selectedResource.clusterId}</Descriptions.Item>
              <Descriptions.Item label="命名空间">{selectedResource.namespace ?? "集群级"}</Descriptions.Item>
              <Descriptions.Item label="资源域">{SOURCE_META[selectedResource.source].label}</Descriptions.Item>
              <Descriptions.Item label="数据时间">{formatTimestamp(selectedResource.observedAt)}</Descriptions.Item>
              <Descriptions.Item label="摘要">{selectedResource.summary || "-"}</Descriptions.Item>
            </Descriptions>

            <div className="topology-detail-relations">
              <strong>关联资源</strong>
              {selectedRelations.length ? visibleSelectedRelations.map((relation) => {
                const peerId = relation.source === selectedResource.id ? relation.target : relation.source;
                const peer = resourcesById.get(peerId);
                return (
                  <button
                    key={relation.id}
                    type="button"
                    onClick={() => {
                      if (peer) navigateToResource(peer);
                    }}
                  >
                    <span>{relation.label}</span>
                    <strong>{peer ? `${KIND_LABEL[normalizeKind(peer.kind)] ?? normalizeKind(peer.kind)} / ${peer.name}` : peerId}</strong>
                  </button>
                );
              }) : <span className="topology-detail-relations__empty">暂无关联资源</span>}
              {selectedRelations.length > SELECTED_RELATION_PREVIEW_LIMIT ? (
                <span className="topology-detail-relations__empty">
                  另有 {selectedRelations.length - SELECTED_RELATION_PREVIEW_LIMIT} 条关系，请通过关联图逐级查看。
                </span>
              ) : null}
            </div>

            <Space wrap>
              <Button type="primary" onClick={() => setDetail(detailRequest(selectedResource))}>
                完整详情
              </Button>
              <Button onClick={() => setYaml(yamlTarget(selectedResource))}>YAML</Button>
              {isTopologyRootKind(normalizeKind(selectedResource.kind)) ? (
                <Button onClick={() => openTopologyRoot(selectedResource)}>
                  查看工作负载拓扑
                </Button>
              ) : null}
            </Space>
          </Space>
        ) : null}
      </Drawer>

      <ResourceDetailDrawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        token={token}
        request={detail}
        onNavigateRequest={navigateDetailRequest}
      />
      <ResourceYamlDrawer
        open={Boolean(yaml)}
        onClose={() => setYaml(null)}
        token={token}
        identity={yaml?.identity ?? null}
        dynamicIdentity={yaml?.dynamicIdentity ?? null}
        onUpdated={refresh}
      />
    </section>
  );
}
