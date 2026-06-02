"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Tag, Typography, message } from "antd";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import { ResourceRowActions } from "@/components/resource-row-actions";
import type { ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getNamespaces } from "@/lib/api/namespaces";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import {
  createDynamicResource,
  deleteDynamicResource,
  getDynamicResourceDetail,
  getResourceDiscoveryCatalog,
  getDynamicResources,
  refreshResourceDiscovery,
  updateDynamicResourceYaml,
  type DiscoveryCatalogItem,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
} from "@/lib/api/resources";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import type { ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type GatewayKindKey = string;
type DetailTarget = NonNullable<ResourceDetailDrawerProps["request"]>;

function readGatewayKindFromSearchParams(searchParams: ReturnType<typeof useSearchParams>): GatewayKindKey {
  const value = searchParams.get("kind")?.trim().toLowerCase();
  return value || "gatewayclass";
}

const GATEWAY_KIND_META: Record<
  GatewayKindKey,
  { title: string; resource: string; version: string; namespaced: boolean; description: string }
> = {
  gatewayclass: {
    title: "GatewayClass",
    resource: "gatewayclasses",
    version: "v1",
    namespaced: false,
    description: "管理 GatewayClass 实现类",
  },
  gateway: {
    title: "Gateway",
    resource: "gateways",
    version: "v1",
    namespaced: true,
    description: "管理 Gateway 监听与入口",
  },
  httproute: {
    title: "HTTPRoute",
    resource: "httproutes",
    version: "v1",
    namespaced: true,
    description: "管理 HTTP 路由规则",
  },
  grpcroute: {
    title: "GRPCRoute",
    resource: "grpcroutes",
    version: "v1",
    namespaced: true,
    description: "管理 gRPC 路由规则",
  },
  tcproute: {
    title: "TCPRoute",
    resource: "tcproutes",
    version: "v1alpha2",
    namespaced: true,
    description: "管理 TCP 路由规则",
  },
  tlsroute: {
    title: "TLSRoute",
    resource: "tlsroutes",
    version: "v1alpha2",
    namespaced: true,
    description: "管理 TLS 路由规则",
  },
  udproute: {
    title: "UDPRoute",
    resource: "udproutes",
    version: "v1alpha2",
    namespaced: true,
    description: "管理 UDP 路由规则",
  },
  referencegrant: {
    title: "ReferenceGrant",
    resource: "referencegrants",
    version: "v1beta1",
    namespaced: true,
    description: "管理跨名称空间引用授权",
  },
  backendtlspolicy: {
    title: "BackendTLSPolicy",
    resource: "backendtlspolicies",
    version: "v1alpha3",
    namespaced: true,
    description: "管理后端 TLS 策略",
  },
};

const STRUCTURED_GATEWAY_KINDS = new Set(["gatewayclass", "gateway", "httproute"]);

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function normalizeGatewayKindKey(kind: string) {
  return kind.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function isStructuredGatewayKind(kind: GatewayKindKey) {
  return STRUCTURED_GATEWAY_KINDS.has(normalizeGatewayKindKey(kind));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback?: number) {
  return typeof value === "number" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildGatewayKindMetaFromDiscovery(item: DiscoveryCatalogItem) {
  const key = normalizeGatewayKindKey(item.kind);
  return {
    key,
    meta: {
      title: item.kind,
      resource: item.resource,
      version: item.version,
      namespaced: item.namespaced,
      description: `管理 ${item.kind} 资源`,
    },
  };
}

function buildGatewayDynamicIdentity(kindMeta: (typeof GATEWAY_KIND_META)[GatewayKindKey], row: GatewayRow): DynamicResourceIdentity {
  return {
    clusterId: row.clusterId,
    group: "gateway.networking.k8s.io",
    version: kindMeta.version,
    resource: kindMeta.resource,
    namespace: row.namespace || undefined,
    name: row.name,
  };
}

function buildGatewayDynamicDetailTarget(kindMeta: (typeof GATEWAY_KIND_META)[GatewayKindKey], row: GatewayRow): DetailTarget {
  const identity = buildGatewayDynamicIdentity(kindMeta, row);
  return {
    kind: "dynamic",
    id: [
      "dynamic",
      identity.clusterId,
      identity.group,
      identity.version,
      identity.resource,
      identity.namespace ?? "",
      identity.name,
    ].join(":"),
    kindLabel: kindMeta.title,
    apiVersion: row.apiVersion,
    namespace: row.namespace,
    name: row.name,
    label: row.name,
    snapshot: { labels: row.labels },
  };
}

type GatewayRow = DynamicResourceItem;

interface GatewayFormValues {
  name: string;
  namespace: string;
  gatewayClassName: string;
  controllerName?: string;
  parametersGroup?: string;
  parametersKind?: string;
  parametersName?: string;
  addressType?: string;
  addresses?: string;
  listenerName?: string;
  listenerPort?: number;
  listenerProtocol?: string;
  listenerHostname?: string;
  allowedRoutesFrom?: "All" | "Same" | "Selector" | "None";
  allowedRoutesNamespaces?: string;
}

interface HttpRouteFormValues {
  name: string;
  namespace: string;
  parentGatewayName: string;
  hostnames?: string;
  matchPath?: string;
  pathType?: string;
  backendServiceName?: string;
  backendServicePort?: number;
  backendWeight?: number;
  headerName?: string;
  headerValue?: string;
}

export default function GatewayApiPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const lastDiscoveryRefreshAtRef = useRef<Record<string, number>>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [kind, setKind] = useState<GatewayKindKey>(() => readGatewayKindFromSearchParams(searchParams));
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [dynamicYamlTarget, setDynamicYamlTarget] = useState<DynamicResourceIdentity | null>(null);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<GatewayRow | null>(null);
  const [editingSpec, setEditingSpec] = useState<Record<string, unknown>>({});
  const [createForm] = Form.useForm<GatewayFormValues & HttpRouteFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<GatewayRow>({
    defaultPageSize: 10,
  });

  const baseKindMeta = GATEWAY_KIND_META[normalizeGatewayKindKey(kind)] ?? GATEWAY_KIND_META.gatewayclass;
  const canCreate = Boolean(clusterId) && isStructuredGatewayKind(kind);

  const clustersQuery = useQuery({
    queryKey: ["gateway-api", "clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const namespacesQuery = useQuery({
    queryKey: ["gateway-api", "namespaces", clusterId || "all", accessToken],
    queryFn: () => getNamespaces({ clusterId: clusterId || undefined, page: 1, pageSize: 500 }, accessToken ?? undefined),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });

  const discoveryQuery = useQuery({
    queryKey: ["gateway-api", "discovery", clusterId || "none", accessToken],
    queryFn: () => getResourceDiscoveryCatalog(clusterId!, accessToken ?? undefined),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });

  const gatewayKindMap = useMemo(() => {
    const next = new Map<string, (typeof GATEWAY_KIND_META)[GatewayKindKey]>();
    for (const [key, meta] of Object.entries(GATEWAY_KIND_META)) {
      next.set(key, meta);
    }
    for (const item of discoveryQuery.data?.items ?? []) {
      if (item.group !== "gateway.networking.k8s.io") continue;
      const discovered = buildGatewayKindMetaFromDiscovery(item);
      next.set(discovered.key, discovered.meta);
    }
    return next;
  }, [discoveryQuery.data?.items]);

  const gatewayKindOptions = useMemo(
    () =>
      Array.from(gatewayKindMap.entries())
        .map(([value, meta]) => ({
          label: `${meta.title} (${meta.version})`,
          value,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [gatewayKindMap],
  );
  const kindMeta = gatewayKindMap.get(normalizeGatewayKindKey(kind)) ?? baseKindMeta;

  const listQuery = useQuery({
    queryKey: [
      "gateway-api",
      kind,
      kindMeta.version,
      kindMeta.resource,
      clusterId || "all",
      namespace,
      keyword,
      pagination.pageIndex + 1,
      pagination.pageSize,
      sortBy,
      sortOrder,
      accessToken,
    ],
    queryFn: () =>
      getDynamicResources(
        {
          clusterId: clusterId || undefined,
          group: "gateway.networking.k8s.io",
          version: kindMeta.version,
          resource: kindMeta.resource,
          namespace: kindMeta.namespaced ? namespace || undefined : undefined,
          keyword: keyword || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
          missingAsEmpty: true,
        },
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const refreshDiscoveryMutation = useMutation({
    mutationFn: () => {
      if (!clusterId) {
        throw new Error("请先选择集群后再刷新资源发现");
      }
      return refreshResourceDiscovery(clusterId, accessToken ?? undefined);
    },
    onSuccess: async () => {
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "刷新资源发现失败");
    },
  });

  useEffect(() => {
    if (!accessToken || !clusterId || refreshDiscoveryMutation.isPending) {
      return;
    }

    const now = Date.now();
    const lastTriggeredAt = lastDiscoveryRefreshAtRef.current[clusterId] ?? 0;
    if (now - lastTriggeredAt < 5 * 60 * 1000) {
      return;
    }

    lastDiscoveryRefreshAtRef.current[clusterId] = now;
    refreshDiscoveryMutation.mutate();
  }, [accessToken, clusterId, refreshDiscoveryMutation]);

  const openYamlMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => getDynamicResourceDetail(identity, accessToken ?? undefined),
    onSuccess: (detail, identity) => {
      setYamlTarget({
        clusterId: identity.clusterId,
        namespace: identity.namespace ?? "",
        kind: identity.resource,
        name: identity.name,
      });
      setDynamicYamlTarget(identity);
      setYamlOpen(true);
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "读取 YAML 失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => deleteDynamicResource(identity, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success("资源已删除");
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      clusterId: string;
      group: string;
      version: string;
      resource: string;
      namespace: string;
      name: string;
      body: Record<string, unknown>;
    }) => createDynamicResource(payload, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success(`${kindMeta.title} 创建成功`);
      setCreateOpen(false);
      createForm.resetFields();
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "创建失败，请重试");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ row, body }: { row: GatewayRow; body: Record<string, unknown> }) =>
      updateDynamicResourceYaml(
        {
          ...buildGatewayDynamicIdentity(kindMeta, row),
          yaml: JSON.stringify(body, null, 2),
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      void message.success(`${kindMeta.title} 更新成功`);
      setCreateOpen(false);
      setEditingRow(null);
      setEditingSpec({});
      createForm.resetFields();
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "更新失败，请重试");
    },
  });

  const openStructuredEditMutation = useMutation({
    mutationFn: (row: GatewayRow) => getDynamicResourceDetail(buildGatewayDynamicIdentity(kindMeta, row), accessToken ?? undefined),
    onSuccess: (detail, row) => {
      const raw = asRecord(detail.raw);
      const spec = asRecord(raw.spec);
      setEditingRow(row);
      setEditingSpec(spec);
      createForm.resetFields();
      if (normalizeGatewayKindKey(kind) === "gatewayclass") {
        const parametersRef = asRecord(spec.parametersRef);
        createForm.setFieldsValue({
          name: row.name,
          namespace: row.namespace,
          controllerName: asString(spec.controllerName),
          parametersGroup: asString(parametersRef.group),
          parametersKind: asString(parametersRef.kind),
          parametersName: asString(parametersRef.name),
        });
      } else if (normalizeGatewayKindKey(kind) === "gateway") {
        const address = asRecordArray(spec.addresses)[0] ?? {};
        const listener = asRecordArray(spec.listeners)[0] ?? {};
        const allowedRoutes = asRecord(listener.allowedRoutes);
        const allowedNamespaces = asRecord(allowedRoutes.namespaces);
        const selector = asRecord(allowedNamespaces.selector);
        const firstExpression = asRecordArray(selector.matchExpressions)[0] ?? {};
        createForm.setFieldsValue({
          name: row.name,
          namespace: row.namespace,
          gatewayClassName: asString(spec.gatewayClassName),
          addressType: asString(address.type),
          addresses: asString(address.value),
          listenerName: asString(listener.name) || "http",
          listenerPort: asNumber(listener.port, 80),
          listenerProtocol: asString(listener.protocol) || "HTTP",
          listenerHostname: asString(listener.hostname),
          allowedRoutesFrom: (asString(allowedNamespaces.from) as GatewayFormValues["allowedRoutesFrom"]) || "Selector",
          allowedRoutesNamespaces: asStringArray(firstExpression.values).join(" "),
        });
      } else {
        const parentRef = asRecordArray(spec.parentRefs)[0] ?? {};
        const rule = asRecordArray(spec.rules)[0] ?? {};
        const match = asRecordArray(rule.matches)[0] ?? {};
        const path = asRecord(match.path);
        const backend = asRecordArray(rule.backendRefs)[0] ?? {};
        const headerFilter = asRecordArray(rule.filters).find((filter) => asString(filter.type) === "RequestHeaderModifier");
        const headerAdd = asRecordArray(asRecord(asRecord(headerFilter).requestHeaderModifier).add)[0] ?? {};
        createForm.setFieldsValue({
          name: row.name,
          namespace: row.namespace,
          parentGatewayName: asString(parentRef.name),
          hostnames: asStringArray(spec.hostnames).join(" "),
          matchPath: asString(path.value) || "/",
          pathType: asString(path.type) || "PathPrefix",
          backendServiceName: asString(backend.name),
          backendServicePort: asNumber(backend.port, 80),
          backendWeight: asNumber(backend.weight),
          headerName: asString(headerAdd.name),
          headerValue: asString(headerAdd.value),
        });
      }
      setCreateOpen(true);
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "读取资源详情失败");
    },
  });

  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set([
          ...(namespacesQuery.data?.items ?? []).map((item) => item.namespace),
          ...rows.map((item) => item.namespace),
        ].filter(Boolean)),
      ).sort(),
    [namespacesQuery.data?.items, rows],
  );
  const tableData = useMemo(
    () =>
      rows.filter(
        (item) =>
          (mergedFilters.length === 0
            ? true
            : mergedFilters.every((filter) =>
                Object.entries(item.labels ?? {}).some(([key, value]) =>
                  `${key}=${value}`.toLowerCase().includes(filter.toLowerCase()),
                ),
              )) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.namespace || "-", getTextFilter(tableFilters, "namespace")) &&
          textMatches(
            Object.entries(item.labels ?? {}).map(([key, value]) => `${key}=${value}`).join(" "),
            getTextFilter(tableFilters, "labels"),
          ),
      ),
    [clusterMap, mergedFilters, rows, tableFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleSearch = () => {
    const parsed = keywordInput
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    resetPage();
    setMergedFilters(parsed);
    setKeyword(parsed.filter((item) => !item.includes("=")).join(" "));
  };
  const handleGlobalSearchChange = (value: string) => {
    const parsed = value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed);
    setKeyword(parsed.filter((item) => !item.includes("=")).join(" "));
  };
  const urlExtraParams = useMemo(() => ({ kind }), [kind]);
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/network/gateway-api",
    extraParams: urlExtraParams,
  });
  const selectedGatewayKind = normalizeGatewayKindKey(kind);

  const handleOpenCreate = () => {
    if (!clusterId) {
      void message.error("请先选择集群后再新增资源");
      return;
    }
    if (!isStructuredGatewayKind(kind)) {
      void message.info(`${kindMeta.title} 请使用 YAML 创建或编辑`);
      return;
    }
    setEditingRow(null);
    setEditingSpec({});
    createForm.resetFields();
    setCreateOpen(true);
  };

  const handleOpenEdit = (row: GatewayRow) => {
    if (!isStructuredGatewayKind(kind)) {
      void message.info(`${kindMeta.title} 请使用 YAML 编辑`);
      openYamlMutation.mutate(buildGatewayDynamicIdentity(kindMeta, row));
      return;
    }
    openStructuredEditMutation.mutate(row);
  };

  const handleCreateSubmit = async () => {
    let values: GatewayFormValues & HttpRouteFormValues;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }

    const normalizedKind = normalizeGatewayKindKey(kind);

    if (editingRow) {
      if (normalizedKind === "gatewayclass") {
        const nextSpec: Record<string, unknown> = {
          ...editingSpec,
          controllerName: values.controllerName || values.gatewayClassName,
        };
        if (values.parametersGroup && values.parametersKind && values.parametersName) {
          nextSpec.parametersRef = {
            group: values.parametersGroup,
            kind: values.parametersKind,
            name: values.parametersName,
          };
        } else {
          delete nextSpec.parametersRef;
        }
        updateMutation.mutate({
          row: editingRow,
          body: {
            apiVersion: `gateway.networking.k8s.io/${kindMeta.version}`,
            kind: kindMeta.title,
            metadata: {
              name: editingRow.name,
              ...(editingRow.labels ? { labels: editingRow.labels } : {}),
            },
            spec: nextSpec,
          },
        });
        return;
      }

      if (normalizedKind === "gateway") {
        const addressValue = values.addresses?.trim();
        const nextSpec: Record<string, unknown> = {
          ...editingSpec,
          gatewayClassName: values.gatewayClassName,
        };
        if (values.addressType && addressValue) {
          nextSpec.addresses = [{ type: values.addressType, value: addressValue }];
        } else {
          delete nextSpec.addresses;
        }
        const listeners = asRecordArray(editingSpec.listeners);
        const firstListener: Record<string, unknown> = { ...(listeners[0] ?? {}) };
        firstListener.name = values.listenerName || "http";
        firstListener.port = values.listenerPort || 80;
        firstListener.protocol = values.listenerProtocol || "HTTP";
        if (values.listenerHostname?.trim()) {
          firstListener.hostname = values.listenerHostname.trim();
        } else {
          delete firstListener.hostname;
        }
        if (values.allowedRoutesNamespaces?.trim()) {
          firstListener.allowedRoutes = {
            namespaces: {
              from: values.allowedRoutesFrom || "Selector",
              ...(values.allowedRoutesFrom === "Selector"
                ? {
                    selector: {
                      matchExpressions: [
                        {
                          key: "kubernetes.io/metadata.name",
                          operator: "In",
                          values: values.allowedRoutesNamespaces.split(/\s+/).filter(Boolean),
                        },
                      ],
                    },
                  }
                : {}),
            },
          };
        } else {
          delete firstListener.allowedRoutes;
        }
        nextSpec.listeners = [firstListener, ...listeners.slice(1)];
        updateMutation.mutate({
          row: editingRow,
          body: {
            apiVersion: `gateway.networking.k8s.io/${kindMeta.version}`,
            kind: kindMeta.title,
            metadata: {
              name: editingRow.name,
              namespace: editingRow.namespace,
              ...(editingRow.labels ? { labels: editingRow.labels } : {}),
            },
            spec: nextSpec,
          },
        });
        return;
      }

      if (normalizedKind === "httproute") {
        const hostnames = values.hostnames ? values.hostnames.split(/\s+/).filter(Boolean) : [];
        const nextSpec: Record<string, unknown> = { ...editingSpec };
        nextSpec.parentRefs = [{ ...(asRecordArray(editingSpec.parentRefs)[0] ?? {}), name: values.parentGatewayName }];
        if (hostnames.length > 0) {
          nextSpec.hostnames = hostnames;
        } else {
          delete nextSpec.hostnames;
        }
        const rules = asRecordArray(editingSpec.rules);
        const firstRule: Record<string, unknown> = { ...(rules[0] ?? {}) };
        firstRule.matches = [
          {
            ...(asRecordArray(firstRule.matches)[0] ?? {}),
            path: { type: values.pathType || "PathPrefix", value: values.matchPath || "/" },
          },
        ];
        firstRule.backendRefs = [
          {
            ...(asRecordArray(firstRule.backendRefs)[0] ?? {}),
            name: values.backendServiceName || "kubernetes",
            port: values.backendServicePort || 80,
            ...(values.backendWeight !== undefined ? { weight: values.backendWeight } : {}),
          },
          ...asRecordArray(firstRule.backendRefs).slice(1),
        ];
        const otherFilters = asRecordArray(firstRule.filters).filter(
          (filter) => asString(filter.type) !== "RequestHeaderModifier",
        );
        if (values.headerName && values.headerValue) {
          firstRule.filters = [
            ...otherFilters,
            {
              type: "RequestHeaderModifier",
              requestHeaderModifier: {
                add: [{ name: values.headerName, value: values.headerValue }],
              },
            },
          ];
        } else if (otherFilters.length > 0) {
          firstRule.filters = otherFilters;
        } else {
          delete firstRule.filters;
        }
        nextSpec.rules = [firstRule, ...rules.slice(1)];
        updateMutation.mutate({
          row: editingRow,
          body: {
            apiVersion: `gateway.networking.k8s.io/${kindMeta.version}`,
            kind: kindMeta.title,
            metadata: {
              name: editingRow.name,
              namespace: editingRow.namespace,
              ...(editingRow.labels ? { labels: editingRow.labels } : {}),
            },
            spec: nextSpec,
          },
        });
        return;
      }
    }

    if (normalizedKind === "gateway") {
      const addressValue = values.addresses?.trim();
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "gateways",
        namespace: values.namespace,
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "Gateway",
          metadata: { name: values.name, namespace: values.namespace },
          spec: {
            gatewayClassName: values.gatewayClassName,
            ...(values.addressType && addressValue
              ? { addresses: [{ type: values.addressType, value: addressValue }] }
              : {}),
            listeners: [
              {
                name: values.listenerName || "http",
                port: values.listenerPort || 80,
                protocol: values.listenerProtocol || "HTTP",
                ...(values.listenerHostname?.trim()
                  ? { hostname: values.listenerHostname.trim() }
                  : {}),
                ...(values.allowedRoutesNamespaces
                  ? {
                      allowedRoutes: {
                        namespaces: {
                          from: values.allowedRoutesFrom || "Selector",
                          ...(values.allowedRoutesFrom === "Selector"
                            ? {
                                selector: {
                                  matchExpressions: [
                                    {
                                      key: "kubernetes.io/metadata.name",
                                      operator: "In",
                                      values: values.allowedRoutesNamespaces.split(/\s+/).filter(Boolean),
                                    },
                                  ],
                                },
                              }
                            : {}),
                        },
                      },
                    }
                  : {}),
              },
            ],
          },
        },
      });
      return;
    }

    if (normalizedKind === "gatewayclass") {
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "gatewayclasses",
        namespace: "",
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "GatewayClass",
          metadata: { name: values.name },
          spec: {
            controllerName: values.controllerName || values.gatewayClassName,
            ...(values.parametersGroup && values.parametersKind && values.parametersName
              ? {
                  parametersRef: {
                    group: values.parametersGroup,
                    kind: values.parametersKind,
                    name: values.parametersName,
                  },
                }
              : {}),
          },
        },
      });
      return;
    }

    if (normalizedKind === "httproute") {
      const hostnames = values.hostnames ? values.hostnames.split(/\s+/).filter(Boolean) : [];
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "httproutes",
        namespace: values.namespace,
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "HTTPRoute",
          metadata: { name: values.name, namespace: values.namespace },
          spec: {
            parentRefs: [{ name: values.parentGatewayName }],
            ...(hostnames.length > 0 ? { hostnames } : {}),
            rules: [
              {
                matches: values.matchPath
                  ? [{ path: { type: values.pathType || "PathPrefix", value: values.matchPath } }]
                  : [{ path: { type: "PathPrefix", value: "/" } }],
                backendRefs: [
                  {
                    name: values.backendServiceName || "kubernetes",
                    port: values.backendServicePort || 80,
                    ...(values.backendWeight !== undefined ? { weight: values.backendWeight } : {}),
                  },
                ],
                ...(values.headerName && values.headerValue
                  ? {
                      filters: [
                        {
                          type: "RequestHeaderModifier",
                          requestHeaderModifier: {
                            add: [{ name: values.headerName, value: values.headerValue }],
                          },
                        },
                      ],
                    }
                  : {}),
              },
            ],
          },
        },
      });
    }
  };

  const columns: HeadlampResourceTableColumn<GatewayRow>[] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", listQuery.isLoading),
      render: (value: string, row) =>
        row.id ? (
          <Typography.Link
            onClick={() => setDetailTarget(buildGatewayDynamicDetailTarget(kindMeta, row))}
          >
            {value}
          </Typography.Link>
        ) : (
          value
        ),
    },
    {
      title: "集群",
      key: "clusterId",
      filter: { type: "text", placeholder: "集群" },
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", listQuery.isLoading),
      render: (_: unknown, row) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      filter: { type: "text", placeholder: "名称空间" },
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", listQuery.isLoading),
      render: (value: string) => value || "-",
    },
    {
      title: "标签",
      key: "labels",
      render: (_: unknown, row) => {
        const entries = Object.entries(row.labels ?? {}).slice(0, 3);
        return entries.length > 0 ? (
          <Space wrap size={[4, 4]}>
            {entries.map(([key, value]) => (
              <Tag key={`${row.id}-${key}`}>{`${key}=${value}`}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        );
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      ...getSortableColumnProps("updatedAt", listQuery.isLoading),
      render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle={`删除 ${kindMeta.title}`}
          deleteContent={`确认删除 ${kindMeta.title}「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            openYamlMutation.mutate({
              clusterId: row.clusterId,
              namespace: row.namespace,
              group: "gateway.networking.k8s.io",
              version: kindMeta.version,
              resource: kindMeta.resource,
              name: row.name,
            })
          }
          extraActions={[{ key: "edit", label: "编辑", onClick: () => handleOpenEdit(row) }]}
          onDelete={() =>
            deleteMutation.mutate({
              clusterId: row.clusterId,
              namespace: row.namespace,
              group: "gateway.networking.k8s.io",
              version: kindMeta.version,
              resource: kindMeta.resource,
              name: row.name,
            })
          }
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/network/gateway-api"
        titleZh="Gateway API"
        titleEn="Gateway API"
        description="管理 Gateway API 资源。"
        titleSuffix={
          <Button
            type="primary"
            disabled={!canCreate}
            onClick={handleOpenCreate}
          >
            新增资源
          </Button>
        }
      />

      <Card>
        <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
          <Col span={24}>
            <Select
              value={kind}
              options={gatewayKindOptions}
              style={{ width: "100%" }}
              loading={discoveryQuery.isLoading}
              onChange={(value) => {
                setKind(value);
                resetPage();
                setKeyword("");
                setKeywordInput("");
              }}
            />
          </Col>
        </Row>
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          namespaceDisabled={namespaceDisabled || !kindMeta.namespaced}
          namespacePlaceholder={!kindMeta.namespaced ? "集群级资源" : namespacePlaceholder}
          onClusterChange={(value) => {
            onClusterChange(value);
            resetPage();
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            resetPage();
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未登录或登录初始化中，请稍后重试。" style={{ marginBottom: 16 }} />
        ) : null}

        {listQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={`${kindMeta.title} 列表加载失败`}
            description={listQuery.error instanceof Error ? listQuery.error.message : "unknown"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <ResourceTable<GatewayRow>
          rowKey="id"
          columns={columns}
          tableKey="network.gateway-api"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按名称/标签搜索（示例：gw-a app=web env=prod）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{ sortBy, sortOrder }}
          dataSource={tableData}
          loading={listQuery.isLoading}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, listQuery.isLoading)
          }
          pagination={getPaginationConfig(listQuery.data?.total ?? 0, listQuery.isLoading)}
          onRow={(record) => ({
            onClick: () => {
              if (record.id) {
                setDetailTarget(buildGatewayDynamicDetailTarget(kindMeta, record));
              }
            },
          })}
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => setDetailTarget(request)}
      />

      <ResourceYamlDrawer
        open={yamlOpen}
        onClose={() => {
          setYamlOpen(false);
          setDynamicYamlTarget(null);
        }}
        token={accessToken ?? undefined}
        identity={yamlTarget}
        dynamicIdentity={dynamicYamlTarget}
        onUpdated={() => void listQuery.refetch()}
      />

      <Modal
        title={editingRow ? `编辑 ${kindMeta.title}` : `新增 ${kindMeta.title}`}
        open={createOpen}
        onOk={() => void handleCreateSubmit()}
        onCancel={() => {
          setCreateOpen(false);
          setEditingRow(null);
          setEditingSpec({});
        }}
        okText={editingRow ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={createMutation.isPending || updateMutation.isPending || openStructuredEditMutation.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input disabled={Boolean(editingRow)} />
          </Form.Item>
          {selectedGatewayKind !== "gatewayclass" ? (
            <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
              <Input disabled={Boolean(editingRow)} placeholder="default" />
            </Form.Item>
          ) : null}
          {selectedGatewayKind === "gatewayclass" ? (
            <>
              <Form.Item label="控制器名称" name="controllerName" rules={[{ required: true, message: "请输入控制器名称" }]}>
                <Input placeholder="例如：example.com/gateway-controller" />
              </Form.Item>
              <Form.Item label="参数引用 Group" name="parametersGroup">
                <Input placeholder="例如：gateway.networking.k8s.io" />
              </Form.Item>
              <Form.Item label="参数引用 Kind" name="parametersKind">
                <Input placeholder="例如：ConfigMap" />
              </Form.Item>
              <Form.Item label="参数引用名称" name="parametersName">
                <Input placeholder="例如：gateway-params" />
              </Form.Item>
            </>
          ) : null}
          {selectedGatewayKind === "gateway" ? (
            <>
              <Form.Item label="GatewayClass 名称" name="gatewayClassName" rules={[{ required: true, message: "请输入 GatewayClass 名称" }]}>
                <Input placeholder="例如：istio" />
              </Form.Item>
              <Form.Item label="地址类型" name="addressType">
                <Input placeholder="例如：IPAddress" />
              </Form.Item>
              <Form.Item label="地址值" name="addresses">
                <Input placeholder="例如：10.0.0.10" />
              </Form.Item>
              <Form.Item label="监听器名称" name="listenerName">
                <Input placeholder="例如：http" />
              </Form.Item>
              <Form.Item label="监听器端口" name="listenerPort">
                <InputNumber style={{ width: "100%" }} min={1} max={65535} />
              </Form.Item>
              <Form.Item label="监听器协议" name="listenerProtocol">
                <Input placeholder="HTTP / HTTPS" />
              </Form.Item>
              <Form.Item label="监听器 Hostname" name="listenerHostname">
                <Input placeholder="例如：gateway.example.com" />
              </Form.Item>
              <Form.Item label="允许路由方式" name="allowedRoutesFrom" initialValue="Selector">
                <Select
                  options={[
                    { label: "All", value: "All" },
                    { label: "Same", value: "Same" },
                    { label: "Selector", value: "Selector" },
                    { label: "None", value: "None" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="允许路由名称空间" name="allowedRoutesNamespaces">
                <Input placeholder="空格分隔，例如：default prod" />
              </Form.Item>
            </>
          ) : null}
          {selectedGatewayKind === "httproute" ? (
            <>
              <Form.Item label="父 Gateway 名称" name="parentGatewayName" rules={[{ required: true, message: "请输入父 Gateway 名称" }]}>
                <Input placeholder="例如：istio" />
              </Form.Item>
              <Form.Item label="Hostnames（空格分隔）" name="hostnames">
                <Input placeholder="example.com api.example.com" />
              </Form.Item>
              <Form.Item label="匹配路径" name="matchPath">
                <Input placeholder="/" />
              </Form.Item>
              <Form.Item label="路径类型" name="pathType">
                <Select
                  options={[
                    { label: "PathPrefix", value: "PathPrefix" },
                    { label: "Exact", value: "Exact" },
                    { label: "RegularExpression", value: "RegularExpression" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="后端 Service 名称" name="backendServiceName">
                <Input placeholder="例如：web-svc" />
              </Form.Item>
              <Form.Item label="后端 Service 端口" name="backendServicePort">
                <InputNumber style={{ width: "100%" }} min={1} max={65535} />
              </Form.Item>
              <Form.Item label="后端权重" name="backendWeight">
                <InputNumber style={{ width: "100%" }} min={0} max={1000} />
              </Form.Item>
              <Form.Item label="请求头名称" name="headerName">
                <Input placeholder="例如：X-Env" />
              </Form.Item>
              <Form.Item label="请求头值" name="headerValue">
                <Input placeholder="例如：prod" />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}
