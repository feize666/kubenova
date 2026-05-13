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
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceAddButton } from "@/components/resource-add-button";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

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

export default function IngressRoutePage() {
  const { accessToken, isInitializing } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(searchParams.get("cluster") ?? "", searchParams.get("namespace") ?? "");
  const initialKeyword = searchParams.get("keyword") ?? "";
  const [keyword, setKeyword] = useState(initialKeyword);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
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

  useEffect(() => {
    const params = new URLSearchParams();
    if (clusterId.trim()) params.set("cluster", clusterId.trim());
    if (namespace.trim()) params.set("namespace", namespace.trim());
    if (keyword.trim()) params.set("keyword", keyword.trim());
    const query = params.toString();
    router.replace(query ? `/network/ingressroute?${query}` : "/network/ingressroute", {
      scroll: false,
    });
  }, [clusterId, keyword, namespace, router]);

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

  const handleModalSubmit = async () => {
    let values: IngressRouteFormValues;
    try {
      values = await form.validateFields();
    } catch {
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
  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]));
  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
    [data?.items],
  );
  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters),
      ),
    [data?.items, mergedFilters],
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
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const columns: ColumnsType<IngressRouteResource> = [
    {
      title: "路由名称",
      dataIndex: "name",
      key: "name",
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
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, record: IngressRouteResource) => getClusterDisplayName(clusterMap, record.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", isLoading && !data),
    },
    {
      title: "入口点",
      key: "entryPoints",
      width: TABLE_COL_WIDTH.schedule,
      render: (_: unknown, record: IngressRouteResource) => {
        const entryPoints = record.spec?.entryPoints ?? [];
        if (entryPoints.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: entryPoints[0] }}>{entryPoints[0]}</Typography.Text>
            {entryPoints.length > 1 ? <Tag color="blue">+{entryPoints.length - 1}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "匹配规则",
      key: "match",
      width: TABLE_COL_WIDTH.url,
      render: (_: unknown, record: IngressRouteResource) => (
        <Typography.Text ellipsis={{ tooltip: record.spec?.routes?.[0]?.match ?? "-" }}>
          {record.spec?.routes?.[0]?.match ?? "-"}
        </Typography.Text>
      ),
    },
    {
      title: "后端服务",
      key: "serviceName",
      width: TABLE_COL_WIDTH.ports,
      render: (_: unknown, record: IngressRouteResource) => {
        const services = record.spec?.routes?.[0]?.services ?? [];
        const primary = services[0];
        if (!primary?.name) return "-";
        const serviceId = `live:${record.clusterId}:Service:${record.namespace}:${primary.name}`;
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Link onClick={() => setDetailTarget({ kind: "Service", id: serviceId })}>
              {primary.name}
            </Typography.Link>
            <Typography.Text type="secondary">:{primary.port ?? "-"}</Typography.Text>
            {services.length > 1 ? <Tag color="purple">+{services.length - 1}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "中间件",
      key: "middlewares",
      width: TABLE_COL_WIDTH.address,
      render: (_: unknown, record: IngressRouteResource) => {
        const middlewares =
          record.spec?.routes?.[0]?.middlewares?.map((item) => item.name).filter(Boolean) ?? [];
        if (middlewares.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: middlewares[0] }}>{middlewares[0]}</Typography.Text>
            {middlewares.length > 1 ? <Tag color="cyan">+{middlewares.length - 1}</Tag> : null}
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
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/network/ingressroute"
          embedded
          description="管理 Traefik IngressRoute 入口规则、匹配表达式与中间件。"
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton title="创建IngressRoute" onClick={() => { form.resetFields(); form.setFieldsValue({ entryPoints: "web", match: "Host(`example.local`)", servicePort: 80 }); setModalOpen(true); }} />}
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
          onKeywordInputChange={(value) => {
            setKeywordInput(value);
            if (!value.trim()) {
              handleFilterSearch("");
            }
          }}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：ir-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 16 }} />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="IngressRoute 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<IngressRouteResource>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={isLoading && !data}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
          }
          pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <Modal
        title="添加 IngressRoute"
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="路由名称" name="name" rules={[{ required: true, message: "请输入 IngressRoute 名称" }]}>
            <Input placeholder="例如：web-route" />
          </Form.Item>
          <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <Select
              placeholder="请选择集群"
              options={clusterOptions}
              loading={clustersQuery.isLoading}
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
