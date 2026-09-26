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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Input, Segmented, Select, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth-context";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { NamespaceFilterSelect } from "@/components/namespace-select";
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
  parseTopologyUrlState,
  serializeTopologyUrlState,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
} from "@/modules/topology-kubejojo/engine";
import { normalizeTopologyKind } from "@/modules/topology-kubejojo/kind";
import { getIncompleteTopologySources } from "@/modules/topology-kubejojo/coverage";

const ALL_NAMESPACE = "__all__";
const QUERY_STALE_MS = 30_000;
const GLOBAL_EXPAND_LIMIT = 80;
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

const GROUP_OPTIONS: Array<{ value: KubejojoGroupBy; label: string }> = [
  { value: "namespace", label: "命名空间" },
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialUrlState = useMemo(() => parseTopologyUrlState(searchParams), [searchParams]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState(() => {
    if (initialUrlState.namespace) return initialUrlState.namespace;
    const storedNamespace = readStoredResourceNamespace(workspace?.clusterId ?? "");
    return storedNamespace || ALL_NAMESPACE;
  });
  const [selectedSources, setSelectedSources] = useState<Set<TopologyGraphSource>>(
    () => {
      const sources = SOURCE_KEYS.filter((source) => initialUrlState.domains.includes(source));
      return new Set(sources.length ? sources : SOURCE_KEYS);
    },
  );
  // Namespace is a request scope only; visual grouping is limited to the two
  // dimensions Headlamp exposes for a resource map.
  const [groupBy, setGroupBy] = useState<KubejojoGroupBy>(() => initialUrlState.groupBy);
  const [errorsOnly, setErrorsOnly] = useState(false);
  // A workload opened straight from the URL starts expanded, matching the
  // picker entry. The toolbar toggle owns the state from then on.
  const [expandAll, setExpandAll] = useState(
    () => Boolean(searchParams.get("rootKind") && searchParams.get("rootName")),
  );
  const [queryInput, setQueryInput] = useState(() => initialUrlState.search ?? "");
  const [queryText, setQueryText] = useState(() => initialUrlState.search ?? "");
  const [topologyRootId, setTopologyRootId] = useState<string | null>(null);
  const [useRequestedRoot, setUseRequestedRoot] = useState(true);
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [topologySelection, setTopologySelection] = useState<KubejojoTopologySelection | null>(null);
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [yaml, setYaml] = useState<YamlTarget | null>(null);
  const [fitVersion, setFitVersion] = useState("initial");
  const [topologyDisplayMode, setTopologyDisplayMode] = useState<"core" | "full">("core");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);

  // Keep the map state shareable without disturbing unrelated route state
  // (cluster/root/detail parameters are preserved by copying the current URL).
  useEffect(() => {
    const state = serializeTopologyUrlState({
      namespace: selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace,
      domains: SOURCE_KEYS.filter((source) => selectedSources.has(source)),
      search: queryText.trim() || undefined,
      groupBy,
    });
    const next = new URLSearchParams(searchParams.toString());
    for (const key of ["namespace", "domains", "search", "groupBy"]) next.delete(key);
    const mapped = new URLSearchParams(state);
    mapped.forEach((value, key) => next.set(key, value));
    const current = searchParams.toString();
    if (next.toString() !== current) router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [groupBy, pathname, queryText, router, searchParams, selectedNamespace, selectedSources]);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!sourceMenuRef.current?.contains(event.target as Node)) setSourceMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sourceMenuOpen]);

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
  // The workload picker is searchable, but the graph the operator has already
  // opened must not disappear when the query stops matching its root. Root
  // resolution therefore reads the source-filtered inventory, and the search is
  // applied afterwards, inside the selected workload's own chain.
  const scopeGraph = useMemo(
    () => filterGraph(
      graphQuery.data?.resources ?? [],
      graphQuery.data?.relations ?? [],
      selectedSources,
      "",
      false,
    ),
    [graphQuery.data, selectedSources],
  );
  const requestedTopologyRoot = useMemo(
    () => resolveTopologyRoot(
      scopeGraph.resources,
      requestedRoot.kind,
      requestedRoot.name,
      requestedRoot.namespace,
    ),
    [scopeGraph.resources, requestedRoot.kind, requestedRoot.name, requestedRoot.namespace],
  );
  const topologyRoot = useMemo(
    () => scopeGraph.resources.find((resource) => resource.id === topologyRootId)
      ?? (useRequestedRoot ? requestedTopologyRoot : null),
    [scopeGraph.resources, requestedTopologyRoot, topologyRootId, useRequestedRoot],
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
    return filterGraph(
      scopeGraph.resources,
      scopeGraph.relations,
      selectedSources,
      queryText,
      errorsOnly,
    );
  }, [errorsOnly, queryText, scopeGraph, selectedSources]);
  const canvasResources = useMemo(
    () => graph.resources.map(toCanvasResource),
    [graph.resources],
  );
  const canvasRelations = useMemo(
    () => graph.relations
      // Headlamp's panorama shows the operator-facing access chain. Endpoint
      // address resolution is still available in resource details, but drawing
      // every EndpointSlice -> Pod address edge turns a fan-out into a web.
      .filter((relation) => relation.type !== "RESOLVES")
      .map(toCanvasRelation),
    [graph.relations],
  );
  const selectedResourceId = topologySelection?.resourceId ?? null;
  const selectedResource = useMemo(
    () => graphQuery.data?.resources.find((resource) => resource.id === selectedResourceId) ?? null,
    [graphQuery.data?.resources, selectedResourceId],
  );
  const selectedRelationCount = useMemo(
    () => (graphQuery.data?.relations ?? []).filter(
      (relation) => relation.source === selectedResourceId || relation.target === selectedResourceId,
    ).length,
    [graphQuery.data?.relations, selectedResourceId],
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
      .flatMap((resource) => {
        // Use both the explicit namespace and any namespace-derived fields
        const names: string[] = [];
        if (resource.namespace) names.push(resource.namespace);
        // Some resources carry namespace in their identity
        if (resource.identity?.namespace) names.push(resource.identity.namespace);
        return names;
      })
      .filter((item): item is string => Boolean(item));
    const merged = Array.from(new Set([...fromSummary, ...fromGraph])).sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
    // Always include at least the summary namespaces; if both sources are empty
    // we still show the "all" option via the NamespaceFilterSelect default.
    return merged;
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
  // "Are there resources at all?" must read the unfiltered inventory; using the
  // filtered graph told operators the snapshot was empty whenever a filter
  // matched nothing.
  const rawResourceCount = scopeGraph.resources.length;
  const canExpandAll = graph.resources.length > 0 && graph.resources.length <= GLOBAL_EXPAND_LIMIT;
  const effectiveExpandAll = expandAll && canExpandAll;
  // Opening a workload root starts expanded, but the toolbar toggle owns the
  // state afterwards. Forcing this true while a root was set made the
  // 收起/展开 button relabel itself without changing the graph.
  const canvasExpandAll = effectiveExpandAll;
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

  // Switching the grouping dimension rewrites the whole canvas, but it must not
  // throw away the workload the operator is inspecting. Only the canvas-local
  // focus (opened group, selected node) is dropped.
  const resetCanvasFocus = useCallback(() => {
    setFocusedGroupId(null);
    setTopologySelection(null);
  }, []);

  useEffect(() => {
    if (queryInput === queryText) return;
    const timeout = window.setTimeout(() => {
      setQueryText(queryInput);
      // Narrowing the search rewrites the visible graph, but the operator is
      // still inspecting the same workload. Clearing the root here bounced
      // them back to the picker mid-search.
      resetCanvasFocus();
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [queryInput, queryText, resetCanvasFocus]);

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
    // The selected workload is derived from the source-filtered inventory, so
    // dropping a source the workload does not need keeps the operator in place;
    // removing the workload domain itself falls back to the picker on its own.
    resetCanvasFocus();
  }, [resetCanvasFocus]);

  const resetFilters = useCallback(() => {
    setSelectedSources(new Set(SOURCE_KEYS));
    setErrorsOnly(false);
    setQueryInput("");
    setQueryText("");
    // Clearing filters restores visibility; it should not eject the operator
    // from the workload they were reading.
    resetCanvasFocus();
  }, [resetCanvasFocus]);

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
    ].filter(Boolean).join(" ")}>
      <ResourcePageHeader
        path="/network/topology"
        embedded
        className="resource-map-header"
        title="资源拓扑"
        description="单集群工作负载、网络、存储与配置关系"
        actions={(
          <div className="resource-map-header__stats" aria-label="拓扑摘要">
            <span><strong>{graph.resources.length}</strong> 资源</span>
            <span><strong>{graph.relations.length}</strong> 关系</span>
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
        className="topology-headlamp-toolbar"
        role="toolbar"
        aria-label="拓扑控制栏"
      >
        <NamespaceFilterSelect
          value={selectedNamespace}
          namespaces={namespaceOptions}
          allValue={ALL_NAMESPACE}
          disabled={!effectiveClusterId}
          loading={namespaceQuery.isLoading}
          onChange={selectNamespace}
        />

        <div className="topology-domain-menu" ref={sourceMenuRef}>
          <Button
            size="small"
            className={sourceMenuOpen ? "is-active" : undefined}
            aria-haspopup="menu"
            aria-expanded={sourceMenuOpen}
            onClick={() => setSourceMenuOpen((open) => !open)}
          >
            <BranchesOutlined /> 资源域 <span className="topology-domain-menu__count">{selectedSources.size}/{SOURCE_KEYS.length}</span>
          </Button>
          {sourceMenuOpen ? (
            <div className="topology-domain-menu__popup" role="menu" aria-label="资源域筛选">
              {SOURCE_KEYS.map((source) => {
                const active = selectedSources.has(source);
                return (
                  <button
                    key={source}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={active}
                    className={`topology-domain-menu__item ${active ? "is-active" : ""}`}
                    onClick={() => toggleSource(source)}
                  >
                    <span className="topology-domain-menu__swatch" style={{ background: SOURCE_META[source].lightColor }} />
                    <span>{SOURCE_META[source].label}</span>
                    <small>{sourceCounts[source]} 资源{sourceWarningCounts[source] ? ` · ${sourceWarningCounts[source]} 异常` : ""}</small>
                    <span aria-hidden="true">{active ? "✓" : ""}</span>
                  </button>
                );
              })}
              <div className="topology-domain-menu__footer">
                <button type="button" onClick={() => { setSelectedSources(new Set(SOURCE_KEYS)); resetCanvasFocus(); }}>全选</button>
                <button type="button" onClick={() => { setSelectedSources(new Set([SOURCE_KEYS[0]])); resetCanvasFocus(); }}>仅工作负载</button>
              </div>
            </div>
          ) : null}
        </div>

        <span className="topology-toolbar-label">分组</span>
        <div className="topology-group-chips" role="group" aria-label="分组方式">
          {GROUP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`topology-group-chip ${groupBy === option.value ? "is-active" : ""}`}
              aria-pressed={groupBy === option.value}
              onClick={() => {
                setGroupBy(option.value);
                resetCanvasFocus();
                setFitVersion(String(Date.now()));
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button
          className={errorsOnly ? "is-active" : undefined}
          type={errorsOnly ? "primary" : "default"}
          icon={<WarningOutlined />}
          aria-pressed={errorsOnly}
          size="small"
          onClick={() => {
            setErrorsOnly((value) => !value);
            resetCanvasFocus();
          }}
        >
          仅异常
        </Button>

        <Input
          allowClear
          size="small"
          aria-label="搜索拓扑资源"
          prefix={<SearchOutlined />}
          placeholder="搜索…"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
        />

        <div className="topology-toolbar-actions">
          <Tooltip title={canExpandAll ? "展开全部" : `超过 ${GLOBAL_EXPAND_LIMIT} 个资源`}>
            <Button
              size="small"
              icon={effectiveExpandAll ? <CompressOutlined /> : <ExpandOutlined />}
              disabled={!canExpandAll}
              onClick={() => {
                setExpandAll((value) => !value);
                setFocusedGroupId(null);
                setFitVersion(String(Date.now()));
              }}
            />
          </Tooltip>

          <OpsIconActionButton aria-label="刷新拓扑" size="small" loading={graphQuery.isFetching || clusterQuery.isFetching} onClick={refresh}>
            <ReloadOutlined />
          </OpsIconActionButton>
        </div>
      </div>{graphQuery.data && graphQuery.data.freshness.status !== "fresh" ? (
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

      <div
        className="topology-selection-strip"
        role="status"
        aria-live="polite"
        hidden={!selectedResource}
      >
        {selectedResource ? (
          <>
            <span className="topology-selection-strip__kind">
              {KIND_LABEL[normalizeKind(selectedResource.kind)] ?? normalizeKind(selectedResource.kind)}
            </span>
            <button
              type="button"
              className="topology-selection-strip__name"
              title="在资源管理页中筛选该资源"
              onClick={() => navigateToResource(selectedResource)}
            >
              {selectedResource.name}
            </button>
            <span className="topology-selection-strip__meta">
              {selectedResource.namespace ?? "集群级"} · {selectedResource.status} · {selectedRelationCount} 条关系
            </span>
            <span className="topology-selection-strip__actions">
              <Button size="small" type="primary" onClick={() => setDetail(detailRequest(selectedResource))}>
                详情
              </Button>
              <Button size="small" onClick={() => setYaml(yamlTarget(selectedResource))}>YAML</Button>
              <Button size="small" type="text" onClick={() => selectTopologyResource(null)}>
                关闭
              </Button>
            </span>
          </>
        ) : null}
      </div>

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
              onFocus={setFocusedGroupId}
              onSelectResource={selectTopologyResource}
              onOpen={(id) => {
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) navigateToResource(resource);
              }}
              fitVersion={fitVersion}
            />
          )}
        </div>
      </div>

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
