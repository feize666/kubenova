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
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceTable } from "@/components/resource-table";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { OpsModalShell, OpsSurface } from "@/components/ops";
import { ResourceCreateMethodTabs, type ResourceCreateMode } from "@/components/resource-create-method-tabs";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceAddButton } from "@/components/resource-add-button";
import { NetworkKindChip } from "@/components/network/network-table-cells";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import {
  applyNetworkResourceYaml,
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import { applyResourceYaml, type ResourceDetailRequest, type ResourceIdentity } from "@/lib/api/resources";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type IngressRouteResource = NetworkResource & {
  spec?: {
    entryPoints?: string[];
    routes?: Array<{
      match?: string;
      kind?: string;
      middlewares?: Array<{ name?: string }>;
      services?: Array<{ name?: string; port?: number | string }>;
    }>;
    tls?: {
      secretName?: string;
    };
  };
};

interface IngressRouteFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  entryPoints: string;
  match: string;
  serviceName: string;
  servicePort: number;
  middlewares?: string;
  tlsSecretName?: string;
}

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

export default function IngressRoutePage() {
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
  const [modalOpen, setModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ResourceCreateMode>("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [editingItem, setEditingItem] = useState<IngressRouteResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<IngressRouteFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<IngressRouteResource>({
    defaultPageSize: 10,
  });

  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/network/ingressroute",
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "network",
      "IngressRoute",
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
          kind: "IngressRoute",
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
    mutationFn: (payload: CreateNetworkResourcePayload) => createNetworkResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("IngressRoute 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["network", "IngressRoute"],
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
      await queryClient.invalidateQueries({ queryKey: ["network", "IngressRoute"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "YAML 创建失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("IngressRoute 删除成功");
      await queryClient.invalidateQueries({
        queryKey: ["network", "IngressRoute"],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ item, values }: { item: IngressRouteResource; values: IngressRouteFormValues }) => {
      const entryPoints = values.entryPoints
        .split(",")
        .map((entryPoint) => entryPoint.trim())
        .filter(Boolean);
      const middlewares = (values.middlewares ?? "")
        .split(",")
        .map((middleware) => middleware.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
      const nextSpec = JSON.parse(JSON.stringify(item.spec ?? {})) as NonNullable<IngressRouteResource["spec"]>;
      const routes = Array.isArray(nextSpec.routes) ? [...nextSpec.routes] : [];
      const firstRoute = { ...(routes[0] ?? {}) };
      firstRoute.match = values.match;
      firstRoute.kind = firstRoute.kind || "Rule";
      firstRoute.services = [
        {
          ...(firstRoute.services?.[0] ?? {}),
          name: values.serviceName,
          port: Number(values.servicePort),
        },
        ...(firstRoute.services?.slice(1) ?? []),
      ];
      if (middlewares.length > 0) {
        firstRoute.middlewares = middlewares;
      } else {
        delete firstRoute.middlewares;
      }
      routes[0] = firstRoute;
      nextSpec.entryPoints = entryPoints;
      nextSpec.routes = routes;
      if (values.tlsSecretName?.trim()) {
        nextSpec.tls = { ...(nextSpec.tls ?? {}), secretName: values.tlsSecretName.trim() };
      } else {
        delete nextSpec.tls;
      }
      return applyNetworkResourceYaml(
        {
          clusterId: item.clusterId,
          namespace: item.namespace,
          kind: "IngressRoute",
          name: item.name,
          yaml: JSON.stringify(
            {
              apiVersion: "traefik.io/v1alpha1",
              kind: "IngressRoute",
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
      void message.success("IngressRoute 更新成功");
      setModalOpen(false);
      setEditingItem(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["network", "IngressRoute"] });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    const nextClusterId = clusterId || clusterOptions[0]?.value || "";
    const nextNamespace = namespace || "default";
    form.resetFields();
    form.setFieldsValue({
      clusterId: nextClusterId,
      namespace: nextNamespace,
      entryPoints: "web",
      match: "Host(`example.local`)",
      servicePort: 80,
    });
    setCreateMode("form");
    setCreateYaml("");
    setCreateYamlClusterId(nextClusterId);
    setCreateYamlNamespace(nextNamespace);
    setModalOpen(true);
  };

  const handleOpenEdit = (item: IngressRouteResource) => {
    const firstRoute = item.spec?.routes?.[0];
    const firstService = firstRoute?.services?.[0];
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      entryPoints: item.spec?.entryPoints?.join(",") ?? "web",
      match: firstRoute?.match ?? "Host(`example.local`)",
      serviceName: firstService?.name ?? "",
      servicePort: Number(firstService?.port ?? 80),
      middlewares: firstRoute?.middlewares?.map((middleware) => middleware.name).filter(Boolean).join(",") ?? "",
      tlsSecretName: item.spec?.tls?.secretName ?? "",
    });
    setModalOpen(true);
  };

  const handleModalSubmit = async () => {
    if (!editingItem && createMode === "yaml") {
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
    let values: IngressRouteFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ item: editingItem, values });
      return;
    }

    const entryPoints = values.entryPoints
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const middlewares = (values.middlewares ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name) => ({ name }));

    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "IngressRoute",
      name: values.name,
      spec: {
        entryPoints,
        routes: [
          {
            match: values.match,
            kind: "Rule",
            services: [{ name: values.serviceName, port: values.servicePort }],
            ...(middlewares.length > 0 ? { middlewares } : {}),
          },
        ],
        ...(values.tlsSecretName ? { tls: { secretName: values.tlsSecretName } } : {}),
      },
    });
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);
  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]));
  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
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
          textMatches(Array.isArray(item.spec?.entryPoints) ? item.spec.entryPoints.join(" ") : "", getTextFilter(tableFilters, "entryPoints")) &&
          textMatches(Array.isArray(item.spec?.routes) ? item.spec.routes[0]?.match : "", getTextFilter(tableFilters, "match")) &&
          textMatches(
            Array.isArray(item.spec?.routes) && Array.isArray(item.spec.routes[0]?.services)
              ? item.spec.routes[0].services
                  .map((service: { name?: string; port?: number | string }) => `${service.name}:${service.port ?? ""}`)
                  .join(" ")
              : "",
            getTextFilter(tableFilters, "serviceName"),
          ) &&
          textMatches(
            Array.isArray(item.spec?.routes) && Array.isArray(item.spec.routes[0]?.middlewares)
              ? item.spec.routes[0].middlewares.map((middleware: { name?: string }) => middleware.name).join(" ")
              : "",
            getTextFilter(tableFilters, "middlewares"),
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

  const columns: HeadlampResourceTableColumn<IngressRouteResource>[] = [
    {
      title: "路由名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: IngressRouteResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "IngressRoute", id: row.id })}>
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
      render: (_: unknown, record: IngressRouteResource) => getClusterDisplayName(clusterMap, record.clusterId),
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
      key: "kind",
      filter: { type: "text", placeholder: "类型" },
      width: TABLE_COL_WIDTH.type,
      render: () => <NetworkKindChip kind="IngressRoute" />,
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
      align: "left",
      fixed: "right",
      render: (_: unknown, row: IngressRouteResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 IngressRoute"
          deleteContent={`确认删除 IngressRoute「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "IngressRoute",
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
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/network/ingressroute"
        description="管理 Traefik IngressRoute 入口规则、匹配表达式与中间件。"
        titleSuffix={<ResourceAddButton title="创建IngressRoute" onClick={handleOpenCreate} />}
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
          keywordPlaceholder="按名称/标签搜索（示例：ir-a app=web env=prod）"
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
          title="IngressRoute 加载失败"
          description={error instanceof Error ? error.message : "请求失败"}
        />
      ) : null}

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<IngressRouteResource>
          rowKey="id"
          columns={columns}
          onResourceNavigate={(request) => setDetailTarget(request)}
          tableKey="network.ingressroute"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleFilterSearch,
            placeholder: "按名称/标签搜索（示例：ir-a app=web env=prod）",
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
        title={editingItem ? "编辑 IngressRoute" : "添加 IngressRoute"}
        description="配置 Traefik IngressRoute 匹配规则、入口点和后端 Service。"
        identity={editingItem?.name ?? "IngressRoute"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          setEditingItem(null);
          setCreateYaml("");
          form.resetFields();
        }}
        okText={editingItem ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={createMutation.isPending || updateMutation.isPending || applyYamlMutation.isPending}
        destroyOnHidden
        width={720}
      >
        {editingItem ? (
          <Form form={form} layout="vertical">
            <Form.Item label="路由名称" name="name" rules={[{ required: true, message: "请输入 IngressRoute 名称" }]}>
              <Input disabled placeholder="例如：web-route" />
            </Form.Item>
            <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
              <Input disabled placeholder="例如：default" />
            </Form.Item>
            <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
              <Select disabled placeholder="请选择集群" options={clusterOptions} loading={clustersQuery.isLoading} />
            </Form.Item>
            <Form.Item label="EntryPoints" name="entryPoints" rules={[{ required: true, message: "请输入入口点" }]}>
              <Input placeholder="例如：web,websecure" />
            </Form.Item>
            <Form.Item label="匹配规则" name="match" rules={[{ required: true, message: "请输入匹配规则" }]}>
              <Input placeholder="例如：Host(`example.com`) && PathPrefix(`/api`)" />
            </Form.Item>
            <Form.Item label="后端服务名称" name="serviceName" rules={[{ required: true, message: "请输入后端服务名称" }]}>
              <Input placeholder="例如：my-service" />
            </Form.Item>
            <Form.Item label="后端服务端口" name="servicePort" rules={[{ required: true, message: "请输入后端服务端口" }]}>
              <Input type="number" min={1} placeholder="例如：80" />
            </Form.Item>
            <Form.Item label="中间件（逗号分隔）" name="middlewares">
              <Input placeholder="例如：auth-chain,strip-api-prefix" />
            </Form.Item>
            <Form.Item label="TLS Secret" name="tlsSecretName">
              <Input placeholder="例如：example-com-tls" />
            </Form.Item>
          </Form>
        ) : (
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
            kindHint="IngressRoute"
            disabled={createMutation.isPending || applyYamlMutation.isPending}
            formContent={(
              <Form form={form} layout="vertical">
          <Form.Item label="路由名称" name="name" rules={[{ required: true, message: "请输入 IngressRoute 名称" }]}>
            <Input disabled={Boolean(editingItem)} placeholder="例如：web-route" />
          </Form.Item>
          <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input disabled={Boolean(editingItem)} placeholder="例如：default" />
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
          <Form.Item label="EntryPoints" name="entryPoints" rules={[{ required: true, message: "请输入入口点" }]}>
            <Input placeholder="例如：web,websecure" />
          </Form.Item>
          <Form.Item label="匹配规则" name="match" rules={[{ required: true, message: "请输入匹配规则" }]}>
            <Input placeholder="例如：Host(`example.com`) && PathPrefix(`/api`)" />
          </Form.Item>
          <Form.Item label="后端服务名称" name="serviceName" rules={[{ required: true, message: "请输入后端服务名称" }]}>
            <Input placeholder="例如：my-service" />
          </Form.Item>
          <Form.Item label="后端服务端口" name="servicePort" rules={[{ required: true, message: "请输入后端服务端口" }]}>
            <Input type="number" min={1} placeholder="例如：80" />
          </Form.Item>
          <Form.Item label="中间件（逗号分隔）" name="middlewares">
            <Input placeholder="例如：auth-chain,strip-api-prefix" />
          </Form.Item>
          <Form.Item label="TLS Secret" name="tlsSecretName">
            <Input placeholder="例如：example-com-tls" />
          </Form.Item>
              </Form>
            )}
          />
        )}
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
