"use client";

import {
  BranchesOutlined,
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
import { Alert, Button, Input, Tooltip } from "antd";
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
  parseTopologyUrlState,
  serializeTopologyUrlState,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
} from "@/modules/topology-kubejojo/engine";
import { normalizeTopologyKind } from "@/modules/topology-kubejojo/kind";
import { getIncompleteTopologySources } from "@/modules/topology-kubejojo/coverage";

const ALL_NAMESPACE = "__all__";
const QUERY_STALE_MS = 10_000;
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

/**
 * Keep the canvas focused on the operator-facing access path. Endpoint and
 * EndpointSlice address resolution is still part of the API graph (and is
 * available in the detail drawer), but drawing every Pod address edge makes a
 * panorama cross the whole canvas. When the API omits the direct Service
 * selector because an EndpointSlice is present, project that selector back into
 * the panorama so the visible chain remains Service -> Pod.
 */
function toPanoramaRelations(relations: TopologyGraphRelation[]): KubejojoRelation[] {
  const publishes = relations.filter((relation) => relation.type === "PUBLISHES");
  const visible = relations.filter((relation) => relation.type !== "RESOLVES");
  const existingSelectors = new Set(
    visible
      .filter((relation) => relation.type === "SELECTS")
      .flatMap((relation) => [
        relation.source + "->" + relation.target,
        relation.target + "->" + relation.source,
      ]),
  );
  const synthesized: TopologyGraphRelation[] = [];

  relations
    .filter((relation) => relation.type === "RESOLVES")
    .forEach((resolution) => {
      publishes
        .filter((publish) => publish.target === resolution.source || publish.source === resolution.source)
        .forEach((publish) => {
          // API adapters normally emit Service -> EndpointSlice/Endpoints, but
          // older adapters may reverse the same relation. Resolve the service
          // endpoint from whichever side touches the resolution source so the
          // canvas projection remains stable across both payloads.
          const serviceId = publish.target === resolution.source ? publish.source : publish.target;
          const pair = serviceId + "->" + resolution.target;
          if (existingSelectors.has(pair) || existingSelectors.has(resolution.target + "->" + serviceId)) return;
          existingSelectors.add(pair);
          synthesized.push({
            ...resolution,
            id: "panorama:selects:" + pair,
            source: serviceId,
            target: resolution.target,
            label: "选择",
            type: "SELECTS",
            role: "network",
            direction: publish.direction,
            evidence: [...publish.evidence, ...resolution.evidence],
            evidenceDetails: [...publish.evidenceDetails, ...resolution.evidenceDetails],
            ports: [...publish.ports, ...resolution.ports],
            portDetails: [...publish.portDetails, ...resolution.portDetails],
            confidence: Math.min(publish.confidence, resolution.confidence),
          });
        });
    });

  return [...visible, ...synthesized].map(toCanvasRelation);
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

export default function NetworkTopologyPage() {
  const { accessToken: token } = useAuth();
  const workspace = useOptionalClusterWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialUrlState = useMemo(() => parseTopologyUrlState(searchParams), [searchParams]);
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
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [topologySelection, setTopologySelection] = useState<KubejojoTopologySelection | null>(null);
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [yaml, setYaml] = useState<YamlTarget | null>(null);
  const [fitVersion, setFitVersion] = useState("initial");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [realtimeDisconnected, setRealtimeDisconnected] = useState(false);
  const sourceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleRealtimeState = (event: Event) => {
      const state = (event as CustomEvent<{ state?: string }>).detail?.state;
      if (state === "connected") setRealtimeDisconnected(false);
      if (state === "disconnected") setRealtimeDisconnected(true);
    };
    window.addEventListener("kubenova:realtime-state", handleRealtimeState);
    return () => window.removeEventListener("kubenova:realtime-state", handleRealtimeState);
  }, []);

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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const clusters = clusterQuery.data?.items ?? [];
  const selectedCluster = workspace
    ? clusters.find((cluster) => cluster.id === workspace.clusterId) ?? null
    : clusters[0] ?? null;
  const effectiveClusterId = resolveWorkspaceClusterId(workspace?.clusterId, selectedCluster?.id ?? "");

  const namespaceQuery = useQuery({
    queryKey: ["topology-v2", "namespaces", effectiveClusterId, token],
    queryFn: ({ signal }) =>
      getTopologyNamespaceSummaries({ clusterId: effectiveClusterId }, token, { signal }),
    enabled: Boolean(token && effectiveClusterId),
    staleTime: QUERY_STALE_MS,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: () => typeof document !== "undefined" && !document.hidden ? 15_000 : false,
    refetchIntervalInBackground: false,
  });

  // Search is applied after source filtering so the graph keeps only complete,
  // valid relationship endpoints for the currently enabled resource domains.
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
    () => toPanoramaRelations(graph.relations),
    [graph.relations],
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
  // A refresh can briefly leave a sibling query in its initial state. Once a
  // graph is available, keep it mounted while those queries reconcile rather
  // than replacing the canvas with a page-level loading screen.
  const loading = !graphQuery.data && (
    clusterQuery.isLoading
    || graphQuery.isLoading
    || namespaceQuery.isLoading
  );
  // React Query keeps the last successful payload while a background refresh
  // fails. Do not replace that usable graph with a page-level error state; a
  // transient SSE/API hiccup should only make the canvas read-only until the
  // next automatic refresh succeeds.
  const error = !graphQuery.data
    ? (clusterQuery.error ?? namespaceQuery.error ?? graphQuery.error)
    : null;
  const refreshError = graphQuery.data ? graphQuery.error : null;
  const topologyReadOnly = realtimeDisconnected || Boolean(refreshError) || graphQuery.data?.freshness.status === "stale";
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
    setFocusedGroupId(null);
    setTopologySelection(null);
    setExpandAll(false);
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
    void Promise.all([
      clusterQuery.refetch(),
      namespaceQuery.refetch(),
      graphQuery.refetch(),
    ]);
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

  const openResourceDetail = useCallback((resource: TopologyGraphResource) => {
    setDetail(detailRequest(resource));
  }, []);

  const navigateDetailRequest = useCallback((request: DetailRequest) => {
    const kind = normalizeKind(request.kind === "dynamic" ? request.kindLabel ?? request.kind : request.kind);
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

          <OpsIconActionButton aria-label="刷新拓扑" size="small" loading={graphQuery.isFetching || clusterQuery.isFetching || namespaceQuery.isFetching} onClick={refresh}>
            <ReloadOutlined />
          </OpsIconActionButton>
        </div>
      </div>{realtimeDisconnected ? (
        <Alert
          className="resource-map-status-alert"
          type="warning"
          showIcon
          title="实时连接中断"
          description="当前保留的拓扑仅供查看，连接恢复后会自动同步。"
        />
      ) : null}
      {refreshError ? (
        <Alert
          className="resource-map-status-alert"
          type="warning"
          showIcon
          title="拓扑后台刷新暂时失败"
          description="当前画布继续显示最近可用数据，系统会在后台自动重试。"
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
          description={`当前拓扑关联 ${graphQuery.data.coverage.warningRecords} 条活动告警。`}
        />
      ) : null}

      <div className="resource-map-workbench">
        <div className="resource-map-canvas">
          {loading ? (
            <div className="resource-map-canvas-state">
              <OpsLoadingState title="正在加载拓扑" description="正在读取集群资源。" />
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
                  ? "当前集群没有可展示的资源。"
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
              onCollapseAllStacks={() => setExpandAll(false)}
              onSelectResource={selectTopologyResource}
              onOpen={(id) => {
                if (topologyReadOnly) return;
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) openResourceDetail(resource);
              }}
              onNavigate={(id) => {
                if (topologyReadOnly) return;
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) navigateDetailRequest(detailRequest(resource));
              }}
              fitVersion={fitVersion}
            />
          )}
        </div>
      </div>

      <ResourceDetailDrawer
        open={Boolean(detail) && !topologyReadOnly}
        onClose={() => setDetail(null)}
        token={token}
        request={detail}
        onNavigateRequest={navigateDetailRequest}
      />
      <ResourceYamlDrawer
        open={Boolean(yaml) && !topologyReadOnly}
        onClose={() => setYaml(null)}
        token={token}
        identity={yaml?.identity ?? null}
        dynamicIdentity={yaml?.dynamicIdentity ?? null}
        onUpdated={refresh}
      />
    </section>
  );
}
