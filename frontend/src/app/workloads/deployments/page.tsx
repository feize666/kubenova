"use client";

import {
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RollbackOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ColumnDef } from "@tanstack/react-table";
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  buildResourceActionMenuItems,
  renderResourceActionTriggerButton,
  renderPodLikeResourceActionStyles,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import {
  applyWorkloadActionById,
  applyWorkloadAction,
  disableWorkload,
  enableWorkload,
  getWorkloads,
  patchWorkloadById,
  type WorkloadItem,
  type WorkloadsListResponse,
  type WorkloadState,
  type WorkloadStatus,
} from "@/lib/api/workloads";
import { type ResourceDetailRequest, type ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { NamespaceSelect } from "@/components/namespace-select";
import { ClusterSelect } from "@/components/cluster-select";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  runScaleConvergence,
  type ScaleConvergenceRound,
} from "@/lib/workloads/scale-convergence";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";

type WorkloadAction =
  | "scale"
  | "restart"
  | "rollback"
  | "delete"
  | "suspend"
  | "unsuspend"
  | "policy-disable"
  | "policy-enable"
  | "disable"
  | "enable";

type WorkloadMutationTarget = {
  id?: string;
  name: string;
  clusterId: string;
  namespace: string;
};

type DeploymentStatus = "运行中" | "收敛中" | "异常";

type DeploymentRow = {
  key: string;
  id: string;
  原始名称: string;
  集群: string;
  名称: string;
  名称空间: string;
  副本数: number;
  就绪数: number;
  可用数: number;
  策略: string;
  修订版本: number;
  状态: DeploymentStatus;
  启用状态: "启用" | "禁用";
  资源状态: WorkloadState;
  创建时间: string;
  labels?: Record<string, string>;
};

const 状态颜色: Record<DeploymentStatus, string> = {
  运行中: "success",
  收敛中: "processing",
  异常: "error",
};

function parseReplicaPair(value: string): { current: number; desired: number } {
  const [currentRaw, desiredRaw] = value.split("/");
  const current = Number(currentRaw);
  const desired = Number(desiredRaw);
  return {
    current: Number.isFinite(current) ? current : 0,
    desired: Number.isFinite(desired) ? desired : 0,
  };
}

function mapStatus(status: WorkloadStatus): DeploymentStatus {
  if (status === "Running") {
    return "运行中";
  }
  if (status === "Pending" || status === "Degraded") {
    return "收敛中";
  }
  return "异常";
}

function mapItemToRow(item: WorkloadItem): DeploymentRow {
  const { current, desired } = parseReplicaPair(item.replicas);
  return {
    key: `${item.clusterId}/${item.namespace}/${item.name}`,
    id: (item as WorkloadItem & { id?: string }).id ?? "",
    原始名称: item.name,
    集群: item.clusterId,
    名称: item.name,
    名称空间: item.namespace,
    副本数: desired,
    就绪数: current,
    可用数: current,
    策略: "RollingUpdate",
    修订版本: item.version,
    状态: mapStatus(item.status),
    启用状态: item.state === "disabled" ? "禁用" : "启用",
    资源状态: item.state,
    创建时间: item.age,
    labels: (item as WorkloadItem & { labels?: Record<string, string> }).labels,
  };
}

interface DeploymentFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  replicas: number;
}

interface ScaleConvergenceViewState {
  workloadName: string;
  round: ScaleConvergenceRound;
}

function extractScaleSnapshot(item: WorkloadItem): { observedReplicas: number; readyReplicas: number } {
  const { current, desired } = parseReplicaPair(item.replicas);
  return {
    observedReplicas: desired,
    readyReplicas: current,
  };
}

export default function DeploymentsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const [clusterId, setClusterId] = useState("");
  const [关键字, set关键字] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<DeploymentRow>({
    defaultPageSize: 6,
  });
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [扩缩容行, set扩缩容行] = useState<DeploymentRow | null>(null);
  const editingRow = 扩缩容行;
  const [目标副本, set目标副本] = useState<number>(1);
  const [scaleConvergence, setScaleConvergence] = useState<ScaleConvergenceViewState | null>(null);
  const [yaml目标, setYaml目标] = useState<ResourceIdentity | null>(null);

  // CRUD Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<DeploymentFormValues>();

  const workloadsKey = ["workloads", "deployments", clusterId, 关键字, namespace, pagination.pageIndex + 1, pagination.pageSize, sortBy, sortOrder, accessToken];

  const query = useQuery({
    queryKey: workloadsKey,
    queryFn: () =>
      getWorkloads(
        "deployments",
        {
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
          keyword: 关键字.trim() || undefined,
          namespace: namespace.trim() || undefined,
          clusterId: clusterId || undefined,
        },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  // 集群列表（供筛选下拉和 Modal clusterId 选择）
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

  // Modal 中仅显示不带"全部集群"的选项
  const clusterSelectOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );

  const refreshDeploymentSnapshots = async (focusId?: string) => {
    if (focusId) {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key) || key.length < 3) return false;
          if (key[0] !== "resource-detail") return false;
          const kind = String(key[1] ?? "").toLowerCase();
          return kind === "deployment" && key[2] === focusId;
        },
      });
    }
    await queryClient.invalidateQueries({ queryKey: ["workloads", "deployments"] });
    await queryClient.invalidateQueries({ queryKey: ["workloads", "pods"] });
  };

  const actionMutation = useMutation({
    mutationFn: async (payload: WorkloadMutationTarget & { action: WorkloadAction; replicas?: number }) => {
      if (payload.action === "disable" || payload.action === "enable") {
        if (payload.action === "disable") {
          return disableWorkload("deployments", payload.name, accessToken!, {
            clusterId: payload.clusterId,
            namespace: payload.namespace,
          });
        }
        return enableWorkload("deployments", payload.name, accessToken!, {
          clusterId: payload.clusterId,
          namespace: payload.namespace,
        });
      }
      if (payload.action === "scale" && payload.id) {
        return applyWorkloadActionById(
          payload.id,
          "scale",
          { replicas: payload.replicas },
          accessToken!,
        );
      }
      return applyWorkloadAction("deployments", payload.name, {
        action: payload.action,
        replicas: payload.action === "scale" ? payload.replicas : undefined,
        clusterId: payload.clusterId,
        namespace: payload.namespace,
      }, accessToken!);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: workloadsKey });
      const previous = queryClient.getQueryData<WorkloadsListResponse>(workloadsKey);

      queryClient.setQueryData<WorkloadsListResponse>(workloadsKey, (old) => {
        if (!old) {
          return old;
        }

        const items: WorkloadItem[] = old.items
          .map((item) => {
            if (
              item.name !== payload.name ||
              item.clusterId !== payload.clusterId ||
              item.namespace !== payload.namespace
            ) {
              return item;
            }
            if (payload.action === "delete") {
              return { ...item, state: "deleted" as const, status: "Failed" as const, version: item.version + 1 };
            }
            if (payload.action === "scale") {
              const nextReplicas = Math.max(0, payload.replicas ?? 0);
              const { current: currentReady } = parseReplicaPair(item.replicas);
              return {
                ...item,
                replicas: `${Math.min(currentReady, nextReplicas)}/${nextReplicas}`,
                status: "Pending" as const,
                version: item.version + 1,
              };
            }
            if (payload.action === "restart" || payload.action === "rollback") {
              return { ...item, status: "Pending" as const, version: item.version + 1 };
            }
            if (payload.action === "disable") {
              return { ...item, state: "disabled" as const, version: item.version + 1 };
            }
            if (payload.action === "enable") {
              return { ...item, state: "active" as const, version: item.version + 1 };
            }
            return { ...item, version: item.version + 1 };
          })
          .filter((item) => item.state !== "deleted");

        return { ...old, items, total: old.total };
      });

      return { previous };
    },
    onError: (_error, payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workloadsKey, context.previous);
      }
      message.error(`${payload.name} 操作失败，已回滚`);
    },
    onSuccess: (data, payload) => {
      if (payload.action === "scale") {
        if (data && typeof data === "object" && "accepted" in data && data.accepted === false) {
          message.error("扩缩容请求未被受理");
          return;
        }
        const scaleResult =
          data && typeof data === "object" && "scaleResult" in data && data.scaleResult && typeof data.scaleResult === "object"
            ? (data.scaleResult as {
                desiredReplicas?: number;
                observedReplicas?: number | null;
                readyReplicas?: number | null;
                availableReplicas?: number | null;
                status?: string;
                observedAt?: string;
              })
            : null;
        const desired = typeof scaleResult?.desiredReplicas === "number" ? scaleResult.desiredReplicas : payload.replicas ?? 0;
        const observed =
          typeof scaleResult?.observedReplicas === "number" ? scaleResult.observedReplicas : payload.replicas ?? null;
        const ready = typeof scaleResult?.readyReplicas === "number" ? scaleResult.readyReplicas : null;
        const available =
          typeof scaleResult?.availableReplicas === "number" ? scaleResult.availableReplicas : null;

        message.success(`${payload.name} 扩缩容请求已受理`);
        void runScaleConvergence({
          desiredReplicas: desired,
          initialObservedState: {
            desiredReplicas: desired,
            observedReplicas: observed,
            readyReplicas: ready,
            ...(available !== null ? { availableReplicas: available } : {}),
            status:
              scaleResult && typeof scaleResult.status === "string"
                ? scaleResult.status
                : undefined,
            observedAt:
              scaleResult && typeof scaleResult.observedAt === "string"
                ? scaleResult.observedAt
                : undefined,
          },
          onBeforeRefetch: () => {
            void queryClient.invalidateQueries({ queryKey: workloadsKey, exact: true });
          },
          refetch: query.refetch,
          resolveObservedState: (payloadData) => {
            const items = payloadData?.items ?? [];
            const latest = items.find((item) => {
              if (payload.id && item.id) {
                return item.id === payload.id;
              }
              return (
                item.name === payload.name &&
                item.clusterId === payload.clusterId &&
                item.namespace === payload.namespace
              );
            });
            if (!latest) {
              return null;
            }
            const snapshot = extractScaleSnapshot(latest);
            return {
              desiredReplicas: desired,
              observedReplicas: snapshot.observedReplicas,
              readyReplicas: snapshot.readyReplicas,
            };
          },
          onRound: (round) => {
            setScaleConvergence({ workloadName: payload.name, round });
          },
          timeoutMs: 60_000,
        }).catch((error: unknown) => {
          message.error(error instanceof Error ? error.message : "收敛状态刷新失败");
        });
        return;
      }
      message.success(`${payload.name} ${payload.action} 已提交`);
    },
    onSettled: async (_data, _error, payload) => {
      await refreshDeploymentSnapshots(payload.id);
    },
  });

  const tanstack列 = useMemo<ColumnDef<DeploymentRow>[]>(
    () => [
      { accessorKey: "名称" },
      { accessorKey: "名称空间" },
      { accessorKey: "集群" },
      { accessorKey: "副本数" },
      { accessorKey: "就绪数" },
      { accessorKey: "可用数" },
      { accessorKey: "策略" },
      { accessorKey: "修订版本" },
      { accessorKey: "状态" },
      { accessorKey: "启用状态" },
      { accessorKey: "创建时间" },
    ],
    [],
  );

  const sourceItems = useMemo(
    () => query.data?.items ?? [],
    [query.data?.items],
  );
  const 全量数据 = useMemo(() => sourceItems.map(mapItemToRow), [sourceItems]);

  // Extract known namespaces from loaded data for NamespaceSelect suggestions
  const knownNamespaces = useMemo(
    () => Array.from(new Set(sourceItems.map((i) => i.namespace).filter(Boolean))),
    [sourceItems],
  );

  const 表格前数据 = useMemo(
    () =>
      全量数据.filter((row) => matchLabelExpressions(row.labels, mergedFilters)),
    [全量数据, mergedFilters],
  );

  const table = useReactTable({
    data: 表格前数据,
    columns: tanstack列,
    state: { globalFilter: 关键字 },
    onGlobalFilterChange: set关键字,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const keyword = String(filterValue).trim().toLowerCase();
      if (!keyword) {
        return true;
      }
      // Search by name only (as requested)
      return row.original.名称.toLowerCase().includes(keyword);
    },
  });

  const 表格数据 = table.getRowModel().rows.map((row) => row.original);
  const 名称列宽度 = useMemo(
    () => getAdaptiveNameWidth(表格数据.map((row) => row.名称), { max: 340 }),
    [表格数据],
  );
  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    set关键字(parsed.keyword);
  };

  const 扩缩容确认 = async () => {
    if (!扩缩容行) {
      return;
    }
    const selected = 扩缩容行;
    const nextReplicas = Math.max(0, Number(目标副本) || 0);
    set扩缩容行(null);
    await actionMutation.mutateAsync({
      id: selected.id || undefined,
      name: selected.原始名称,
      clusterId: selected.集群,
      namespace: selected.名称空间,
      action: "scale",
      replicas: nextReplicas,
    });
  };

  const 执行动作 = async (row: DeploymentRow, action: WorkloadAction) => {
    await actionMutation.mutateAsync({
      name: row.原始名称,
      clusterId: row.集群,
      namespace: row.名称空间,
      action,
    });
  };

  const 解析资源标识 = (row: DeploymentRow): ResourceIdentity => {
    const urlClusterId = searchParams.get("clusterId")?.trim();
    const urlNamespace = searchParams.get("namespace")?.trim();
    const urlKind = searchParams.get("kind")?.trim();
    return {
      clusterId: urlClusterId || row.集群 || clusterId,
      namespace: urlNamespace || row.名称空间 || namespace,
      kind: urlKind || "Deployment",
      name: row.原始名称,
    };
  };

  // CRUD handlers
  const openAddModal = () => {
    router.push("/workloads/create?kind=Deployment");
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleModalSubmit = async () => {
    let values: DeploymentFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      if (editingRow?.id) {
        await patchWorkloadById(
          editingRow.id,
          { namespace: values.namespace, replicas: values.replicas },
          accessToken!,
        );
      }
      void message.success("Deployment 更新成功");
      setModalOpen(false);
      form.resetFields();
      void refreshDeploymentSnapshots(editingRow?.id);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row: DeploymentRow) => {
    try {
      await 执行动作(row, "delete");
      void message.success(`${row.名称} 删除成功`);
      void refreshDeploymentSnapshots(row.id);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const openScaleModal = (row: DeploymentRow) => {
    set扩缩容行(row);
    set目标副本(row.副本数);
  };

  const buildRowActions = (row: DeploymentRow): MenuProps["items"] => {
    const active = row.资源状态 === "active";
    return buildResourceActionMenuItems([
      { key: "describe", icon: <EyeOutlined />, label: "描述" },
      { key: "scale", icon: <RetweetOutlined />, label: "扩缩容" },
      { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
      { key: "restart", icon: <ReloadOutlined />, label: "重启", disabled: !active },
      { key: "rollback", icon: <RollbackOutlined />, label: "回滚", disabled: !active },
      { key: active ? "disable" : "enable", icon: <StopOutlined />, label: active ? "禁用" : "启用" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, danger: true, label: "删除" },
    ]);
  };

  const handleRowAction = (row: DeploymentRow, key: string) => {
    if (key === "describe") {
      if (row.id) setDetailTarget({ kind: "Deployment", id: row.id });
      return;
    }
    if (key === "scale") {
      openScaleModal(row);
      return;
    }
    if (key === "yaml") {
      setYaml目标(解析资源标识(row));
      return;
    }
    if (key === "restart" || key === "rollback" || key === "disable" || key === "enable") {
      void 执行动作(row, key as WorkloadAction);
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "确认删除部署",
        content: `删除 ${row.名称} 后将不可恢复`,
        okText: "确认",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => void handleDelete(row),
      });
    }
  };

  const antd列: ColumnsType<DeploymentRow> = [
    {
      title: "名称",
      dataIndex: "名称",
      key: "name",
      width: 名称列宽度,
      ellipsis: true,
      render: (name: string, row: DeploymentRow) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Deployment", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
      ...getSortableColumnProps("name"),
    },
    { title: "集群", dataIndex: "集群", key: "clusterId", width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: DeploymentRow) => getClusterDisplayName(clusterMap, row.集群), ...getSortableColumnProps("clusterId") },
    { title: "名称空间", dataIndex: "名称空间", key: "namespace", width: TABLE_COL_WIDTH.namespace, ...getSortableColumnProps("namespace") },
    {
      title: "状态",
      dataIndex: "状态",
      key: "status",
      width: TABLE_COL_WIDTH.status,
      render: (value: DeploymentStatus) => <Tag color={状态颜色[value]}>{value}</Tag>,
      sorter: (a, b) => {
        const rank = (value: DeploymentStatus) => (value === "运行中" ? 2 : value === "收敛中" ? 1 : 0);
        return rank(a.状态) - rank(b.状态) || a.名称.localeCompare(b.名称);
      },
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "启用状态",
      dataIndex: "启用状态",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (value: "启用" | "禁用") => <Tag color={value === "禁用" ? "default" : "green"}>{value}</Tag>,
      ...getSortableColumnProps("state"),
    },
    { title: "副本", dataIndex: "副本数", key: "replicas", width: TABLE_COL_WIDTH.replicas, ...getSortableColumnProps("replicas") },
    { title: "就绪", dataIndex: "就绪数", key: "readyReplicas", width: TABLE_COL_WIDTH.ready, ...getSortableColumnProps("readyReplicas") },
    {
      title: "可用",
      dataIndex: "可用数",
      key: "availableReplicas",
      width: TABLE_COL_WIDTH.available,
      sorter: (a, b) => a.可用数 - b.可用数 || a.名称.localeCompare(b.名称),
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "策略",
      dataIndex: "策略",
      key: "strategy",
      width: TABLE_COL_WIDTH.strategy,
      sorter: (a, b) => a.策略.localeCompare(b.策略),
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "修订版本",
      dataIndex: "修订版本",
      key: "revision",
      width: TABLE_COL_WIDTH.revision,
      sorter: (a, b) => a.修订版本 - b.修订版本,
      sortDirections: ["ascend", "descend", null],
    },
    {
      title: "创建时间",
      dataIndex: "创建时间",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
      ...getSortableColumnProps("createdAt"),
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      align: "left",
      render: (_: unknown, row: DeploymentRow) => (
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
          path="/workloads/deployments"
          embedded
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton onClick={openAddModal} aria-label="新增资源" />}
        />
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={12} md={6} lg={4}>
              <ClusterSelect
                value={clusterId}
                onChange={(v) => {
                  setClusterId(v);
                  resetPage();
                }}
                options={clusterOptions}
                loading={clustersQuery.isLoading}
              />
            </Col>
            <Col xs={24} sm={12} md={5} lg={4}>
              <NamespaceSelect
                value={namespace}
                onChange={(v) => {
                  setNamespace(v);
                  resetPage();
                }}
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
          {!isInitializing && !accessToken ? <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" /> : null}
          {query.isError ? (
            <Alert
              type="error"
              showIcon
              message="Deployments 加载失败"
              description={query.error instanceof Error ? query.error.message : "请求失败"}
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
          <Table<DeploymentRow>
            className="pod-table"
            bordered
            rowKey="key"
            columns={antd列}
            dataSource={表格数据}
            loading={(query.isLoading && !query.data) || actionMutation.isPending}
            onChange={(paginationInfo, filters, sorter, extra) =>
              handleTableChange(paginationInfo, filters, sorter, extra, (query.isLoading && !query.data) || actionMutation.isPending)
            }
            pagination={getPaginationConfig(query.data?.total ?? 0, (query.isLoading && !query.data) || actionMutation.isPending)}
            scroll={{ x: getTableScrollX(antd列) }}
            locale={{ emptyText: query.isLoading ? "正在加载..." : <Empty description="暂无数据" /> }}
          />
        </Space>
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken || undefined}
      />

      <Modal
        title="调整副本数"
        open={Boolean(扩缩容行)}
        onCancel={() => set扩缩容行(null)}
        onOk={扩缩容确认}
        okText="确认调整"
        cancelText="取消"
      >
        <Space orientation="vertical" size={8}>
          <Typography.Text>
            部署：<Typography.Text strong>{扩缩容行?.名称 ?? "-"}</Typography.Text>
          </Typography.Text>
          <Typography.Text>目标副本数：</Typography.Text>
          <InputNumber min={0} value={目标副本} onChange={(value) => set目标副本(value ?? 0)} style={{ width: 220 }} />
        </Space>
      </Modal>

      {/* 添加 / 编辑 Deployment Modal */}
      <Modal
        title="编辑 Deployment"
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={handleModalCancel}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入 Deployment 名称" }]}
          >
            <Input placeholder="例如：my-app" disabled />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <ClusterSelect
              value={form.getFieldValue("clusterId")}
              onChange={(value) => form.setFieldValue("clusterId", value)}
              options={clusterSelectOptions}
              loading={clustersQuery.isLoading}
              allowClear={false}
              placeholder="请选择集群"
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
      <ResourceYamlDrawer
        open={Boolean(yaml目标)}
        onClose={() => setYaml目标(null)}
        identity={yaml目标}
        token={accessToken ?? undefined}
        onUpdated={() => {
          void message.success("YAML 更新成功");
          void query.refetch();
        }}
      />
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
