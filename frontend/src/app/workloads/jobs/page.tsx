"use client";

import { DeleteOutlined, EyeOutlined, FileTextOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import {
  buildResourceActionMenuItems,
  matchLabelExpressions,
  parseResourceSearchInput,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import {
  createWorkload,
  deleteWorkload,
  getWorkloadsByKind,
  patchWorkloadById,
  type WorkloadListItem,
} from "@/lib/api/workloads";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { NamespaceSelect } from "@/components/namespace-select";
import { ClusterSelect } from "@/components/cluster-select";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";

function stateTag(state: string) {
  if (state === "active") return <Tag color="green">运行中</Tag>;
  if (state === "disabled") return <Tag color="gold">已暂停</Tag>;
  return <Tag color="red">已删除</Tag>;
}

interface FormValues {
  name: string;
  namespace: string;
  clusterId: string;
  replicas: number;
}

export default function JobsPage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getPaginationConfig,
    getSortableColumnProps,
    handleTableChange,
  } = useAntdTableSortPagination<WorkloadListItem>({
    defaultPageSize: 10,
  });
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkloadListItem | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const queryKey = [
    "workloads",
    "Job",
    { clusterId, keyword, namespace, page: pagination.pageIndex + 1, pageSize: pagination.pageSize, sortBy, sortOrder },
    accessToken,
  ];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      getWorkloadsByKind(
        "Job",
        {
          clusterId: clusterId || undefined,
          keyword: keyword.trim() || undefined,
          namespace: namespace.trim() || undefined,
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
    queryKey: ["clusters", "list", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name])),
    [clustersQuery.data],
  );

  const clusterSelectOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );

  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
    [data],
  );
  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
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

  const openAddModal = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ replicas: 1 });
    setModalOpen(true);
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleModalSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        await patchWorkloadById(
          editingItem.id,
          { namespace: values.namespace, replicas: values.replicas },
          accessToken!,
        );
        void message.success("Job 更新成功");
      } else {
        await createWorkload(
          {
            clusterId: values.clusterId,
            namespace: values.namespace,
            kind: "Job",
            name: values.name,
            replicas: values.replicas,
          },
          accessToken!,
        );
        void message.success("Job 创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: WorkloadListItem) => {
    try {
      await deleteWorkload(item.id, accessToken!);
      void message.success(`${item.name} 删除成功`);
      void refetch();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const buildRowActions = (): MenuProps["items"] =>
    buildResourceActionMenuItems([
      { key: "describe", icon: <EyeOutlined />, label: "描述" },
      { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
    ]);

  const handleRowAction = (row: WorkloadListItem, key: string) => {
    if (key === "describe") {
      if (row.id) {
        setDetailTarget({ kind: "Job", id: row.id });
      }
      return;
    }
    if (key === "yaml") {
      setYamlTarget({
        clusterId: row.clusterId,
        namespace: row.namespace,
        kind: "Job",
        name: row.name,
      });
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "确认删除",
        content: `删除 ${row.name} 后将不可恢复`,
        okText: "确认",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => void handleDelete(row),
      });
    }
  };

  const columns: ColumnsType<WorkloadListItem> = [
    {
      title: "任务名",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: WorkloadListItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Job", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
      ...getSortableColumnProps("name"),
    },
    { title: "集群", dataIndex: "clusterId", key: "clusterId", width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: WorkloadListItem) => getClusterDisplayName(clusterMap, row.clusterId), ...getSortableColumnProps("clusterId") },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace, ...getSortableColumnProps("namespace") },
    { title: "完成数", dataIndex: "readyReplicas", key: "readyReplicas", width: TABLE_COL_WIDTH.ready, ...getSortableColumnProps("readyReplicas") },
    { title: "期望完成", dataIndex: "replicas", key: "replicas", width: TABLE_COL_WIDTH.replicas, ...getSortableColumnProps("replicas") },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (value: string) => stateTag(value),
      ...getSortableColumnProps("state"),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
      ...getSortableColumnProps("createdAt"),
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      align: "left",
      fixed: "right",
      render: (_: unknown, row: WorkloadListItem) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
          menu={{
            items: buildRowActions(),
            onClick: ({ key }) => handleRowAction(row, String(key)),
          }}
        >
          {renderResourceActionTriggerButton({
            ariaLabel: "更多操作",
            baseClassName: POD_ACTION_TRIGGER_CLASS,
          })}
        </Dropdown>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/workloads/jobs"
          embedded
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton onClick={openAddModal} aria-label="新增资源" />}
        />

        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={12} md={6} lg={4}>
              <ClusterSelect
                value={clusterId}
                onChange={(v) => { setClusterId(v); resetPage(); }}
                options={clusterOptions}
                loading={clustersQuery.isLoading}
              />
            </Col>
            <Col xs={24} sm={12} md={5} lg={4}>
              <NamespaceSelect
                value={namespace}
                onChange={(v) => { setNamespace(v); resetPage(); }}
                knownNamespaces={knownNamespaces}
                clusterId={clusterId}
              />
            </Col>
            <Col xs={24} sm={16} md={7} lg={6}>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder="按名称/标签搜索（示例：app-a app=web env=prod）"
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
            <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" />
          ) : null}

          {isError ? (
            <Alert
              type="error"
              showIcon
              message="任务加载失败"
              description={error instanceof Error ? error.message : "请求失败"}
            />
          ) : null}

          <Table<WorkloadListItem>
            className="pod-table"
            bordered
            rowKey="id"
            columns={columns}
            dataSource={tableData}
            loading={isLoading && !data}
            onChange={(paginationInfo, filters, sorter, extra) =>
              handleTableChange(paginationInfo, filters, sorter, extra, isLoading && !data)
            }
            pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
            scroll={{ x: getTableScrollX(columns) }}
          />
        </Space>
      </Card>

      <Modal
        title={editingItem ? "编辑 Job" : "新增资源"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={handleModalCancel}
        okText={editingItem ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入 Job 名称" }]}
          >
            <Input placeholder="例如：batch-job-1" disabled={Boolean(editingItem)} />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            label="集群"
            name="clusterId"
            rules={[{ required: true, message: "请选择集群" }]}
          >
            <Select
              placeholder="请选择集群"
              options={clusterSelectOptions}
              loading={clustersQuery.isLoading}
              disabled={Boolean(editingItem)}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            label="并行数（replicas）"
            name="replicas"
            rules={[{ required: true, message: "请输入并行数" }]}
          >
            <InputNumber min={1} style={{ width: "100%" }} placeholder="默认 1" />
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
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
