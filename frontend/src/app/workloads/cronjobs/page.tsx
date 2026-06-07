"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined, FileTextOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/lib/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { ResourceTable } from "@/components/resource-table";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
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
  buildWorkloadSafeEditPatch,
  createWorkload,
  deleteWorkload,
  formatWorkloadKeyValueText,
  getWorkloadsByKind,
  getWorkloadPrimaryImage,
  patchWorkloadById,
  type WorkloadListItem,
} from "@/lib/api/workloads";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { WorkloadStateTag } from "@/components/workloads/workload-table-cells";

function stateTag(state: string) {
  if (state === "active") return <WorkloadStateTag tone="success" label="调度中" />;
  if (state === "disabled") return <WorkloadStateTag tone="warning" label="暂停" />;
  return <WorkloadStateTag tone="danger" label="已删除" />;
}

const STATE_FILTER_OPTIONS = [
  { label: "调度中", value: "active" },
  { label: "暂停", value: "disabled" },
  { label: "已删除", value: "deleted" },
];

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function selectMatches(value: unknown, filterValue: unknown) {
  return !filterValue || value === filterValue;
}

// CronJob 的 spec 可能含 schedule 字段
type CronJobItem = WorkloadListItem & { spec?: Record<string, unknown> & { schedule?: string; lastScheduleTime?: string } };

interface FormValues {
  name: string;
  namespace: string;
  clusterId: string;
  schedule: string;
  image?: string;
  labelsText?: string;
  annotationsText?: string;
}

export default function CronJobsPage() {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getPaginationConfig,
    getSortableColumnProps,
    handleTableChange,
  } = useAntdTableSortPagination<CronJobItem>({
    defaultPageSize: 10,
  });
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CronJobItem | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const queryKey = [
    "workloads",
    "CronJob",
    { clusterId, keyword, namespace, page: pagination.pageIndex + 1, pageSize: pagination.pageSize, sortBy, sortOrder },
    accessToken,
  ];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      getWorkloadsByKind(
        "CronJob",
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
    [data?.items, mergedFilters],
  );
  const filteredTableData = useMemo(() => {
    const nameFilter = getTextFilter(tableFilters, "name");
    const clusterFilter = getTextFilter(tableFilters, "clusterId");
    const namespaceFilter = getTextFilter(tableFilters, "namespace");
    const scheduleFilter = getTextFilter(tableFilters, "schedule");
    const lastScheduleTimeFilter = getTextFilter(tableFilters, "lastScheduleTime");
    const createdAtFilter = getTextFilter(tableFilters, "createdAt");
    const stateFilter = tableFilters.state;

    return tableData.filter((item) => (
      textMatches(item.name, nameFilter) &&
      textMatches(`${item.clusterId} ${getClusterDisplayName(clusterMap, item.clusterId)}`, clusterFilter) &&
      textMatches(item.namespace, namespaceFilter) &&
      textMatches(item.spec?.schedule, scheduleFilter) &&
      textMatches(item.spec?.lastScheduleTime, lastScheduleTimeFilter) &&
      textMatches(item.createdAt, createdAtFilter) &&
      selectMatches(item.state, stateFilter)
    ));
  }, [clusterMap, tableData, tableFilters]);
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(filteredTableData.map((item) => item.name), { max: 320 }),
    [filteredTableData],
  );

  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({ clusterId, namespace, keyword });

  const openAddModal = () => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    setEditingItem(null);
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
        const patch = buildWorkloadSafeEditPatch(editingItem, "CronJob", values, {
          includeImage: true,
          includeSchedule: true,
        });
        await patchWorkloadById(
          editingItem.id,
          patch,
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
            spec: { schedule: values.schedule },
          },
          accessToken!,
        );
        void message.success("CronJob 创建成功");
      }
      setModalOpen(false);
      setEditingItem(null);
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

  const openEditModal = (item: CronJobItem) => {
    setEditingItem(item);
    form.resetFields();
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      schedule: item.spec?.schedule ?? "",
      image: getWorkloadPrimaryImage(item, "CronJob"),
      labelsText: formatWorkloadKeyValueText(item.labels),
      annotationsText: formatWorkloadKeyValueText(item.annotations),
    });
    setModalOpen(true);
  };

  const buildRowActions = (): MenuProps["items"] =>
    buildResourceActionMenuItems([
      { key: "describe", icon: <EyeOutlined />, label: "描述" },
      { key: "edit", icon: <EditOutlined />, label: "编辑" },
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
    if (key === "edit") {
      openEditModal(row);
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

  const columns: Array<HeadlampResourceTableColumn<CronJobItem>> = [
    {
      title: "定时任务",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "以名称过滤" },
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
      ...getSortableColumnProps("name"),
    },
    { title: "集群", dataIndex: "clusterId", key: "clusterId", filter: { type: "text", placeholder: "以集群过滤" }, width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: CronJobItem) => getClusterDisplayName(clusterMap, row.clusterId), ...getSortableColumnProps("clusterId") },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", filter: { type: "text", placeholder: "以命名空间过滤" }, width: TABLE_COL_WIDTH.namespace, ...getSortableColumnProps("namespace") },
    {
      title: "调度表达式",
      key: "schedule",
      filter: { type: "text", placeholder: "以 Cron 过滤" },
      width: TABLE_COL_WIDTH.schedule,
      render: (_: unknown, record: CronJobItem) => record.spec?.schedule ?? "-",
      sorter: (a, b) => (a.spec?.schedule ?? "").localeCompare(b.spec?.schedule ?? ""),
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "最近执行",
      key: "lastScheduleTime",
      filter: { type: "text", placeholder: "以时间过滤" },
      width: TABLE_COL_WIDTH.time,
      render: (_: unknown, record: CronJobItem) => {
        const t = record.spec?.lastScheduleTime;
        return <ResourceTimeCell value={t} now={now} mode="relative" />;
      },
      sorter: (a, b) => (a.spec?.lastScheduleTime ?? "").localeCompare(b.spec?.lastScheduleTime ?? ""),
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      filter: { type: "status", placeholder: "以状态过滤", options: STATE_FILTER_OPTIONS },
      width: TABLE_COL_WIDTH.status,
      render: (value: string) => stateTag(value),
      ...getSortableColumnProps("state"),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      filter: { type: "text", placeholder: "以时间过滤" },
      width: TABLE_COL_WIDTH.time,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
      ...getSortableColumnProps("createdAt"),
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      align: "left",
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
          titleSuffix={<ResourceAddButton onClick={openAddModal} aria-label="创建CronJob" />}
        />

        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <ResourceScopeFilterButton
            clusterId={clusterId}
            namespace={namespace}
            clusterOptions={clusterOptions}
            clusterLoading={clustersQuery.isLoading}
            knownNamespaces={knownNamespaces}
            namespaceDisabled={namespaceDisabled}
            namespacePlaceholder={namespacePlaceholder}
            onApply={({ clusterId: nextClusterId, namespace: nextNamespace }) => {
              onScopeChange(nextClusterId, nextNamespace);
              resetPage();
            }}
          />

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

          <ResourceTable<CronJobItem>
            bordered
            rowKey="id"
            tableKey="workloads.cronjobs"
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
            globalSearch={{
              value: keywordInput,
              onChange: handleGlobalSearchChange,
              placeholder: "按名称/标签搜索（示例：app-a app=web env=prod）",
            }}
            filters={tableFilters}
            onFiltersChange={(nextFilters) => {
              setTableFilters(nextFilters);
              resetPage();
            }}
            sort={{ sortBy, sortOrder }}
            columns={columns}
            dataSource={filteredTableData}
            loading={isLoading && !data}
            onChange={(paginationInfo, filters, sorter, extra) =>
              handleTableChange(paginationInfo, filters, sorter, extra, isLoading && !data)
            }
            pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
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
            <Input placeholder="例如：default" disabled={Boolean(editingItem)} />
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
          {editingItem ? (
            <>
              <Form.Item label="主容器镜像" name="image">
                <Input placeholder="registry.example.com/cronjob:tag" />
              </Form.Item>
              <Form.Item label="Labels" name="labelsText">
                <Input.TextArea rows={4} placeholder={"job=report\nenv=prod"} />
              </Form.Item>
              <Form.Item label="Annotations" name="annotationsText">
                <Input.TextArea rows={4} placeholder={"description=daily-report\nowner=team-a"} />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        onNavigateRequest={(request) => setDetailTarget(request)}
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
