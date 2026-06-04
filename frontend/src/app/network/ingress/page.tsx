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
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { OpsFilterChip } from "@/components/ops";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceTable } from "@/components/resource-table";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import {
  applyNetworkResourceYaml,
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type IngressResource = NetworkResource & {
  spec?: {
    rules?: Array<{
      host?: string;
      http?: {
        paths?: Array<{
          path?: string;
          pathType?: string;
          backend?: { service?: { name?: string; port?: unknown } };
        }>;
      };
    }>;
    tls?: unknown[];
  };
};

type IngressBackend = { serviceName: string; path: string; host: string };

interface IngressFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  host: string;
  path: string;
  serviceName: string;
}

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

export default function IngressPage() {
  const { accessToken, isInitializing } = useAuth();
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
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
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<IngressResource>({
    defaultPageSize: 10,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IngressResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<IngressFormValues>();

  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/network/ingress",
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "network",
      "Ingress",
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
          kind: "Ingress",
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
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: CreateNetworkResourcePayload) =>
      createNetworkResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("Ingress 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: [
          "network",
          "Ingress",
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
        exact: true,
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("Ingress 删除成功");
      await queryClient.invalidateQueries({
        queryKey: [
          "network",
          "Ingress",
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
        exact: true,
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ item, values }: { item: IngressResource; values: IngressFormValues }) => {
      const nextSpec = JSON.parse(JSON.stringify(item.spec ?? {})) as NonNullable<IngressResource["spec"]>;
      const rules = Array.isArray(nextSpec.rules) ? [...nextSpec.rules] : [];
      const firstRule = { ...(rules[0] ?? {}) };
      const paths = Array.isArray(firstRule.http?.paths) ? [...firstRule.http.paths] : [];
      const firstPath = { ...(paths[0] ?? {}) };
      firstPath.path = values.path;
      firstPath.backend = {
        ...(firstPath.backend ?? {}),
        service: {
          ...(firstPath.backend?.service ?? {}),
          name: values.serviceName,
        },
      };
      paths[0] = firstPath;
      firstRule.host = values.host;
      firstRule.http = { ...(firstRule.http ?? {}), paths };
      rules[0] = firstRule;
      nextSpec.rules = rules;
      return applyNetworkResourceYaml(
        {
          clusterId: item.clusterId,
          namespace: item.namespace,
          kind: "Ingress",
          name: item.name,
          yaml: JSON.stringify(
            {
              apiVersion: "networking.k8s.io/v1",
              kind: "Ingress",
              metadata: {
                name: item.name,
                namespace: item.namespace,
                ...(item.labels ? { labels: item.labels } : {}),
              },
              spec: nextSpec,
            },
            null,
            2,
          ),
        },
        accessToken || undefined,
      );
    },
    onSuccess: async () => {
      void message.success("Ingress 更新成功");
      setModalOpen(false);
      setEditingItem(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["network", "Ingress"] });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ path: "/" });
    setModalOpen(true);
  };

  const handleOpenEdit = (item: IngressResource) => {
    const firstRule = item.spec?.rules?.[0];
    const firstPath = firstRule?.http?.paths?.[0];
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      host: firstRule?.host ?? "",
      path: firstPath?.path ?? "/",
      serviceName: firstPath?.backend?.service?.name ?? "",
    });
    setModalOpen(true);
  };

  const handleModalSubmit = async () => {
    let values: IngressFormValues;
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
      kind: "Ingress",
      name: values.name,
      spec: {
        rules: [
          {
            host: values.host,
            http: {
              paths: [
                {
                  path: values.path,
                  backend: { service: { name: values.serviceName } },
                },
              ],
            },
          },
        ],
      },
    });
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));

  const clusterMap = Object.fromEntries(
    (clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]),
  );

  // Extract known namespaces from loaded data
  const knownNamespaces = useMemo(
    () =>
      Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
    [data?.items],
  );
  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.namespace, getTextFilter(tableFilters, "namespace")) &&
          textMatches(
            Array.isArray(item.spec?.rules) ? item.spec.rules.map((rule) => rule.host).join(" ") : "",
            getTextFilter(tableFilters, "host"),
          ),
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

  const handleFilterSearch = (raw: string) => {
    const parsed = parseResourceSearchInput(raw);
    setKeywordInput(raw);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const getIngressBackends = (resource: IngressResource): IngressBackend[] => {
    const rows: IngressBackend[] = [];
    for (const rule of resource.spec?.rules ?? []) {
      for (const pathRow of rule.http?.paths ?? []) {
        const serviceName = pathRow.backend?.service?.name;
        if (!serviceName) continue;
        rows.push({
          serviceName,
          path: pathRow.path ?? "/",
          host: rule.host ?? "*",
        });
      }
    }
    return rows;
  };

  const columns: HeadlampResourceTableColumn<IngressResource>[] = [
    {
      title: "入口名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: IngressResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Ingress", id: row.id })}>
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
      render: (_: unknown, record: IngressResource) => getClusterDisplayName(clusterMap, record.clusterId),
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
      title: "域名",
      key: "host",
      filter: { type: "text", placeholder: "域名" },
      width: TABLE_COL_WIDTH.url,
      render: (_: unknown, record: IngressResource) => {
        const hosts = Array.from(
          new Set((record.spec?.rules ?? []).map((rule) => rule.host).filter(Boolean)),
        );
        if (hosts.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: hosts[0] }}>{hosts[0]}</Typography.Text>
            {hosts.length > 1 ? <OpsFilterChip tone="info">+{hosts.length - 1}</OpsFilterChip> : null}
          </Space>
        );
      },
    },
    {
      title: "路径",
      key: "path",
      filter: { type: "text", placeholder: "路径" },
      width: TABLE_COL_WIDTH.ports,
      render: (_: unknown, record: IngressResource) => {
        const paths = getIngressBackends(record).map((item) => item.path);
        if (paths.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: paths[0] }}>{paths[0]}</Typography.Text>
            {paths.length > 1 ? <OpsFilterChip tone="info">+{paths.length - 1}</OpsFilterChip> : null}
          </Space>
        );
      },
    },
    {
      title: "后端服务",
      key: "serviceName",
      filter: { type: "text", placeholder: "服务" },
      width: TABLE_COL_WIDTH.image,
      render: (_: unknown, record: IngressResource) => {
        const backends = getIngressBackends(record);
        const primary = backends[0];
        if (!primary) return "-";
        const serviceId = `live:${record.clusterId}:Service:${record.namespace}:${primary.serviceName}`;
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Link onClick={() => setDetailTarget({ kind: "Service", id: serviceId })}>
              {primary.serviceName}
            </Typography.Link>
            {backends.length > 1 ? <OpsFilterChip tone="info">+{backends.length - 1}</OpsFilterChip> : null}
          </Space>
        );
      },
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
      render: (_: unknown, row: IngressResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 Ingress"
          deleteContent={`确认删除 Ingress「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "Ingress",
              name: row.name,
            })
          }
          extraActions={[{ key: "edit", label: "编辑", onClick: () => handleOpenEdit(row) }]}
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/network/ingress"
          embedded
          description="管理集群 Ingress 入口规则与域名路由。"
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton title="创建Ingress" onClick={handleOpenCreate} />}
        />
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
          keywordPlaceholder="按名称/标签搜索（示例：ingress-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert
            type="warning"
            showIcon
            message="未检测到登录状态，请先登录后再操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="网络入口加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <ResourceTable<IngressResource>
          rowKey="id"
          columns={columns}
          tableKey="network.ingress"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleFilterSearch,
            placeholder: "按名称/标签搜索（示例：ingress-a app=web env=prod）",
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
      </Card>

      <Modal
        title={editingItem ? "编辑 Ingress" : "添加 Ingress"}
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
            label="入口名称"
            name="name"
            rules={[{ required: true, message: "请输入 Ingress 名称" }]}
          >
            <Input disabled={Boolean(editingItem)} placeholder="例如：my-ingress" />
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
                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="域名（Host）"
            name="host"
            rules={[{ required: true, message: "请输入域名" }]}
          >
            <Input placeholder="例如：example.com" />
          </Form.Item>
          <Form.Item
            label="路径（Path）"
            name="path"
            rules={[{ required: true, message: "请输入路径" }]}
            initialValue="/"
          >
            <Input placeholder="例如：/" />
          </Form.Item>
          <Form.Item
            label="后端服务名称"
            name="serviceName"
            rules={[{ required: true, message: "请输入后端服务名称" }]}
          >
            <Input placeholder="例如：my-service" />
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
