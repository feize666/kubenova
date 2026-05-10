"use client";

import { DeleteOutlined, EyeOutlined, FileTextOutlined, SearchOutlined } from "@ant-design/icons";
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
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";

function stateTag(state: string) {
  if (state === "active") return <Tag color="green">调度中</Tag>;
  if (state === "disabled") return <Tag color="gold">暂停</Tag>;
  return <Tag color="red">已删除</Tag>;
}

// CronJob 的 spec 可能含 schedule 字段
type CronJobItem = WorkloadListItem & { spec?: { schedule?: string; lastScheduleTime?: string } };

interface FormValues {
  name: string;
  namespace: string;
  clusterId: string;
  schedule: string;
}

export default function CronJobsPage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CronJobItem | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const queryKey = ["workloads", "CronJob", { clusterId, keyword, namespace, page, pageSize }, accessToken];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      getWorkloadsByKind(
        "CronJob",
        { clusterId: clusterId || undefined, keyword: keyword.trim() || undefined, namespace: namespace.trim() || undefined, page, pageSize },
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
    () => [
      { label: "全部集群", value: "" },
      ...(clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    ],
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

  const openAddModal = () => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (item: CronJobItem) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      schedule: item.spec?.schedule ?? "",
    });
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
          { namespace: values.namespace },
          accessToken!,
        );
        void message.success("CronJob 更新成功");
      } else {
        await createWorkload(
          {
            clusterId: values.clusterId,
            namespace: values.namespace,
            kind: "CronJob",
            name: values.name,
          },
          accessToken!,
        );
        void message.success("CronJob 创建成功");
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

  const handleDelete = async (item: CronJobItem) => {
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

  const handleRowAction = (row: CronJobItem, key: string) => {
    if (key === "describe") {
      if (row.id) {
        setDetailTarget({ kind: "CronJob", id: row.id });
      }
      return;
    }
    if (key === "yaml") {
      setYamlTarget({
        clusterId: row.clusterId,
        namespace: row.namespace,
        kind: "CronJob",
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

  const columns: ColumnsType<CronJobItem> = [
    {
      title: "定时任务",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: CronJobItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "CronJob", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
    },
    { title: "集群", dataIndex: "clusterId", key: "clusterId", width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: CronJobItem) => getClusterDisplayName(clusterMap, row.clusterId) },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    {
      title: "调度表达式",
      key: "schedule",
      width: TABLE_COL_WIDTH.schedule,
      render: (_: unknown, record: CronJobItem) => record.spec?.schedule ?? "-",
    },
    {
      title: "最近执行",
      key: "lastScheduleTime",
      width: TABLE_COL_WIDTH.time,
      render: (_: unknown, record: CronJobItem) => {
        const t = record.spec?.lastScheduleTime;
        return <ResourceTimeCell value={t} now={now} mode="relative" />;
      },
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (value: string) => stateTag(value),
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
      render: (_: unknown, row: CronJobItem) => (
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
          path="/workloads/cronjobs"
          embedded
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton onClick={openAddModal} aria-label="新增资源" />}
        />

        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={12} md={6} lg={4}>
              <Select
                style={{ width: "100%" }}
                placeholder="全部集群"
                value={clusterId || undefined}
                onChange={(v) => { setClusterId(v ?? ""); setPage(1); }}
                allowClear
                options={clusterOptions}
                loading={clustersQuery.isLoading}
              />
            </Col>
            <Col xs={24} sm={12} md={5} lg={4}>
              <NamespaceSelect
                value={namespace}
                onChange={(v) => { setNamespace(v); setPage(1); }}
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
              message="定时任务加载失败"
              description={error instanceof Error ? error.message : "请求失败"}
            />
          ) : null}

          <Table<CronJobItem>
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
        </Space>
      </Card>

      <Modal
        title={editingItem ? "编辑 CronJob" : "新增资源"}
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
            rules={[{ required: true, message: "请输入 CronJob 名称" }]}
          >
            <Input placeholder="例如：daily-report" disabled={Boolean(editingItem)} />
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
            label="调度表达式（Cron）"
            name="schedule"
            rules={[{ required: true, message: "请输入 Cron 表达式" }]}
          >
            <Input placeholder="例如：0 2 * * *（每天凌晨 2 点）" />
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
