"use client";

import {
  AimOutlined,
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
import { useRouter } from "next/navigation";
import { Alert, Button, Descriptions, Drawer, Input, Segmented, Select, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { useAuth } from "@/components/auth-context";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
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
import { emitResourceScopeChange } from "@/lib/resource-scope-events";
import { resolveWorkspaceClusterId, resolveWorkspaceResourceHref } from "@/lib/cluster-workspace";
import { buildResourceRefDetailRequest } from "@/lib/resource-navigation";
import {
  KubejojoTopologyCanvas,
  type KubejojoTopologySelection,
} from "@/modules/topology-kubejojo/TopologyCanvas";
import {
  projectTopologyNeighborhood,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
} from "@/modules/topology-kubejojo/engine";
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

const GROUP_LABEL: Record<KubejojoGroupBy, string> = {
  namespace: "名称空间",
  instance: "实例",
  node: "节点",
};

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
  PersistentVolume: "PV",
  PersistentVolumeClaim: "PVC",
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

function normalizeKind(kind: string): string {
  if (kind === "PV") return "PersistentVolume";
  if (kind === "PVC") return "PersistentVolumeClaim";
  if (kind === "SC") return "StorageClass";
  return kind;
}

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
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACE);
  const [selectedSources, setSelectedSources] = useState<Set<TopologyGraphSource>>(
    () => new Set(SOURCE_KEYS),
  );
  const [groupBy, setGroupBy] = useState<KubejojoGroupBy>("namespace");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [queryText, setQueryText] = useState("");
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [neighborhoodResourceId, setNeighborhoodResourceId] = useState<string | null>(null);
  const [topologySelection, setTopologySelection] = useState<KubejojoTopologySelection | null>(null);
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const [yaml, setYaml] = useState<YamlTarget | null>(null);
  const [fitVersion, setFitVersion] = useState("initial");
  const [linkMode, setLinkMode] = useState(false);

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
  const graph = useMemo<FilteredGraph>(() => {
    if (!neighborhoodResourceId) return filteredGraph;
    const neighborhood = projectTopologyNeighborhood(
      filteredGraph.resources,
      filteredGraph.relations,
      neighborhoodResourceId,
      1,
    );
    return { resources: neighborhood.resources, relations: neighborhood.relations };
  }, [filteredGraph, neighborhoodResourceId]);
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
  const loading = clusterQuery.isLoading || graphQuery.isLoading;
  const error = clusterQuery.error ?? graphQuery.error;
  const noClusters = !clusterQuery.isLoading && !clusterQuery.error && clusters.length === 0;
  const rawResourceCount = graphQuery.data?.resources.length ?? 0;
  const canExpandAll = filteredGraph.resources.length <= GLOBAL_EXPAND_LIMIT;
  const effectiveExpandAll = expandAll && canExpandAll;
  const canvasExpandAll = effectiveExpandAll || Boolean(neighborhoodResourceId);
  const filtersActive = Boolean(
    queryInput.trim() || errorsOnly || selectedSources.size < SOURCE_KEYS.length,
  );

  const resetFocus = useCallback(() => {
    setFocusedGroupId(null);
    setTopologySelection(null);
    setNeighborhoodResourceId(null);
    setExpandAll(false);
  }, []);

  const selectTopologyResource = useCallback((selection: KubejojoTopologySelection | null) => {
    setTopologySelection(selection);
    if (!selection) setNeighborhoodResourceId(null);
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
    setSelectedClusterId(clusterId);
    setSelectedNamespace(ALL_NAMESPACE);
    resetFocus();
    emitResourceScopeChange({ clusterId });
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
    <section className="resource-map-shell resource-map-shell--workbench">
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

      <div className="resource-map-toolbar" aria-label="拓扑控制栏">
        <div className="resource-map-toolbar__scope">
          {!workspace ? (
            <div className="resource-map-context-field">
              <span className="resource-map-context-field__label">集群</span>
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
          <div className="resource-map-context-field">
            <span className="resource-map-context-field__label">范围</span>
            <Select
              aria-label="选择名称空间"
              value={selectedNamespace}
              disabled={!effectiveClusterId}
              options={[
                { value: ALL_NAMESPACE, label: "全部名称空间" },
                ...namespaceOptions.map((namespace) => ({ value: namespace, label: namespace })),
              ]}
              onChange={selectNamespace}
            />
          </div>
        </div>

        <div className="resource-map-toolbar__filters">
          <div className="resource-map-source-chips" role="group" aria-label="资源域">
            {SOURCE_KEYS.map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={selectedSources.has(source)}
                className={selectedSources.has(source) ? "is-active" : ""}
                style={{
                  "--source-color-light": SOURCE_META[source].lightColor,
                  "--source-color-dark": SOURCE_META[source].darkColor,
                  "--source-color": SOURCE_META[source].lightColor,
                } as CSSProperties}
                onClick={() => toggleSource(source)}
              >
                <span className="resource-map-source-chip__icon">{SOURCE_META[source].icon}</span>
                <span className="resource-map-source-chip__copy"><span>{SOURCE_META[source].label}</span><small>{selectedSources.has(source) ? "已显示" : "已隐藏"}</small></span>
                <span className="resource-map-source-chip__metrics">
                  <strong className="resource-map-source-chip__count">{sourceCounts[source]}</strong>
                  <small>{(graphQuery.data?.resources ?? []).filter((resource) => resource.source === source && resourceStatus(resource) !== "healthy").length} 异常</small>
                </span>
              </button>
            ))}
          </div>
          <Segmented<KubejojoGroupBy>
            aria-label="拓扑分组"
            value={groupBy}
            options={(Object.keys(GROUP_LABEL) as KubejojoGroupBy[]).map((value) => ({
              value,
              label: GROUP_LABEL[value],
            }))}
            onChange={(value) => {
              setGroupBy(value);
              resetFocus();
            }}
          />
        </div>

        <div className="resource-map-toolbar__actions">
          <span className="resource-map-toolbar__hint">视图模式</span>
          <Button
            className={linkMode ? "is-active topology-link-mode" : "topology-link-mode"}
            icon={<BranchesOutlined />}
            aria-pressed={linkMode}
            onClick={() => {
              setLinkMode((value) => !value);
              setExpandAll(true);
              setNeighborhoodResourceId(null);
              setFitVersion(String(Date.now()));
            }}
          >
            {linkMode ? "链路中" : "完整链路"}
          </Button>
          <Button
            type={errorsOnly ? "primary" : "default"}
            icon={<WarningOutlined />}
            aria-pressed={errorsOnly}
            onClick={() => {
              setErrorsOnly((value) => !value);
              resetFocus();
            }}
          >
            异常
          </Button>
          <Input
            allowClear
            aria-label="搜索拓扑资源"
            prefix={<SearchOutlined />}
            placeholder="搜索名称、类型或名称空间"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <Tooltip
            title={canExpandAll
              ? "展开当前范围的全部资源"
              : `当前范围超过 ${GLOBAL_EXPAND_LIMIT} 个资源，请逐级进入名称空间和组件`}
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
          <Tooltip title="刷新">
            <OpsIconActionButton aria-label="刷新拓扑" size="small" onClick={refresh}>
              <ReloadOutlined />
            </OpsIconActionButton>
          </Tooltip>
          <Tooltip title="适配视图">
            <OpsIconActionButton
              aria-label="适配拓扑视图"
              size="small"
              onClick={() => setFitVersion(String(Date.now()))}
            >
              <AimOutlined />
            </OpsIconActionButton>
          </Tooltip>
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
              includeOverlays={Boolean(neighborhoodResourceId)}
              onFocus={setFocusedGroupId}
              onSelectResource={selectTopologyResource}
              onOpen={(id) => {
                const resource = graphQuery.data?.resources.find((item) => item.id === id);
                if (resource) setDetail(detailRequest(resource));
              }}
              fitVersion={fitVersion}
            />
          )}
        </div>
      </div>

      <Drawer
        title={selectedResource ? `${KIND_LABEL[normalizeKind(selectedResource.kind)] ?? normalizeKind(selectedResource.kind)} / ${selectedResource.name}` : "资源详情"}
        placement="right"
        width={440}
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
              <Descriptions.Item label="名称空间">{selectedResource.namespace ?? "集群级"}</Descriptions.Item>
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
              <Button
                onClick={() => {
                  setNeighborhoodResourceId((current) => current ? null : selectedResource.id);
                  setExpandAll(false);
                  setFocusedGroupId(null);
                  setFitVersion(String(Date.now()));
                }}
              >
                {neighborhoodResourceId ? "退出关联图" : "展开关联图"}
              </Button>
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
