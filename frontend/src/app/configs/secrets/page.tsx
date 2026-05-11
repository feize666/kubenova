"use client";

import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
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
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import {
  createConfig,
  deleteConfig,
  getConfigs,
  type ConfigResourceItem,
} from "@/lib/api/configs";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { ResourceClusterNamespaceFilters } from "@/components/resource-cluster-namespace-filters";
import { ResourceAddButton } from "@/components/resource-add-button";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildTablePagination } from "@/lib/table/pagination";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

const SECRET_TYPE_OPTIONS = [
  { label: "Opaque", value: "Opaque" },
  { label: "kubernetes.io/tls", value: "kubernetes.io/tls" },
  { label: "kubernetes.io/dockerconfigjson", value: "kubernetes.io/dockerconfigjson" },
  { label: "kubernetes.io/service-account-token", value: "kubernetes.io/service-account-token" },
];

interface KVPair {
  key: string;
  value: string;
}

interface SecretFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  type: string;
  entries: KVPair[];
}

export default function SecretsPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<SecretFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["configs", "secrets", { clusterId, namespace, keyword, page, pageSize }, accessToken],
    queryFn: () =>
      getConfigs(
        "secrets",
        { clusterId: clusterId || undefined, namespace: namespace.trim() || undefined, keyword: keyword.trim() || undefined, page, pageSize },
        accessToken!,
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

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createConfig>[0]) =>
      createConfig(payload, accessToken!),
    onSuccess: async () => {
      void message.success("Secret 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["configs", "secrets"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConfig(id, accessToken!),
    onSuccess: async () => {
      void message.success("Secret 删除成功");
      await queryClient.invalidateQueries({ queryKey: ["configs", "secrets"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: SecretFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const secretData: Record<string, string> = {};
    for (const entry of values.entries ?? []) {
      if (entry.key) {
        secretData[entry.key] = entry.value ?? "";
      }
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "Secret",
      name: values.name,
      data: secretData,
      // type is stored as a label on the backend
      labels: { type: values.type },
    });
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));

  const clusterMap = Object.fromEntries(
    (clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]),
  );
  const effectivePageSize = data?.pageSize ?? pageSize;

  // Extract known namespaces from loaded data
  const knownNamespaces = useMemo(
    () =>
      Array.from(new Set((data?.items ?? []).map((item) => item.namespace).filter(Boolean))).sort(),
    [data?.items],
  );

  // Client-side label filtering — ConfigResourceItem may not carry labels, so result may be empty
  const resolveItemLabels = (item: ConfigResourceItem): Record<string, string> | null | undefined => {
    const raw = item as ConfigResourceItem & { labels?: unknown };
    if (!raw.labels || typeof raw.labels !== "object" || Array.isArray(raw.labels)) {
      return undefined;
    }
    return raw.labels as Record<string, string>;
  };

  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          hasKnownCluster(clusterMap, item.clusterId) &&
          matchLabelExpressions(resolveItemLabels(item), mergedFilters),
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

  const columns: ColumnsType<ConfigResourceItem> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: ConfigResourceItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Secret", id: row.id })}>
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
      render: (_: unknown, record: ConfigResourceItem) => getClusterDisplayName(clusterMap, record.clusterId),
    },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    {
      title: "密钥项",
      dataIndex: "dataCount",
      key: "dataCount",
      width: TABLE_COL_WIDTH.type,
      render: (v: number) => <Tag color="purple">{v}</Tag>,
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      width: TABLE_COL_WIDTH.version,
      render: (v: number) => `v${v}`,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      align: "center",
      fixed: "right",
      render: (_: unknown, row: ConfigResourceItem) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 Secret"
          deleteContent={`确认删除 Secret「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "Secret",
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
        path="/configs/secrets"
        titleSuffix={<ResourceAddButton title="新增资源" onClick={() => { form.resetFields(); setModalOpen(true); }} />}
      />

      <Card>
        <ResourceClusterNamespaceFilters
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
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：secret-a app=web env=prod）"
          marginBottom={16}
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
            message="Secret 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<ConfigResourceItem>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={isLoading && !data}
          pagination={buildTablePagination({
            current: page,
            pageSize: effectivePageSize,
            total: data?.total ?? 0,
            disabled: isLoading && !data,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== effectivePageSize) {
                setPageSize(nextPageSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            },
          })}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <Modal
        title="添加 Secret"
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
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入 Secret 名称" }]}
          >
            <Input placeholder="例如：my-secret" />
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
            label="Secret 类型"
            name="type"
            initialValue="Opaque"
            rules={[{ required: true, message: "请选择 Secret 类型" }]}
          >
            <Select options={SECRET_TYPE_OPTIONS} placeholder="请选择类型" />
          </Form.Item>
          <Form.Item label="键值对数据">
            <Form.List name="entries" initialValue={[{ key: "", value: "" }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                      <Col flex="1">
                        <Form.Item
                          {...restField}
                          name={[name, "key"]}
                          style={{ marginBottom: 0 }}
                          rules={[{ required: true, message: "请输入键名" }]}
                        >
                          <Input placeholder="键（Key）" />
                        </Form.Item>
                      </Col>
                      <Col flex="1">
                        <Form.Item
                          {...restField}
                          name={[name, "value"]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input.Password placeholder="值（Value）" />
                        </Form.Item>
                      </Col>
                      <Col>
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                          disabled={fields.length === 1}
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ key: "", value: "" })}
                    icon={<PlusOutlined />}
                    style={{ width: "100%" }}
                  >
                    添加键值对
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
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
