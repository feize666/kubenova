"use client";

import { DeleteOutlined, EyeOutlined, FileTextOutlined, ReloadOutlined, RetweetOutlined, RollbackOutlined, StopOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Card,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/lib/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
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
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  applyWorkloadActionById,
  createWorkload,
  deleteWorkload,
  getWorkloadsByKind,
  patchWorkloadById,
  type WorkloadListItem,
} from "@/lib/api/workloads";
import { type ResourceDetailRequest, type ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";
import {
  runScaleConvergence,
  type ScaleConvergenceRound,
} from "@/lib/workloads/scale-convergence";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { OpsStatusTag } from "@/components/ops/ops-status";

function stateTag(state: string) {
  if (state === "active") return <OpsStatusTag tone="success">启用</OpsStatusTag>;
  if (state === "disabled") return <OpsStatusTag tone="neutral">禁用</OpsStatusTag>;
  return <OpsStatusTag tone="danger">已删除</OpsStatusTag>;
}

const STATE_FILTER_OPTIONS = [
  { label: "启用", value: "active" },
  { label: "禁用", value: "disabled" },
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

interface FormValues {
  name: string;
  namespace: string;
  clusterId: string;
  replicas: number;
}

type ReplicaSetAction = "scale" | "restart" | "rollback" | "enable" | "disable";

interface ScaleConvergenceViewState {
  workloadName: string;
  round: ScaleConvergenceRound;
}

export default function ReplicaSetsPage() {
  const { message } = App.useApp();
  const router = useRouter();
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
  } = useAntdTableSortPagination<WorkloadListItem>({
    defaultPageSize: 10,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem] = useState<WorkloadListItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [scaleItem, setScaleItem] = useState<WorkloadListItem | null>(null);
  const [targetReplicas, setTargetReplicas] = useState(1);
  const [scaleConvergence, setScaleConvergence] = useState<ScaleConvergenceViewState | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const queryKey = [
    "workloads",
    "ReplicaSet",
    { clusterId, keyword, namespace, page: pagination.pageIndex + 1, pageSize: pagination.pageSize, sortBy, sortOrder },
    accessToken,
  ];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      getWorkloadsByKind(
        "ReplicaSet",
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
    const replicasFilter = getTextFilter(tableFilters, "replicas");
    const readyFilter = getTextFilter(tableFilters, "readyReplicas");
    const createdAtFilter = getTextFilter(tableFilters, "createdAt");
    const stateFilter = tableFilters.state;

    return tableData.filter((item) => (
      textMatches(item.name, nameFilter) &&
      textMatches(`${item.clusterId} ${getClusterDisplayName(clusterMap, item.clusterId)}`, clusterFilter) &&
      textMatches(item.namespace, namespaceFilter) &&
      textMatches(item.replicas, replicasFilter) &&
      textMatches(item.readyReplicas, readyFilter) &&
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
        void message.success("ReplicaSet 更新成功");
      } else {
        await createWorkload(
          {
            clusterId: values.clusterId,
            namespace: values.namespace,
            kind: "ReplicaSet",
            name: values.name,
            replicas: values.replicas,
          },
          accessToken!,
        );
        void message.success("ReplicaSet 创建成功");
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

  const resolveIdentity = (item: WorkloadListItem): ResourceIdentity => {
    const urlClusterId = searchParams.get("clusterId")?.trim();
    const urlNamespace = searchParams.get("namespace")?.trim();
    const urlKind = searchParams.get("kind")?.trim();
    return {
      clusterId: urlClusterId || item.clusterId || clusterId,
      namespace: urlNamespace || item.namespace || namespace,
      kind: urlKind || "ReplicaSet",
      name: item.name,
    };
  };

  const actionMutation = useMutation({
    mutationFn: async ({
      item,
      action,
      replicas,
    }: {
      item: WorkloadListItem;
      action: ReplicaSetAction;
      replicas?: number;
    }) =>
      applyWorkloadActionById(
        item.id,
        action,
        typeof replicas === "number" ? { replicas } : undefined,
        accessToken!,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleScale = async () => {
    if (!scaleItem) {
      return;
    }
    const selected = scaleItem;
    const target = Math.max(0, Math.trunc(targetReplicas));
    setScaleItem(null);
    try {
      const result = await actionMutation.mutateAsync({ item: selected, action: "scale", replicas: target });
      if (!result.accepted) {
        throw new Error(result.message || "扩缩容请求未被接受");
      }
      await runScaleConvergence({
        desiredReplicas: target,
        initialObservedState: {
          desiredReplicas: result.scaleResult?.desiredReplicas ?? target,
          observedReplicas: result.scaleResult?.observedReplicas ?? result.record.replicas ?? selected.replicas,
          readyReplicas: result.scaleResult?.readyReplicas ?? result.record.readyReplicas ?? selected.readyReplicas,
          availableReplicas: result.scaleResult?.availableReplicas ?? null,
          observedAt: result.scaleResult?.observedAt,
          status: result.scaleResult?.status,
        },
        refetch,
        resolveObservedState: (payload) => {
          const latest = payload?.items?.find((item) => item.id === selected.id);
          if (!latest) {
            return null;
          }
          return {
            desiredReplicas: target,
            observedReplicas: latest.replicas,
            readyReplicas: latest.readyReplicas,
            observedAt: latest.updatedAt,
          };
        },
        onRound: (round) => {
          setScaleConvergence({ workloadName: selected.name, round });
        },
        timeoutMs: 60_000,
      });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "扩缩容失败，请重试");
    }
  };

  const handleWorkloadAction = async (
    item: WorkloadListItem,
    action: Exclude<ReplicaSetAction, "scale">,
  ) => {
    try {
      await actionMutation.mutateAsync({ item, action });
      const actionText =
        action === "restart"
          ? "重启"
          : action === "rollback"
            ? "回滚"
            : action === "enable"
              ? "启用"
              : "禁用";
      void message.success(`${item.name} ${actionText}操作已提交`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    }
  };

  const buildRowActions = (row: WorkloadListItem): MenuProps["items"] => {
    const active = row.state === "active";
    return buildResourceActionMenuItems([
      { key: "describe", icon: <EyeOutlined />, label: "描述" },
      { key: "scale", icon: <RetweetOutlined />, label: "扩缩容" },
      { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
      { key: "restart", icon: <ReloadOutlined />, label: "重启", disabled: !active },
      { key: "rollback", icon: <RollbackOutlined />, label: "回滚", disabled: !active },
      { key: active ? "disable" : "enable", icon: <StopOutlined />, label: active ? "禁用" : "启用" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
    ]);
  };

  const handleRowAction = (row: WorkloadListItem, key: string) => {
    if (key === "describe") {
      if (row.id) setDetailTarget({ kind: "ReplicaSet", id: row.id });
      return;
    }
    if (key === "scale") {
      setScaleItem(row);
      setTargetReplicas(row.replicas);
      return;
    }
    if (key === "yaml") {
      setYamlTarget(resolveIdentity(row));
      return;
    }
    if (key === "restart" || key === "rollback" || key === "enable" || key === "disable") {
      void handleWorkloadAction(row, key as Exclude<ReplicaSetAction, "scale">);
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

  const columns: Array<HeadlampResourceTableColumn<WorkloadListItem>> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "以名称过滤" },
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: WorkloadListItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "ReplicaSet", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
      ...getSortableColumnProps("name"),
    },
    { title: "集群", dataIndex: "clusterId", key: "clusterId", filter: { type: "text", placeholder: "以集群过滤" }, width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: WorkloadListItem) => getClusterDisplayName(clusterMap, row.clusterId), ...getSortableColumnProps("clusterId") },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", filter: { type: "text", placeholder: "以命名空间过滤" }, width: TABLE_COL_WIDTH.namespace, ...getSortableColumnProps("namespace") },
    { title: "期望副本", dataIndex: "replicas", key: "replicas", filter: { type: "text", placeholder: "过滤" }, width: TABLE_COL_WIDTH.replicas, ...getSortableColumnProps("replicas") },
    { title: "实际副本", dataIndex: "readyReplicas", key: "readyReplicas", filter: { type: "text", placeholder: "过滤" }, width: TABLE_COL_WIDTH.ready, ...getSortableColumnProps("readyReplicas") },
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
      render: (_: unknown, row: WorkloadListItem) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
          menu={{
            items: buildRowActions(row),
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
          path="/workloads/replicasets"
          embedded
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton onClick={() => router.push("/workloads/create?kind=ReplicaSet")} aria-label="创建ReplicaSet" />}
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
              message="副本集加载失败"
              description={error instanceof Error ? error.message : "请求失败"}
            />
          ) : null}

          {scaleConvergence ? (
            <Alert
              type={
                scaleConvergence.round.status === "stable"
                  ? "success"
                  : scaleConvergence.round.status === "timeout"
                    ? "warning"
                    : "info"
              }
              showIcon
              closable
              onClose={() => setScaleConvergence(null)}
              message={
                scaleConvergence.round.status === "accepted"
                  ? `${scaleConvergence.workloadName} 扩缩容请求已受理`
                  : scaleConvergence.round.status === "converging"
                    ? `${scaleConvergence.workloadName} 正在收敛到目标副本`
                    : scaleConvergence.round.status === "stable"
                      ? `${scaleConvergence.workloadName} 副本已稳定`
                      : `${scaleConvergence.workloadName} 收敛超时，持续显示最新观测值`
              }
              description={
                scaleConvergence.round.status === "accepted"
                  ? `期望副本 ${scaleConvergence.round.observed.desiredReplicas}，当前副本 ${scaleConvergence.round.observed.observedReplicas ?? "-"}，就绪副本 ${scaleConvergence.round.observed.readyReplicas ?? "-"}`
                  : `第 ${scaleConvergence.round.attempt}/${scaleConvergence.round.maxAttempts} 轮确认：期望副本 ${scaleConvergence.round.observed.desiredReplicas}，当前副本 ${scaleConvergence.round.observed.observedReplicas ?? "-"}，就绪副本 ${scaleConvergence.round.observed.readyReplicas ?? "-"}`
              }
            />
          ) : null}

          <ResourceTable<WorkloadListItem>
            bordered
            rowKey="id"
            tableKey="workloads.replicasets"
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
            loading={(isLoading && !data) || actionMutation.isPending}
            onChange={(paginationInfo, filters, sorter, extra) =>
              handleTableChange(paginationInfo, filters, sorter, extra, (isLoading && !data) || actionMutation.isPending)
            }
            pagination={getPaginationConfig(data?.total ?? 0, (isLoading && !data) || actionMutation.isPending)}
          />
        </Space>
      </Card>

      <Modal
        title={editingItem ? "编辑 ReplicaSet" : "新增资源"}
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
            rules={[{ required: true, message: "请输入 ReplicaSet 名称" }]}
          >
            <Input placeholder="例如：my-app-rs" disabled={Boolean(editingItem)} />
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
            label="副本数"
            name="replicas"
            rules={[{ required: true, message: "请输入副本数" }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} placeholder="默认 1" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="调整副本数"
        open={Boolean(scaleItem)}
        onCancel={() => setScaleItem(null)}
        onOk={() => void handleScale()}
        okText="提交"
        cancelText="取消"
        confirmLoading={actionMutation.isPending}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text>
            资源：<Typography.Text strong>{scaleItem?.name ?? "-"}</Typography.Text>
          </Typography.Text>
          <Typography.Text>目标副本：</Typography.Text>
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            value={targetReplicas}
            onChange={(value) => setTargetReplicas(typeof value === "number" ? value : 0)}
          />
        </Space>
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
          void queryClient.invalidateQueries({ queryKey });
        }}
      />
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
