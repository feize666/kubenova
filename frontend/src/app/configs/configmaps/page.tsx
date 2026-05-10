"use client";

import {
  DeleteOutlined,
  FileTextOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
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
import type { MenuProps } from "antd";
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
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  createConfig,
  deleteConfig,
  getConfigs,
  type ConfigResourceItem,
} from "@/lib/api/configs";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { NamespaceSelect } from "@/components/namespace-select";
import { ResourceAddButton } from "@/components/resource-add-button";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";

interface KVPair {
  key: string;
  value: string;
}

interface ConfigMapFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  entries: KVPair[];
}

export default function ConfigMapsPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<ConfigMapFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["configs", "configmaps", { clusterId, namespace, keyword, page, pageSize }, accessToken],
    queryFn: () =>
      getConfigs(
        "configmaps",
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
    () => [
      { label: "全部集群", value: "" },
      ...(clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    ],
    [clustersQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createConfig>[0]) =>
      createConfig(payload, accessToken!),
    onSuccess: async () => {
      void message.success("ConfigMap 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: ConfigMapFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const data: Record<string, string> = {};
    for (const entry of values.entries ?? []) {
      if (entry.key) {
        data[entry.key] = entry.value ?? "";
      }
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "ConfigMap",
      name: values.name,
      data,
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
      (data?.items ?? []).filter((item) =>
        matchLabelExpressions(resolveItemLabels(item), mergedFilters),
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

  const handleOpenCreate = () => {
    form.resetFields();
    setModalOpen(true);
  };

  const handleOpenYaml = (row: ConfigResourceItem) => {
    setYamlTarget({
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: "ConfigMap",
      name: row.name,
    });
  };

  const handleDelete = async (row: ConfigResourceItem) => {
    if (!accessToken) {
      return;
    }
    try {
      await deleteConfig(row.id, accessToken);
      void message.success("ConfigMap 删除成功");
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const buildActionItems = (): MenuProps["items"] => [
    { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, danger: true, label: "删除" },
  ];

  const handleActionClick = (row: ConfigResourceItem, key: string) => {
    if (key === "yaml") {
      handleOpenYaml(row);
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "删除 ConfigMap",
        content: `确认删除 ConfigMap「${row.name}」吗？此操作不可恢复。`,
        okText: "确认删除",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => void handleDelete(row),
      });
    }
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
          <Typography.Link onClick={() => setDetailTarget({ kind: "ConfigMap", id: row.id })}>
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
      title: "键数量",
      dataIndex: "dataCount",
      key: "dataCount",
      width: TABLE_COL_WIDTH.type,
      render: (v: number) => <Tag color="geekblue">{v}</Tag>,
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
      fixed: "right",
      align: "center",
      render: (_: unknown, row: ConfigResourceItem) => (
        <Dropdown
          menu={{
            items: buildActionItems(),
            onClick: ({ key }) => handleActionClick(row, key),
          }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <Button size="small" icon={<MoreOutlined />} aria-label="操作" />
        </Dropdown>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/configs/configmaps"
        titleSuffix={<ResourceAddButton title="新增资源" onClick={handleOpenCreate} />}
      />

      <Card>
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={6} lg={4}>
            <Select
              className="resource-filter-select"
              style={{ width: "100%" }}
              placeholder="全部集群"
              value={clusterId || undefined}
              onChange={(v) => {
                setClusterId(v ?? "");
                setPage(1);
              }}
              allowClear
              options={clusterFilterOptions}
              loading={clustersQuery.isLoading}
            />
          </Col>
          <Col xs={24} sm={12} md={5} lg={4}>
            <NamespaceSelect
              value={namespace}
              onChange={(v) => {
                setNamespace(v);
                setPage(1);
              }}
              knownNamespaces={knownNamespaces}
              clusterId={clusterId}
            />
          </Col>
          <Col xs={24} sm={16} md={7} lg={6}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder="按名称/标签搜索（示例：cm-a app=web env=prod）"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col xs={24} sm={12} md={4} lg={3}>
            <Space>
              <Button
                icon={<SearchOutlined />}
                type="primary"
                onClick={handleSearch}
              >
                查询
              </Button>
            </Space>
          </Col>
        </Row>

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
            message="ConfigMap 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<ConfigResourceItem>
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
        title="添加 ConfigMap"
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
            rules={[{ required: true, message: "请输入 ConfigMap 名称" }]}
          >
            <Input placeholder="例如：app-config" />
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
                          <Input placeholder="值（Value）" />
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
