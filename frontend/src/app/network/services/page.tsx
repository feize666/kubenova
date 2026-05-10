"use client";

import { SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
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
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceRowActions } from "@/components/resource-row-actions";
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { NamespaceSelect } from "@/components/namespace-select";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildResourceTableColumns } from "@/lib/table/resource-table-schema";

interface ServiceFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer";
}

export default function ServicesPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [clusterId, setClusterId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<ServiceFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["network", "Service", { clusterId, keyword, namespace, page, pageSize }, accessToken],
    queryFn: () =>
      getNetworkResources(
        { kind: "Service", clusterId: clusterId || undefined, keyword: keyword.trim() || undefined, namespace: namespace.trim() || undefined, page, pageSize },
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
    () => [
      { label: "全部集群", value: "" },
      ...(clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    ],
    [clustersQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: CreateNetworkResourcePayload) =>
      createNetworkResource(payload, accessToken || undefined),
    onSuccess: () => {
      void message.success("Service 创建成功");
      setModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({
        queryKey: ["network", "Service", { clusterId, keyword, namespace, page, pageSize }, accessToken],
        exact: true,
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
        queryKey: ["network", "Service", { clusterId, keyword, namespace, page, pageSize }, accessToken],
        exact: true,
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: ServiceFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "Service",
      name: values.name,
      spec: { type: values.type },
    });
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));

  const clusterMap = Object.fromEntries(
    (clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]),
  );
  const knownNamespaces = useMemo(
    () =>
      Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
    [data?.items],
  );
  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter((item) =>
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
    setPage(1);
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const columns = buildResourceTableColumns<NetworkResource>({
    name: {
      title: "服务名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: NetworkResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Service", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
    },
    cluster: {
      title: "集群",
      key: "cluster",
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, row: NetworkResource) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    namespace: { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    body: [
      {
        title: "类型",
        key: "kind",
        width: TABLE_COL_WIDTH.type,
        render: () => <Tag color="blue">Service</Tag>,
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
        render: (_: unknown, row: NetworkResource) => (
          <ResourceRowActions
            deleteLabel="删除"
            deleteTitle="删除 Service"
            deleteContent={`确认删除 Service「${row.name}」吗？此操作不可恢复。`}
            onYaml={() =>
              setYamlTarget({
                clusterId: row.clusterId,
                namespace: row.namespace,
                kind: "Service",
                name: row.name,
              })
            }
            onDelete={() => deleteMutation.mutate(row.id)}
          />
        ),
      },
    ],
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/network/services"
          embedded
          description="管理集群 Service 访问策略、端口映射与服务暴露方式。"
          style={{ marginBottom: 8 }}
          titleSuffix={<ResourceAddButton title="新增资源" onClick={() => { form.resetFields(); setModalOpen(true); }} />}
        />
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          onClusterChange={(value) => {
            setClusterId(value);
            setPage(1);
          }}
          onNamespaceChange={(value) => {
            setNamespace(value);
            setPage(1);
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
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

        <Table<NetworkResource>
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={isLoading && !data}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <Modal
        title="添加 Service"
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
            label="服务名称"
            name="name"
            rules={[{ required: true, message: "请输入服务名称" }]}
          >
            <Input placeholder="例如：my-service" />
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
            label="服务类型"
            name="type"
            rules={[{ required: true, message: "请选择服务类型" }]}
          >
            <Select
              placeholder="请选择服务类型"
              options={[
                { label: "ClusterIP", value: "ClusterIP" },
                { label: "NodePort", value: "NodePort" },
                { label: "LoadBalancer", value: "LoadBalancer" },
              ]}
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
