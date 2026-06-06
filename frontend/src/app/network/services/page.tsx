"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import type { TableProps } from "antd";
import type { SortOrder as AntdSortOrder } from "antd/es/table/interface";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { OpsFilterChip } from "@/components/ops";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceTable } from "@/components/resource-table";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceRowActions } from "@/components/resource-row-actions";
import {
  applyNetworkResourceYaml,
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { QUERY_CACHE_TIMINGS } from "@/lib/query";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

interface ServiceFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer";
}

const SERVICE_KIND = "Service";
const SERVICE_PATH = "/network/services";
const SERVICE_TABLE_KEY = "network.services";
const EMPTY_NETWORK_RESOURCES: NetworkResource[] = [];
const EMPTY_CLUSTER_MAP: Record<string, string> = {};
const SERVICE_TYPE_OPTIONS = [
  { label: "ClusterIP", value: "ClusterIP" },
  { label: "NodePort", value: "NodePort" },
  { label: "LoadBalancer", value: "LoadBalancer" },
] satisfies Array<{ label: ServiceFormValues["type"]; value: ServiceFormValues["type"] }>;
const SERVICE_SORT_DIRECTIONS: AntdSortOrder[] = ["ascend", "descend", null];
type ServiceTableChangeHandler = NonNullable<TableProps<NetworkResource>["onChange"]>;
const ServiceNowContext = createContext<number | undefined>(undefined);
const SERVICE_LIST_QUERY_CACHE_OPTIONS = {
  staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
  gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  retry: 1,
} as const;

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function getServiceSortOrder(
  columnKey: string,
  sortBy: string | undefined,
  sortOrder: "asc" | "desc" | undefined,
): AntdSortOrder {
  if (sortBy !== columnKey) {
    return null;
  }
  if (sortOrder === "asc") {
    return "ascend";
  }
  if (sortOrder === "desc") {
    return "descend";
  }
  return null;
}

function getServiceSortableColumnProps(
  columnKey: string,
  sortBy: string | undefined,
  sortOrder: "asc" | "desc" | undefined,
  busy: boolean,
) {
  return {
    sorter: true as const,
    sortDirections: SERVICE_SORT_DIRECTIONS,
    sortOrder: getServiceSortOrder(columnKey, sortBy, sortOrder),
    onHeaderCell: () => ({
      style: {
        cursor: busy ? "not-allowed" : "pointer",
        pointerEvents: busy ? ("none" as const) : undefined,
      },
    }),
  };
}

function ServiceCreatedAtCell({ value }: { value: string }) {
  const now = useContext(ServiceNowContext);
  return <ResourceTimeCell value={value} now={now} mode="relative" />;
}

function ServiceTimeProvider({ children }: { children: ReactNode }) {
  const now = useNowTicker();
  return <ServiceNowContext.Provider value={now}>{children}</ServiceNowContext.Provider>;
}

export default function ServicesPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const { clusterId, namespace, namespaceDisabled, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<NetworkResource>({
    defaultPageSize: 10,
  });

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NetworkResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<ServiceFormValues>();
  const page = pagination.pageIndex + 1;
  const serviceListParams = useMemo(
    () => ({
      kind: SERVICE_KIND,
      clusterId: clusterId || undefined,
      keyword: keyword.trim() || undefined,
      namespace: namespace.trim() || undefined,
      page,
      pageSize: pagination.pageSize,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    }),
    [clusterId, keyword, namespace, page, pagination.pageSize, sortBy, sortOrder],
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    ...SERVICE_LIST_QUERY_CACHE_OPTIONS,
    placeholderData: (previousData) => previousData,
    queryKey: [
      "network",
      SERVICE_KIND,
      serviceListParams,
      accessToken,
    ],
    queryFn: () =>
      getNetworkResources(
        serviceListParams,
        accessToken || undefined,
    ),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const isTableBusy = isLoading && !data;

  const clustersQuery = useQuery({
    ...SERVICE_LIST_QUERY_CACHE_OPTIONS,
    placeholderData: (previousData) => previousData,
    queryKey: ["clusters", "all", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterItems = clustersQuery.data?.items;
  const clusterOptions = useMemo(
    () => (clusterItems ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clusterItems],
  );
  const clusterMap = useMemo(
    () =>
      clusterItems
        ? Object.fromEntries(clusterItems.map((c) => [c.id, c.name]))
        : EMPTY_CLUSTER_MAP,
    [clusterItems],
  );
  const preferencesClient = useMemo(
    () => createTablePreferencesClient(accessToken || undefined),
    [accessToken],
  );

  const createMutation = useMutation({
    mutationFn: (payload: CreateNetworkResourcePayload) =>
      createNetworkResource(payload, accessToken || undefined),
    onSuccess: () => {
      void message.success("Service 创建成功");
      setModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({
        queryKey: ["network", SERVICE_KIND],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: () => {
      void message.success("Service 删除成功");
      void queryClient.invalidateQueries({
        queryKey: ["network", SERVICE_KIND],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });
  const deleteService = deleteMutation.mutate;

  const updateMutation = useMutation({
    mutationFn: ({ item, values }: { item: NetworkResource; values: ServiceFormValues }) =>
      applyNetworkResourceYaml(
        {
          clusterId: item.clusterId,
          namespace: item.namespace,
          kind: SERVICE_KIND,
          name: item.name,
          yaml: JSON.stringify(
            {
              apiVersion: "v1",
              kind: SERVICE_KIND,
              metadata: {
                name: item.name,
                namespace: item.namespace,
                ...(item.labels ? { labels: item.labels } : {}),
              },
              spec: {
                ...((item.spec ?? {}) as Record<string, unknown>),
                type: values.type,
              },
            },
            null,
            2,
          ),
        },
        accessToken || undefined,
      ),
    onSuccess: async () => {
      void message.success("Service 更新成功");
      setModalOpen(false);
      setEditingItem(null);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["network", SERVICE_KIND],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleOpenCreate = useCallback(() => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const handleOpenEdit = useCallback((item: NetworkResource) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      type:
        item.spec?.type === "NodePort" || item.spec?.type === "LoadBalancer"
          ? item.spec.type
          : "ClusterIP",
    });
    setModalOpen(true);
  }, [form]);

  const handleModalSubmit = useCallback(async () => {
    let values: ServiceFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ item: editingItem, values });
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: SERVICE_KIND,
      name: values.name,
      spec: { type: values.type },
    });
  }, [createMutation, editingItem, form, updateMutation]);

  const serviceItems = data?.items ?? EMPTY_NETWORK_RESOURCES;
  const deferredServiceItems = useDeferredValue(serviceItems);
  const deferredMergedFilters = useDeferredValue(mergedFilters);
  const deferredTableFilters = useDeferredValue(tableFilters);
  const deferredClusterMap = useDeferredValue(clusterMap);
  const knownNamespaces = useMemo(
    () =>
      Array.from(new Set(serviceItems.map((i) => i.namespace).filter(Boolean))),
    [serviceItems],
  );
  const tableData = useMemo(
    () =>
      deferredServiceItems.filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, deferredMergedFilters) &&
          textMatches(item.name, getTextFilter(deferredTableFilters, "name")) &&
          textMatches(getClusterDisplayName(deferredClusterMap, item.clusterId), getTextFilter(deferredTableFilters, "clusterId")) &&
          textMatches(item.namespace, getTextFilter(deferredTableFilters, "namespace")) &&
          textMatches(SERVICE_KIND, getTextFilter(deferredTableFilters, "kind")),
      ),
    [deferredClusterMap, deferredMergedFilters, deferredServiceItems, deferredTableFilters],
  );
  const deferredTableData = useDeferredValue(tableData);
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(deferredTableData.map((item) => item.name), { max: 320 }),
    [deferredTableData],
  );
  const handleSearch = useCallback(() => {
    const parsed = parseResourceSearchInput(keywordInput);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  }, [keywordInput, resetPage]);
  const handleGlobalSearchChange = useCallback((value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  }, [resetPage]);
  const handleClusterChange = useCallback((value: string) => {
    onClusterChange(value);
    resetPage();
  }, [onClusterChange, resetPage]);
  const handleNamespaceChange = useCallback((value: string) => {
    onNamespaceChange(value);
    resetPage();
  }, [onNamespaceChange, resetPage]);
  const handleFiltersChange = useCallback((nextFilters: HeadlampTableFilters) => {
    setTableFilters(nextFilters);
    resetPage();
  }, [resetPage]);
  const globalSearch = useMemo(
    () => ({
      value: keywordInput,
      onChange: handleGlobalSearchChange,
      placeholder: "按名称/标签搜索（示例：svc-a app=web env=prod）",
    }),
    [handleGlobalSearchChange, keywordInput],
  );
  const sortState = useMemo(
    () => ({ sortBy, sortOrder }),
    [sortBy, sortOrder],
  );
  const handleResourceTableChange = useCallback<ServiceTableChangeHandler>(
    (nextPagination, filters, sorter, extra) =>
      handleTableChange(nextPagination, filters, sorter, extra, isTableBusy),
    [handleTableChange, isTableBusy],
  );
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: SERVICE_PATH,
  });

  const columns: HeadlampResourceTableColumn<NetworkResource>[] = useMemo(
    () => [
      {
        title: "服务名称",
        dataIndex: "name",
        key: "name",
        required: true,
        filter: { type: "text", placeholder: "名称" },
        width: nameWidth,
        ellipsis: true,
        ...getServiceSortableColumnProps("name", sortBy, sortOrder, isTableBusy),
        render: (name: string, row: NetworkResource) =>
          row.id ? (
            <Typography.Link onClick={() => setDetailTarget({ kind: SERVICE_KIND, id: row.id })}>
              {name}
            </Typography.Link>
          ) : (
            name
          ),
      },
      {
        title: "集群",
        key: "clusterId",
        filter: { type: "text", placeholder: "集群" },
        width: TABLE_COL_WIDTH.cluster,
        ...getServiceSortableColumnProps("clusterId", sortBy, sortOrder, isTableBusy),
        render: (_: unknown, row: NetworkResource) => getClusterDisplayName(clusterMap, row.clusterId),
      },
      {
        title: "名称空间",
        dataIndex: "namespace",
        key: "namespace",
        filter: { type: "text", placeholder: "名称空间" },
        width: TABLE_COL_WIDTH.namespace,
        ...getServiceSortableColumnProps("namespace", sortBy, sortOrder, isTableBusy),
      },
      {
        title: "类型",
        key: "kind",
        filter: { type: "text", placeholder: "类型" },
        width: TABLE_COL_WIDTH.type,
        render: () => <OpsFilterChip tone="info">{SERVICE_KIND}</OpsFilterChip>,
      },
      {
        title: "创建时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: TABLE_COL_WIDTH.time,
        ...getServiceSortableColumnProps("createdAt", sortBy, sortOrder, isTableBusy),
        render: (value: string) => <ServiceCreatedAtCell value={value} />,
      },
      {
        title: "操作",
        key: "actions",
        required: true,
        width: TABLE_COL_WIDTH.actionCompact,
        align: "left",
        fixed: "right",
        render: (_: unknown, row: NetworkResource) => (
          <ResourceRowActions
            deleteLabel="删除"
            deleteTitle="删除 Service"
            deleteContent={`确认删除 Service「${row.name}」吗？此操作不可恢复。`}
            onYaml={() =>
              setYamlTarget({
                clusterId: row.clusterId,
                namespace: row.namespace,
                kind: SERVICE_KIND,
                name: row.name,
              })
            }
            extraActions={[{ key: "edit", label: "编辑", onClick: () => handleOpenEdit(row) }]}
            onDelete={() => deleteService(row.id)}
          />
        ),
      },
    ],
    [clusterMap, deleteService, handleOpenEdit, isTableBusy, nameWidth, sortBy, sortOrder],
  );

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path={SERVICE_PATH}
          embedded
          description="管理集群 Service 访问策略、端口映射与服务暴露方式。"
          style={{ marginBottom: 8 }}
          titleSuffix={<ResourceAddButton title="创建Service" onClick={handleOpenCreate} />}
        />
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          namespaceDisabled={namespaceDisabled}
          namespacePlaceholder={namespaceDisabled ? "请先选择集群" : "全部名称空间"}
          onClusterChange={handleClusterChange}
          onNamespaceChange={handleNamespaceChange}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：svc-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 12 }} />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="网络服务加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <ServiceTimeProvider>
          <ResourceTable<NetworkResource>
            rowKey="id"
            columns={columns}
            tableKey={SERVICE_TABLE_KEY}
            preferencesClient={preferencesClient}
            globalSearch={globalSearch}
            filters={tableFilters}
            onFiltersChange={handleFiltersChange}
            sort={sortState}
            dataSource={tableData}
            loading={isTableBusy}
            onChange={handleResourceTableChange}
            pagination={getPaginationConfig(data?.total ?? 0, isTableBusy)}
          />
        </ServiceTimeProvider>
      </Card>

      <Modal
        title={editingItem ? "编辑 Service" : "添加 Service"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          setEditingItem(null);
          form.resetFields();
        }}
        okText={editingItem ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="服务名称"
            name="name"
            rules={[{ required: true, message: "请输入服务名称" }]}
          >
            <Input disabled={Boolean(editingItem)} placeholder="例如：my-service" />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input disabled={Boolean(editingItem)} placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            label="所属集群"
            name="clusterId"
            rules={[{ required: true, message: "请选择集群" }]}
          >
            <Select
              disabled={Boolean(editingItem)}
              placeholder="请选择集群"
              options={clusterOptions}
              loading={clustersQuery.isLoading}
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="服务类型"
            name="type"
            rules={[{ required: true, message: "请选择服务类型" }]}
          >
            <Select
              placeholder="请选择服务类型"
              options={SERVICE_TYPE_OPTIONS}
            />
          </Form.Item>
        </Form>
      </Modal>
      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => setDetailTarget(request)}
      />
      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        onClose={() => setYamlTarget(null)}
        identity={yamlTarget}
        token={accessToken ?? undefined}
        onUpdated={() => {
          void message.success("YAML 更新成功");
          void refetch();
        }}
      />
    </Space>
  );
}
