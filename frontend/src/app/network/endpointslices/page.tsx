"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Form,
  Input,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { NetworkKindChip } from "@/components/network/network-table-cells";
import { OpsModalShell, OpsSurface } from "@/components/ops";
import { ResourceCreateMethodTabs, type ResourceCreateMode } from "@/components/resource-create-method-tabs";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import { applyResourceYaml, type ResourceDetailRequest, type ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type EndpointSlicePort = {
  name?: string;
  port?: number;
  protocol?: string;
  appProtocol?: string;
};

type EndpointSliceEndpoint = {
  addresses?: string[];
  hostname?: string;
  nodeName?: string;
  conditions?: {
    ready?: boolean;
    serving?: boolean;
    terminating?: boolean;
  };
  targetRef?: {
    kind?: string;
    name?: string;
  };
};

type EndpointSliceResource = Omit<NetworkResource, "kind" | "spec" | "labels"> & {
  kind: NetworkResource["kind"] | "EndpointSlice";
  labels?: Record<string, string>;
  spec?: {
    addressType?: string;
    ports?: EndpointSlicePort[];
    endpoints?: EndpointSliceEndpoint[];
  };
};

type EndpointSliceCreatePayload = Omit<CreateNetworkResourcePayload, "kind"> & {
  kind: "EndpointSlice";
  labels?: Record<string, string>;
};

interface EndpointSliceFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  serviceName?: string;
  addressType: "IPv4" | "IPv6" | "FQDN";
  addresses: string;
  ports: string;
}

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function splitCsv(input?: string) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePorts(input?: string): EndpointSlicePort[] {
  return splitCsv(input).reduce<EndpointSlicePort[]>((result, item) => {
    const [portPart, protocolPart] = item.split("/").map((segment) => segment.trim());
    const protocol = protocolPart || "TCP";
    const [namePart, rawPort] = portPart.includes(":")
      ? portPart.split(":").map((segment) => segment.trim())
      : ["", portPart];
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0) return result;
    result.push({
      ...(namePart ? { name: namePart } : {}),
      port,
      protocol,
    });
    return result;
  }, []);
}

export default function EndpointSlicesPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ResourceCreateMode>("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [form] = Form.useForm<EndpointSliceFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<EndpointSliceResource>({
    defaultPageSize: 10,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "network",
      "EndpointSlice",
      {
        clusterId,
        namespace,
        keyword,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      },
      accessToken,
    ],
    queryFn: () =>
      getNetworkResources(
        {
          kind: "EndpointSlice",
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
          keyword: keyword.trim() || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken || undefined,
    ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterFilterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((cluster) => ({
      label: cluster.name,
      value: cluster.id,
    })),
    [clustersQuery.data],
  );

  const clusterOptions = (clustersQuery.data?.items ?? []).map((cluster) => ({
    label: cluster.name,
    value: cluster.id,
  }));
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);

  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((cluster) => [cluster.id, cluster.name]));

  const createMutation = useMutation({
    mutationFn: (payload: EndpointSliceCreatePayload) =>
      createNetworkResource(payload as unknown as CreateNetworkResourcePayload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("EndpointSlice 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["network", "EndpointSlice"],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const applyYamlMutation = useMutation({
    mutationFn: () =>
      applyResourceYaml(
        {
          clusterId: createYamlClusterId.trim(),
          namespace: createYamlNamespace.trim() || undefined,
          yaml: createYaml.trim(),
        },
        accessToken || undefined,
      ),
    onSuccess: async (result) => {
      void message.success(result.message || "YAML 已应用");
      setModalOpen(false);
      setCreateYaml("");
      await queryClient.invalidateQueries({ queryKey: ["network", "EndpointSlice"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "YAML 创建失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("EndpointSlice 删除成功");
      await queryClient.invalidateQueries({
        queryKey: ["network", "EndpointSlice"],
      });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((item) => item.namespace).filter(Boolean))),
    [data?.items],
  );

  const tableData = useMemo(
    () =>
      ((data?.items ?? []) as EndpointSliceResource[]).filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.namespace, getTextFilter(tableFilters, "namespace")) &&
          textMatches(item.spec?.addressType, getTextFilter(tableFilters, "addressType")),
      ),
    [clusterMap, data?.items, mergedFilters, tableFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/network/endpointslices",
  });

  const handleModalSubmit = async () => {
    if (createMode === "yaml") {
      if (!createYamlClusterId.trim()) {
        void message.warning("请选择集群");
        return;
      }
      if (!createYaml.trim()) {
        void message.warning("请输入或上传 YAML");
        return;
      }
      applyYamlMutation.mutate();
      return;
    }
    let values: EndpointSliceFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const addresses = splitCsv(values.addresses);
    const ports = parsePorts(values.ports);

    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "EndpointSlice",
      name: values.name,
      ...(values.serviceName
        ? {
            labels: {
              "kubernetes.io/service-name": values.serviceName,
            },
          }
        : {}),
      spec: {
        addressType: values.addressType,
        ...(ports.length > 0 ? { ports } : {}),
        endpoints: [
          {
            addresses,
            conditions: { ready: true },
          },
        ],
      },
    });
  };

  const columns: HeadlampResourceTableColumn<EndpointSliceResource>[] = [
    {
      title: "切片名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: EndpointSliceResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "EndpointSlice", id: row.id })}>
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
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, row: EndpointSliceResource) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      filter: { type: "text", placeholder: "名称空间" },
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", isLoading && !data),
    },
    {
      title: "类型",
      key: "addressType",
      filter: { type: "text", placeholder: "类型" },
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row: EndpointSliceResource) => (
        <NetworkKindChip kind={row.spec?.addressType ?? "-"} />
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      ...getSortableColumnProps("createdAt", isLoading && !data),
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      align: "center",
      fixed: "right",
      render: (_: unknown, row: EndpointSliceResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 EndpointSlice"
          deleteContent={`确认删除 EndpointSlice「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "EndpointSlice",
              name: row.name,
            })
          }
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/network/endpointslices"
        description="查看 Kubernetes EndpointSlice 分片、地址状态与端口分布。"
        titleSuffix={<ResourceAddButton title="创建EndpointSlice" onClick={() => {
            const nextClusterId = clusterId || clusterOptions[0]?.value || "";
            const nextNamespace = namespace || "default";
            form.resetFields();
            form.setFieldsValue({ clusterId: nextClusterId, namespace: nextNamespace, addressType: "IPv4", ports: "http:80/TCP" });
            setCreateMode("form");
            setCreateYaml("");
            setCreateYamlClusterId(nextClusterId);
            setCreateYamlNamespace(nextNamespace);
            setModalOpen(true);
          }} />}
      />

      <OpsSurface variant="toolbar" padding="sm">
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          namespaceDisabled={namespaceDisabled}
          namespacePlaceholder={namespacePlaceholder}
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
          keywordPlaceholder="按名称/标签搜索（示例：eps-a app=web env=prod）"
          marginBottom={0}
        />
      </OpsSurface>

      {!isInitializing && !accessToken ? (
        <Alert className="network-resource-state-alert" type="warning" showIcon title="未检测到登录状态，请先登录后再操作。" />
      ) : null}

      {isError ? (
        <Alert
          className="network-resource-state-alert"
          type="error"
          showIcon
          title="EndpointSlice 加载失败"
          description={error instanceof Error ? error.message : "请求失败"}
        />
      ) : null}

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<EndpointSliceResource>
          rowKey="id"
          columns={columns}
          onResourceNavigate={(request) => setDetailTarget(request)}
          tableKey="network.endpointslices"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按名称/标签搜索（示例：slice-a app=web env=prod）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{ sortBy, sortOrder }}
          dataSource={tableData}
          loading={isLoading && !data}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
          }
          pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
        />
      </OpsSurface>

      <OpsModalShell
        title="添加 EndpointSlice"
        description="创建 EndpointSlice，指定地址类型、端点地址和端口。"
        identity="EndpointSlice"
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          setCreateYaml("");
          form.resetFields();
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending || applyYamlMutation.isPending}
        destroyOnHidden
        width={720}
      >
        <ResourceCreateMethodTabs
          mode={createMode}
          onModeChange={setCreateMode}
          yaml={createYaml}
          onYamlChange={setCreateYaml}
          clusterId={createYamlClusterId}
          onClusterIdChange={setCreateYamlClusterId}
          namespace={createYamlNamespace}
          onNamespaceChange={setCreateYamlNamespace}
          clusterOptions={clusterOptions}
          clusterLoading={clustersQuery.isLoading}
          clusterUnavailable={clusterUnavailable}
          kindHint="EndpointSlice"
          disabled={createMutation.isPending || applyYamlMutation.isPending}
          formContent={(
            <Form form={form} layout="vertical">
              <Form.Item label="切片名称" name="name" rules={[{ required: true, message: "请输入 EndpointSlice 名称" }]}>
                <Input placeholder="例如：my-service-abcde" />
              </Form.Item>
              <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
                <Input placeholder="例如：default" />
              </Form.Item>
              <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
                <Select
                  placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
                  options={clusterOptions}
                  loading={clustersQuery.isLoading}
                  disabled={clusterUnavailable || (!clustersQuery.isLoading && clusterOptions.length === 0)}
                  notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                  showSearch
                  filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
              <Form.Item label="关联 Service" name="serviceName">
                <Input placeholder="例如：my-service" />
              </Form.Item>
              <Form.Item label="地址类型" name="addressType" rules={[{ required: true, message: "请选择地址类型" }]}>
                <Select
                  options={[
                    { label: "IPv4", value: "IPv4" },
                    { label: "IPv6", value: "IPv6" },
                    { label: "FQDN", value: "FQDN" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="端点地址" name="addresses" rules={[{ required: true, message: "请输入至少一个地址" }]}>
                <Input placeholder="例如：10.42.0.15,10.42.0.16" />
              </Form.Item>
              <Form.Item label="端口定义" name="ports" rules={[{ required: true, message: "请输入端口定义" }]}>
                <Input placeholder="例如：http:80/TCP,metrics:9090/TCP" />
              </Form.Item>
            </Form>
          )}
        />
      </OpsModalShell>

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
