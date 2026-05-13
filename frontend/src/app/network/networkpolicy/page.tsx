"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { matchLabelExpressions, parseResourceSearchInput } from "@/components/resource-action-bar";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { createNetworkResource, deleteNetworkResource, getNetworkResources, type CreateNetworkResourcePayload, type NetworkResource } from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type NetworkPolicyResource = NetworkResource & {
  spec?: {
    podSelector?: Record<string, unknown>;
    policyTypes?: string[];
    ingress?: Array<Record<string, unknown>>;
    egress?: Array<Record<string, unknown>>;
  };
};

interface NetworkPolicyFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  podSelectorKey?: string;
  podSelectorValue?: string;
  policyTypes?: string[];
  ingressFromNamespace?: string;
  egressToNamespace?: string;
}

export default function NetworkPolicyPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<NetworkPolicyFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<NetworkPolicyResource>({
    defaultPageSize: 10,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "network",
      "NetworkPolicy",
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
          kind: "NetworkPolicy",
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
    ...RESOURCE_LIST_REFRESH_OPTIONS,
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

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]));

  const createMutation = useMutation({
    mutationFn: (payload: CreateNetworkResourcePayload) =>
      createNetworkResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("NetworkPolicy 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: [
          "network",
          "NetworkPolicy",
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
      void message.success("NetworkPolicy 删除成功");
      await queryClient.invalidateQueries({
        queryKey: [
          "network",
          "NetworkPolicy",
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
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const columns: ColumnsType<NetworkPolicyResource> = [
    {
      title: "策略名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: NetworkPolicyResource) =>
        row.id ? <Typography.Link onClick={() => setDetailTarget({ kind: "NetworkPolicy", id: row.id })}>{name}</Typography.Link> : name,
    },
    {
      title: "集群",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, row: NetworkPolicyResource) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", isLoading && !data),
    },
    {
      title: "类型",
      key: "policyTypes",
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row: NetworkPolicyResource) => {
        const policyTypes = Array.isArray(row.spec?.policyTypes) ? row.spec?.policyTypes : [];
        return policyTypes.length > 0 ? <Tag color="blue">{policyTypes.join(", ")}</Tag> : "-";
      },
    },
    {
      title: "Pod 选择器",
      key: "podSelector",
      width: TABLE_COL_WIDTH.url,
      render: (_: unknown, row: NetworkPolicyResource) => {
        const selector = row.spec?.podSelector && typeof row.spec.podSelector === "object" ? Object.keys(row.spec.podSelector as Record<string, unknown>).length : 0;
        return selector > 0 ? <Tag color="cyan">已配置</Tag> : "-";
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
      align: "center",
      fixed: "right",
      render: (_: unknown, row: NetworkPolicyResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 NetworkPolicy"
          deleteContent={`确认删除 NetworkPolicy「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "NetworkPolicy",
              name: row.name,
            })
          }
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];

  const handleModalSubmit = async () => {
    let values: NetworkPolicyFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "NetworkPolicy",
      name: values.name,
      spec: {
        podSelector:
          values.podSelectorKey && values.podSelectorValue
            ? { matchLabels: { [values.podSelectorKey]: values.podSelectorValue } }
            : {},
        policyTypes: values.policyTypes ?? ["Ingress"],
        ingress: values.ingressFromNamespace?.trim()
          ? [
              {
                from: [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": values.ingressFromNamespace.trim(),
                      },
                    },
                  },
                ],
              },
            ]
          : [],
        egress: values.egressToNamespace?.trim()
          ? [
              {
                to: [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": values.egressToNamespace.trim(),
                      },
                    },
                  },
                ],
              },
            ]
          : [],
      },
    });
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/network/networkpolicy"
          embedded
          description="管理 Kubernetes NetworkPolicy 访问控制策略。"
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton title="创建NetworkPolicy" onClick={() => { form.resetFields(); setModalOpen(true); }} />}
        />
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean)))}
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
              resetPage();
              const parsed = parseResourceSearchInput("");
              setMergedFilters(parsed.labelExpressions);
              setKeyword(parsed.keyword);
            }
          }}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：np-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 16 }} /> : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="NetworkPolicy 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<NetworkPolicyResource>
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
        title="添加 NetworkPolicy"
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
          <Form.Item label="策略名称" name="name" rules={[{ required: true, message: "请输入 NetworkPolicy 名称" }]}>
            <Input placeholder="例如：allow-ingress" />
          </Form.Item>
          <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <Select placeholder="请选择集群" options={clusterOptions} loading={clustersQuery.isLoading} showSearch filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item label="Pod 标签键" name="podSelectorKey">
            <Input placeholder="例如：app" />
          </Form.Item>
          <Form.Item label="Pod 标签值" name="podSelectorValue">
            <Input placeholder="例如：web" />
          </Form.Item>
          <Form.Item label="策略类型" name="policyTypes" initialValue={["Ingress"]}>
            <Select
              mode="multiple"
              options={[
                { label: "Ingress", value: "Ingress" },
                { label: "Egress", value: "Egress" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Ingress 来源名称空间" name="ingressFromNamespace">
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="Egress 目标名称空间" name="egressToNamespace">
            <Input placeholder="例如：kube-system" />
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
