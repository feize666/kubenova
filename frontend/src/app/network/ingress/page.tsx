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
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildTablePagination } from "@/lib/table/pagination";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type IngressResource = NetworkResource & {
  spec?: {
    rules?: Array<{ host?: string; http?: { paths?: Array<{ path?: string; backend?: { service?: { name?: string } } }> } }>;
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

export default function IngressPage() {
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<IngressFormValues>();

  useEffect(() => {
    const params = new URLSearchParams();
    if (clusterId.trim()) params.set("cluster", clusterId.trim());
    if (namespace.trim()) params.set("namespace", namespace.trim());
    if (keyword.trim()) params.set("keyword", keyword.trim());
    const query = params.toString();
    router.replace(query ? `/network/ingress?${query}` : "/network/ingress", { scroll: false });
  }, [clusterId, keyword, namespace, router]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["network", "Ingress", { clusterId, namespace, keyword, page, pageSize }, accessToken],
    queryFn: () =>
      getNetworkResources(
        { kind: "Ingress", clusterId: clusterId || undefined, namespace: namespace.trim() || undefined, keyword: keyword.trim() || undefined, page, pageSize },
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
        queryKey: ["network", "Ingress", { clusterId, namespace, keyword, page, pageSize }, accessToken],
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
        queryKey: ["network", "Ingress", { clusterId, namespace, keyword, page, pageSize }, accessToken],
        exact: true,
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: IngressFormValues;
    try {
      values = await form.validateFields();
    } catch {
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
          hasKnownCluster(clusterMap, item.clusterId) &&
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters),
      ),
    [clusterMap, data?.items, mergedFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );
  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    setPage(1);
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const handleFilterSearch = (raw: string) => {
    const parsed = parseResourceSearchInput(raw);
    setPage(1);
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

  const columns: ColumnsType<IngressResource> = [
    {
      title: "入口名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
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
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, record: IngressResource) => getClusterDisplayName(clusterMap, record.clusterId),
    },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    {
      title: "域名",
      key: "host",
      width: TABLE_COL_WIDTH.url,
      render: (_: unknown, record: IngressResource) => {
        const hosts = Array.from(
          new Set((record.spec?.rules ?? []).map((rule) => rule.host).filter(Boolean)),
        );
        if (hosts.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: hosts[0] }}>{hosts[0]}</Typography.Text>
            {hosts.length > 1 ? <Tag color="blue">+{hosts.length - 1}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "路径",
      key: "path",
      width: TABLE_COL_WIDTH.ports,
      render: (_: unknown, record: IngressResource) => {
        const paths = getIngressBackends(record).map((item) => item.path);
        if (paths.length === 0) return "-";
        return (
          <Space size={[4, 4]} wrap>
            <Typography.Text ellipsis={{ tooltip: paths[0] }}>{paths[0]}</Typography.Text>
            {paths.length > 1 ? <Tag color="cyan">+{paths.length - 1}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "后端服务",
      key: "serviceName",
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
            {backends.length > 1 ? <Tag color="purple">+{backends.length - 1}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
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
          titleSuffix={<ResourceAddButton title="新增资源" onClick={() => { form.resetFields(); setModalOpen(true); }} />}
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
            setPage(1);
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            setPage(1);
          }}
          onKeywordInputChange={(value) => {
            setKeywordInput(value);
            if (!value.trim()) {
              handleFilterSearch("");
            }
          }}
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

        <Table<IngressResource>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={isLoading && !data}
          pagination={buildTablePagination({
            current: page,
            pageSize,
            total: data?.total ?? 0,
            disabled: isLoading && !data,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
              }
            },
          })}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <Modal
        title="添加 Ingress"
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
          <Form.Item
            label="入口名称"
            name="name"
            rules={[{ required: true, message: "请输入 Ingress 名称" }]}
          >
            <Input placeholder="例如：my-ingress" />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            label="所属集群"
            name="clusterId"
            rules={[{ required: true, message: "请选择集群" }]}
          >
            <Select
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
