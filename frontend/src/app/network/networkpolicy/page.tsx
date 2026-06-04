"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Form, Input, Modal, Select, Space, Typography, message } from "antd";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceAddButton } from "@/components/resource-add-button";
import { OpsFilterChip, OpsStatusTag } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { matchLabelExpressions, parseResourceSearchInput } from "@/components/resource-action-bar";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import { applyNetworkResourceYaml, createNetworkResource, deleteNetworkResource, getNetworkResources, type CreateNetworkResourcePayload, type NetworkResource } from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type NetworkPolicyResource = NetworkResource & {
  spec?: {
    podSelector?: Record<string, unknown>;
    policyTypes?: string[];
    ingress?: Array<Record<string, unknown>>;
    egress?: Array<Record<string, unknown>>;
  };
};

type NamespacePeerDirection = "from" | "to";

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

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function getSinglePodSelectorLabel(selector: Record<string, unknown> | undefined): [string, string] | null | undefined {
  if (!selector || Object.keys(selector).length === 0) return undefined;
  const matchLabels = selector.matchLabels;
  if (!matchLabels || typeof matchLabels !== "object" || Array.isArray(matchLabels)) return null;
  const entries = Object.entries(matchLabels as Record<string, unknown>);
  if (entries.length !== 1 || typeof entries[0][1] !== "string") return null;
  return [entries[0][0], entries[0][1]];
}

function getSingleNamespacePeer(rules: Array<Record<string, unknown>> | undefined, direction: NamespacePeerDirection) {
  if (!rules || rules.length === 0) return undefined;
  if (rules.length !== 1) return null;
  const rule = rules[0];
  const peers = rule[direction];
  if (!Array.isArray(peers) || peers.length !== 1) return null;
  const peer = peers[0];
  if (!peer || typeof peer !== "object" || Array.isArray(peer)) return null;
  const namespaceSelector = (peer as Record<string, unknown>).namespaceSelector;
  if (!namespaceSelector || typeof namespaceSelector !== "object" || Array.isArray(namespaceSelector)) return null;
  const matchLabels = (namespaceSelector as Record<string, unknown>).matchLabels;
  if (!matchLabels || typeof matchLabels !== "object" || Array.isArray(matchLabels)) return null;
  const namespaceName = (matchLabels as Record<string, unknown>)["kubernetes.io/metadata.name"];
  return typeof namespaceName === "string" ? namespaceName : null;
}

function isSimpleNetworkPolicySpec(spec: NetworkPolicyResource["spec"]) {
  const podLabel = getSinglePodSelectorLabel(spec?.podSelector);
  const ingressNamespace = getSingleNamespacePeer(spec?.ingress, "from");
  const egressNamespace = getSingleNamespacePeer(spec?.egress, "to");
  return podLabel !== null && ingressNamespace !== null && egressNamespace !== null;
}

export default function NetworkPolicyPage() {
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
  const [editingItem, setEditingItem] = useState<NetworkPolicyResource | null>(null);
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

  const updateMutation = useMutation({
    mutationFn: ({ item, values }: { item: NetworkPolicyResource; values: NetworkPolicyFormValues }) =>
      applyNetworkResourceYaml(
        {
          clusterId: item.clusterId,
          namespace: item.namespace,
          kind: "NetworkPolicy",
          name: item.name,
          yaml: JSON.stringify(
            {
              apiVersion: "networking.k8s.io/v1",
              kind: "NetworkPolicy",
              metadata: {
                name: item.name,
                namespace: item.namespace,
                ...(item.labels ? { labels: item.labels } : {}),
              },
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
            },
            null,
            2,
          ),
        },
        accessToken || undefined,
      ),
    onSuccess: async () => {
      void message.success("NetworkPolicy 更新成功");
      setModalOpen(false);
      setEditingItem(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["network", "NetworkPolicy"] });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleOpenEdit = (item: NetworkPolicyResource) => {
    if (!isSimpleNetworkPolicySpec(item.spec)) {
      void message.info("复杂 NetworkPolicy 请使用 YAML 编辑");
      setYamlTarget({
        clusterId: item.clusterId,
        namespace: item.namespace,
        kind: "NetworkPolicy",
        name: item.name,
      });
      return;
    }
    const podLabel = getSinglePodSelectorLabel(item.spec?.podSelector);
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      podSelectorKey: podLabel?.[0],
      podSelectorValue: podLabel?.[1],
      policyTypes: item.spec?.policyTypes ?? ["Ingress"],
      ingressFromNamespace: getSingleNamespacePeer(item.spec?.ingress, "from") ?? "",
      egressToNamespace: getSingleNamespacePeer(item.spec?.egress, "to") ?? "",
    });
    setModalOpen(true);
  };

  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.namespace, getTextFilter(tableFilters, "namespace")) &&
          textMatches(
            Array.isArray(item.spec?.policyTypes) ? item.spec.policyTypes.join(", ") : "",
            getTextFilter(tableFilters, "policyTypes"),
          ) &&
          textMatches(
            item.spec?.podSelector && Object.keys(item.spec.podSelector as Record<string, unknown>).length > 0
              ? "已配置"
              : "-",
            getTextFilter(tableFilters, "podSelector"),
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
    path: "/network/networkpolicy",
  });

  const columns: HeadlampResourceTableColumn<NetworkPolicyResource>[] = [
    {
      title: "策略名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: NetworkPolicyResource) =>
        row.id ? <Typography.Link onClick={() => setDetailTarget({ kind: "NetworkPolicy", id: row.id })}>{name}</Typography.Link> : name,
    },
    {
      title: "集群",
      key: "clusterId",
      filter: { type: "text", placeholder: "集群" },
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, row: NetworkPolicyResource) => getClusterDisplayName(clusterMap, row.clusterId),
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
      key: "policyTypes",
      filter: { type: "text", placeholder: "类型" },
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row: NetworkPolicyResource) => {
        const policyTypes = Array.isArray(row.spec?.policyTypes) ? row.spec?.policyTypes : [];
        return policyTypes.length > 0 ? <OpsFilterChip tone="info">{policyTypes.join(", ")}</OpsFilterChip> : "-";
      },
    },
    {
      title: "Pod 选择器",
      key: "podSelector",
      filter: { type: "text", placeholder: "Pod 选择器" },
      width: TABLE_COL_WIDTH.url,
      render: (_: unknown, row: NetworkPolicyResource) => {
        const selector = row.spec?.podSelector && typeof row.spec.podSelector === "object" ? Object.keys(row.spec.podSelector as Record<string, unknown>).length : 0;
        return selector > 0 ? <OpsStatusTag tone="info">已配置</OpsStatusTag> : "-";
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
          extraActions={[{ key: "edit", label: "编辑", onClick: () => handleOpenEdit(row) }]}
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
    if (editingItem) {
      updateMutation.mutate({ item: editingItem, values });
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
          titleSuffix={<ResourceAddButton title="创建NetworkPolicy" onClick={handleOpenCreate} />}
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

        <ResourceTable<NetworkPolicyResource>
          rowKey="id"
          columns={columns}
          tableKey="network.networkpolicy"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按名称/标签搜索（示例：policy-a app=web env=prod）",
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
        title={editingItem ? "编辑 NetworkPolicy" : "添加 NetworkPolicy"}
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
          <Form.Item label="策略名称" name="name" rules={[{ required: true, message: "请输入 NetworkPolicy 名称" }]}>
            <Input disabled={Boolean(editingItem)} placeholder="例如：allow-ingress" />
          </Form.Item>
          <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input disabled={Boolean(editingItem)} placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <Select disabled={Boolean(editingItem)} placeholder="请选择集群" options={clusterOptions} loading={clustersQuery.isLoading} showSearch filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())} />
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
