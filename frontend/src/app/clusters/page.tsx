"use client";

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { MenuProps, TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ClusterDetailDrawer } from "@/components/cluster-detail-drawer";
import {
  OpsActionDropdown,
  OpsDrawerShell,
  OpsFilterChip,
  OpsFormSection,
  OpsModalShell,
  OpsPageHeader,
  OpsSurface,
  openOpsConfirm,
  type OpsFilterChipTone,
} from "@/components/ops";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
} from "@/components/resource-filter-toolbar";
import { ResourceFacetFilterButton } from "@/components/resource-facet-filter-button";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { ResourceAddButton } from "@/components/resource-add-button";
import {
  createCluster,
  deleteCluster,
  disableCluster,
  enableCluster,
  getClusters,
  updateCluster,
} from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import type { ClusterPayload } from "@/lib/api/clusters";
import {
  getClusterHealthDetail,
  getClusterHealthList,
  probeClusterHealth,
  type ClusterHealthListItem,
  type HealthProbeSource,
  type RuntimeStatus,
} from "@/lib/api/cluster-health";
import type { Cluster } from "@/lib/api/types";
import { QUERY_CACHE_TIMINGS, queryKeys } from "@/lib/query";
import { useAntdTableSortPagination } from "@/lib/table";

export type ClusterTableRecord = Cluster & { key: string };
type ClusterTableChangeHandler = NonNullable<TableProps<ClusterTableRecord>["onChange"]>;

const CLUSTERS_TABLE_KEY = "business.clusters";
const CLUSTER_HEALTH_REFRESH_INTERVAL_MS = 15_000;
const CLUSTER_HEALTH_ROUTE_QUIET_DELAY_MS = 750;
const EMPTY_CLUSTERS: Cluster[] = [];
const EMPTY_HEALTH_RESULTS: Record<string, ClusterHealthListItem> = {};
const CLUSTER_LIST_QUERY_OPTIONS = {
  staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
  gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  retry: 1,
} as const;
const CLUSTER_COLUMN_SETTINGS = [
  { key: "latencyMs", visible: false },
  { key: "healthSource", visible: false },
  { key: "healthReason", visible: false },
];
const ENVIRONMENT_OPTIONS = [
  { label: "全部环境", value: "" },
  { label: "公有云", value: "公有云" },
  { label: "私有云", value: "私有云" },
  { label: "本地", value: "本地" },
];
const CLUSTER_STATE_FILTER_OPTIONS = [
  { label: "运行中", value: "running" },
  { label: "离线", value: "offline" },
  { label: "探测中", value: "checking" },
  { label: "已停用", value: "disabled" },
  { label: "离线模式", value: "offline-mode" },
];
const KUBECONFIG_FILTER_OPTIONS = [
  { label: "已接入", value: "true" },
  { label: "离线模式", value: "false" },
];
const GLOBAL_SEARCH_PLACEHOLDER = "搜索名称 / ID / 供应商";

function isRouteTransitionSettling() {
  if (typeof window === "undefined") {
    return false;
  }
  const routeWindow = window as Window & { __KUBENOVA_ROUTE_TRANSITION_UNTIL?: number };
  return (routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL ?? 0) > performance.now();
}

/**
 * 主流运行状态模型（单状态）：
 * - running: 已接入且探测通过
 * - offline: 已接入但探测失败
 * - checking: 正在探测或等待首个健康快照
 * - disabled: 生命周期停用
 * - offline-mode: 未接入 kubeconfig 的离线模式
 */
function resolveRuntimeStatus(
  row: ClusterTableRecord,
  health: ClusterHealthListItem | undefined,
): { kind: RuntimeStatus; label: string; tone: OpsFilterChipTone; icon: React.ReactNode; reason?: string } {
  if (health) {
    if (health.runtimeStatus === "running") {
      return {
        kind: "running",
        label: "运行中",
        tone: "success",
        icon: <CheckCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "offline") {
      return {
        kind: "offline",
        label: "离线",
        tone: "danger",
        icon: <ExclamationCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "disabled") {
      return {
        kind: "disabled",
        label: "已停用",
        tone: "neutral",
        icon: <PauseCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "offline-mode") {
      return {
        kind: "offline-mode",
        label: "离线模式",
        tone: "info",
        icon: <DisconnectOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    return {
      kind: "checking",
      label: "探测中",
      tone: "warning",
      icon: <ReloadOutlined spin />,
      reason: health.reason ?? "等待最新探测结果",
    };
  }

  if (row.state === "disabled") {
    return {
      kind: "disabled",
      label: "已停用",
      tone: "neutral",
      icon: <PauseCircleOutlined />,
    };
  }

  if (!row.hasKubeconfig) {
    return {
      kind: "offline-mode",
      label: "离线模式",
      tone: "info",
      icon: <DisconnectOutlined />,
    };
  }

  return {
    kind: "checking",
    label: "探测中",
    tone: "warning",
    icon: <ReloadOutlined spin />,
    reason: "等待首次健康快照",
  };
}

/** CPU/内存 进度条 */
function UsageBar({ value, color }: { value: number; color: string }) {
  return (
    <Tooltip title={`${value}%`}>
      <Progress
        percent={value}
        size="small"
        showInfo={false}
        strokeColor={color}
        style={{ width: 80, margin: 0 }}
      />
    </Tooltip>
  );
}

function formatHealthTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未探测";
}

function formatLatency(value: number | null | undefined) {
  return typeof value === "number" ? `${value}ms` : "-";
}

function sourceText(source: HealthProbeSource | null | undefined) {
  if (source === "manual") return "手动触发";
  if (source === "event") return "事件触发";
  if (source === "auto") return "自动探测";
  return "未记录";
}

function runtimeStatusText(status: RuntimeStatus) {
  if (status === "running") return "运行中";
  if (status === "offline") return "离线";
  if (status === "checking") return "探测中";
  if (status === "disabled") return "已停用";
  return "离线模式";
}

function resolveProbeFailureReason(reason?: string | null) {
  const normalizedReason = reason?.trim();
  return normalizedReason ? normalizedReason : "暂未返回失败原因";
}

export default function ClustersPage() {
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [environment, setEnvironment] = useState("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const { sortBy, sortOrder, pagination, resetPage, getSortableColumnProps, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<ClusterTableRecord>({
      defaultPageSize: 10,
      allowedSortBy: ["name", "environment", "provider", "updatedAt"],
    });
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<ClusterTableRecord | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<ClusterTableRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<ClusterPayload>();

  // Per-row action loading states
  const [togglingId, setTogglingId] = useState<string>("");
  const [healthResults, setHealthResults] = useState<Record<string, ClusterHealthListItem>>({});
  const [healthDetailCluster, setHealthDetailCluster] = useState<ClusterTableRecord | null>(null);

  const queryKey = queryKeys.clusters.list({
    keyword: keyword.trim(),
    environment: environment || undefined,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    sortBy,
    sortOrder,
    token: accessToken,
  });

  const query = useQuery({
    ...CLUSTER_LIST_QUERY_OPTIONS,
    placeholderData: (previousData) => previousData,
    queryKey,
    queryFn: () =>
      getClusters(
        {
          keyword: keyword.trim(),
          environment: environment || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const healthDetailQuery = useQuery({
    queryKey: ["cluster-health-detail", healthDetailCluster?.id, accessToken],
    queryFn: () => getClusterHealthDetail(healthDetailCluster?.id ?? "", accessToken),
    enabled: Boolean(accessToken && healthDetailCluster?.id),
  });
  const clusterItems = query.data?.items ?? EMPTY_CLUSTERS;
  const isTableBusy = query.isLoading && !query.data;
  const healthResultsView = healthResults ?? EMPTY_HEALTH_RESULTS;
  const deferredHealthResults = useDeferredValue(healthResultsView);
  const deferredTableFilters = useDeferredValue(tableFilters);
  const preferencesClient = useMemo(
    () => createTablePreferencesClient(accessToken || undefined),
    [accessToken],
  );

  const tableData = useMemo<ClusterTableRecord[]>(() => {
    // 已删除的集群完全不显示，直接从列表过滤掉
    return clusterItems
      .filter((item) => item.state !== "deleted")
      .map((item) => ({ ...item, key: item.id }));
  }, [clusterItems]);
  const deferredTableData = useDeferredValue(tableData);

  const visibleTableData = useMemo<ClusterTableRecord[]>(() => {
    const nameFilter = typeof deferredTableFilters.name === "string" ? deferredTableFilters.name.toLowerCase() : "";
    const envFilter = typeof deferredTableFilters.environment === "string" ? deferredTableFilters.environment.toLowerCase() : "";
    const providerFilter = typeof deferredTableFilters.provider === "string" ? deferredTableFilters.provider.toLowerCase() : "";
    const versionFilter = typeof deferredTableFilters.kubernetesVersion === "string" ? deferredTableFilters.kubernetesVersion.toLowerCase() : "";
    const stateFilter = typeof deferredTableFilters.state === "string" ? deferredTableFilters.state : "";
    const kubeconfigFilter = typeof deferredTableFilters.hasKubeconfig === "string" ? deferredTableFilters.hasKubeconfig : "";
    const reasonFilter = typeof deferredTableFilters.healthReason === "string" ? deferredTableFilters.healthReason.toLowerCase() : "";
    return deferredTableData.filter((row) => {
      const runtimeStatus = resolveRuntimeStatus(row, deferredHealthResults[row.id]).kind;
      const health = deferredHealthResults[row.id];
      const matchName = nameFilter ? row.name.toLowerCase().includes(nameFilter) : true;
      const matchEnv = envFilter ? (row.environment ?? "").toLowerCase().includes(envFilter) : true;
      const matchProvider = providerFilter ? (row.provider ?? "").toLowerCase().includes(providerFilter) : true;
      const matchVersion = versionFilter ? (row.kubernetesVersion ?? "").toLowerCase().includes(versionFilter) : true;
      const matchState = stateFilter ? runtimeStatus === stateFilter : true;
      const matchKubeconfig = kubeconfigFilter ? String(Boolean(row.hasKubeconfig)) === kubeconfigFilter : true;
      const matchReason = reasonFilter ? (health?.reason ?? "").toLowerCase().includes(reasonFilter) : true;
      return matchName && matchEnv && matchProvider && matchVersion && matchState && matchKubeconfig && matchReason;
    });
  }, [
    deferredHealthResults,
    deferredTableData,
    deferredTableFilters.environment,
    deferredTableFilters.hasKubeconfig,
    deferredTableFilters.healthReason,
    deferredTableFilters.kubernetesVersion,
    deferredTableFilters.name,
    deferredTableFilters.provider,
    deferredTableFilters.state,
  ]);

  const healthStats = useMemo(() => {
    const total = visibleTableData.length;
    const counts = visibleTableData.reduce(
      (acc, row) => {
        const status = resolveRuntimeStatus(row, deferredHealthResults[row.id]).kind;
        acc[status] += 1;
        return acc;
      },
      {
        running: 0,
        offline: 0,
        checking: 0,
        disabled: 0,
        "offline-mode": 0,
      } satisfies Record<RuntimeStatus, number>,
    );
    return { total, ...counts };
  }, [deferredHealthResults, visibleTableData]);

  const refreshHealthSummaries = useCallback(
    async (rows: ClusterTableRecord[]) => {
      if (isRouteTransitionSettling()) {
        return;
      }
      if (!accessToken || rows.length === 0) {
        return;
      }
      const candidates = rows.filter((row) => row.state === "active" && row.hasKubeconfig);
      if (candidates.length === 0) {
        return;
      }

      const toCheckingSummary = (row: ClusterTableRecord, reason: string): ClusterHealthListItem => ({
        clusterId: row.id,
        clusterName: row.name,
        lifecycleState: row.state === "disabled" ? "disabled" : "active",
        runtimeStatus: "checking",
        ok: null,
        latencyMs: null,
        checkedAt: null,
        reason,
        source: null,
        isStale: true,
      });

      try {
        const response = await getClusterHealthList(
          {
            keyword: keyword.trim() || undefined,
            environment: environment || undefined,
            lifecycleState: undefined,
            runtimeStatus: undefined,
            page: 1,
            pageSize: 500,
          },
          accessToken,
        );

        const summaryById = new Map(response.items.map((item) => [item.clusterId, item]));
        setHealthResults((prev) => {
          const next = { ...prev };
          candidates.forEach((row) => {
            next[row.id] =
              summaryById.get(row.id) ??
              toCheckingSummary(row, "等待最新健康快照");
          });
          return next;
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "健康状态同步失败";
        setHealthResults((prev) => {
          const next = { ...prev };
          candidates.forEach((row) => {
            next[row.id] = toCheckingSummary(row, messageText);
          });
          return next;
        });
      }

    },
    [accessToken, environment, keyword],
  );
  const refetchList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.clusters.all });
    await query.refetch();
    await refreshHealthSummaries(tableData);
  }, [query, queryClient, refreshHealthSummaries, tableData]);

  useEffect(() => {
    if (tableData.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshHealthSummaries(tableData);
    }, isRouteTransitionSettling() ? CLUSTER_HEALTH_ROUTE_QUIET_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [tableData, refreshHealthSummaries]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshHealthSummaries(tableData);
    }, CLUSTER_HEALTH_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [accessToken, tableData, refreshHealthSummaries]);

  const openAddModal = useCallback(() => {
    setEditingCluster(null);
    form.resetFields();
    setModalOpen(true);
  }, [form]);

  const openEditModal = useCallback((row: ClusterTableRecord) => {
    setEditingCluster(row);
    form.setFieldsValue({
      name: row.name,
      environment: row.environment,
      provider: row.provider,
      kubernetesVersion: row.kubernetesVersion,
      status: row.status,
      // 编辑时不回填 kubeconfig 原文（敏感字段）
      kubeconfig: undefined,
    });
    setModalOpen(true);
  }, [form]);

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
    form.resetFields();
  }, [form]);

  const handleModalSubmit = useCallback(async () => {
    let values: ClusterPayload;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      if (editingCluster) {
        await updateCluster(editingCluster.id, values, accessToken);
        void message.success("集群更新成功");
      } else {
        await createCluster(values, accessToken);
        void message.success("集群创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, editingCluster, form, refetchList]);

  const handleDelete = useCallback(async (row: ClusterTableRecord) => {
    try {
      await deleteCluster(row.id, accessToken);
      void message.success("集群删除成功");
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  }, [accessToken, refetchList]);

  const handleToggleState = useCallback(async (row: ClusterTableRecord) => {
    const isDisabled = row.state === "disabled";
    setTogglingId(row.id);
    try {
      if (isDisabled) {
        await enableCluster(row.id, accessToken);
        void message.success(`集群「${row.name}」已启用`);
      } else {
        await disableCluster(row.id, accessToken);
        void message.success(`集群「${row.name}」已停用`);
      }
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setTogglingId("");
    }
  }, [accessToken, refetchList]);

  const manualProbeMutation = useMutation({
    mutationFn: (clusterId: string) => probeClusterHealth(clusterId, accessToken),
    onSuccess: async (result, clusterId) => {
      void message.success(
        result.ok
          ? `探测成功，耗时 ${result.latencyMs ?? 0}ms`
          : `探测失败：${resolveProbeFailureReason(result.reason)}`,
      );
      await refreshHealthSummaries(tableData);
      if (healthDetailCluster?.id === clusterId) {
        await healthDetailQuery.refetch();
      }
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "手动探测失败");
    },
  });

  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(deferredTableData.map((item) => item.name)),
    [deferredTableData],
  );
  const handleEnvironmentChange = useCallback((value: string) => {
    resetPage();
    setEnvironment(value);
  }, [resetPage]);
  const handleGlobalSearchChange = useCallback((value: string) => {
    setKeywordInput(value);
    setKeyword(value.trim());
    resetPage();
  }, [resetPage]);
  const globalSearch = useMemo(
    () => ({
      value: keywordInput,
      onChange: handleGlobalSearchChange,
      placeholder: GLOBAL_SEARCH_PLACEHOLDER,
    }),
    [handleGlobalSearchChange, keywordInput],
  );
  const handleFiltersChange = useCallback((nextFilters: HeadlampTableFilters) => {
    setTableFilters(nextFilters);
    resetPage();
  }, [resetPage]);
  const handleResourceTableChange = useCallback<ClusterTableChangeHandler>(
    (nextPagination, filters, sorter, extra) =>
      handleTableChange(nextPagination, filters, sorter, extra, isTableBusy),
    [handleTableChange, isTableBusy],
  );
  const loadingState = useMemo(
    () => ({ spinning: isTableBusy, description: "集群数据加载中..." }),
    [isTableBusy],
  );
  const detailRuntimeStatus = useMemo(
    () =>
      selectedCluster
        ? resolveRuntimeStatus(selectedCluster, deferredHealthResults[selectedCluster.id]).kind
        : undefined,
    [deferredHealthResults, selectedCluster],
  );
  const handleCloseDetail = useCallback(() => setDetailOpen(false), []);
  const handleCloseHealthDetail = useCallback(() => setHealthDetailCluster(null), []);
  const handleDetailRefreshRequest = useCallback(() => void refetchList(), [refetchList]);

  const columns: Array<HeadlampResourceTableColumn<ClusterTableRecord>> = useMemo(() => [
    {
      title: "集群名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "以集群过滤" },
      width: nameWidth,
      ...getSortableColumnProps("name", isTableBusy),
      ellipsis: true,
      render: (name: string, row) => (
        <Space orientation="vertical" size={2}>
          <Typography.Link
            strong
            onClick={() => {
              setSelectedCluster(row);
              setDetailOpen(true);
            }}
          >
            {name}
          </Typography.Link>
          {row.hasKubeconfig && (
            <Tooltip title="查看 API Server 地址">
              <Typography.Text
                type="secondary"
                style={{ fontSize: 11, fontFamily: "monospace" }}
                copyable
              >
                {`https://${name}`}
              </Typography.Text>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "环境",
      dataIndex: "environment",
      key: "environment",
      width: 120,
      filter: { type: "text", placeholder: "以环境过滤" },
      ...getSortableColumnProps("environment", isTableBusy),
    },
    {
      title: "供应商",
      dataIndex: "provider",
      key: "provider",
      width: 150,
      filter: { type: "text", placeholder: "以供应商过滤" },
      ...getSortableColumnProps("provider", isTableBusy),
    },
    {
      title: "K8s 版本",
      dataIndex: "kubernetesVersion",
      key: "kubernetesVersion",
      width: 120,
      filter: { type: "text", placeholder: "以版本过滤" },
    },
    {
      title: "资源使用率",
      key: "usage",
      width: 220,
      render: (_: unknown, row: ClusterTableRecord) => (
        <Space orientation="vertical" size={2}>
          <Space size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 11, width: 30 }}>CPU</Typography.Text>
            <UsageBar value={row.cpuUsage} color={row.cpuUsage > 80 ? "#ff4d4f" : row.cpuUsage > 60 ? "#faad14" : "#52c41a"} />
            <Typography.Text style={{ fontSize: 11 }}>{row.cpuUsage}%</Typography.Text>
          </Space>
          <Space size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 11, width: 30 }}>内存</Typography.Text>
            <UsageBar value={row.memoryUsage} color={row.memoryUsage > 80 ? "#ff4d4f" : row.memoryUsage > 60 ? "#faad14" : "#1677ff"} />
            <Typography.Text style={{ fontSize: 11 }}>{row.memoryUsage}%</Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "运行状态",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: CLUSTER_STATE_FILTER_OPTIONS,
      },
      render: (_: unknown, row: ClusterTableRecord) => {
        const runtimeStatus = resolveRuntimeStatus(
          row,
          deferredHealthResults[row.id],
        );
        return (
          <Tooltip title={runtimeStatus.reason ?? `状态：${runtimeStatus.label}`}>
            <OpsFilterChip tone={runtimeStatus.tone} icon={runtimeStatus.icon}>
              {runtimeStatus.label}
            </OpsFilterChip>
          </Tooltip>
        );
      },
    },
    {
      title: "最近探测",
      key: "checkedAt",
      width: TABLE_COL_WIDTH.time,
      render: (_: unknown, row) => {
        const health = deferredHealthResults[row.id];
        return health?.checkedAt ? (
          <Tooltip title={health.isStale ? "结果已过期" : "结果新鲜"}>
            <Typography.Text type={health.isStale ? "warning" : undefined}>
              {formatHealthTime(health.checkedAt)}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">未探测</Typography.Text>
        );
      },
    },
    {
      title: "探测延迟",
      key: "latencyMs",
      width: 110,
      render: (_: unknown, row) => formatLatency(deferredHealthResults[row.id]?.latencyMs),
    },
    {
      title: "探测来源",
      key: "healthSource",
      width: 120,
      render: (_: unknown, row) => sourceText(deferredHealthResults[row.id]?.source),
    },
    {
      title: "失败原因",
      key: "healthReason",
      width: 220,
      filter: { type: "text", placeholder: "以失败原因过滤" },
      ellipsis: true,
      render: (_: unknown, row) => deferredHealthResults[row.id]?.reason || "-",
    },
    {
      title: "接入状态",
      key: "hasKubeconfig",
      width: 120,
      filter: {
        type: "select",
        placeholder: "以接入过滤",
        options: KUBECONFIG_FILTER_OPTIONS,
      },
      render: (_: unknown, row: ClusterTableRecord) => {
        return row.hasKubeconfig ? (
          <Tooltip title="已配置 kubeconfig，工作负载数据将从集群实时同步">
            <OpsFilterChip tone="success" icon={<CloudServerOutlined />}>
              已接入
            </OpsFilterChip>
          </Tooltip>
        ) : (
          <Tooltip title="当前未接入实时工作负载数据">
            <OpsFilterChip tone="neutral" icon={<DisconnectOutlined />}>
              离线模式
            </OpsFilterChip>
          </Tooltip>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: 92,
      align: "center",
      render: (_, row) => {
        const isDisabled = row.state === "disabled";
        const isDeleted = row.state === "deleted";
        const items: MenuProps["items"] = [
          !isDeleted
            ? {
                key: isDisabled ? "enable" : "disable",
                icon: isDisabled ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
                danger: !isDisabled,
                label: isDisabled ? "启用" : "停用",
              }
            : null,
          {
            key: "healthDetail",
            icon: <ClockCircleOutlined />,
            label: "健康详情",
          },
          {
            key: "probe",
            icon: <ReloadOutlined />,
            label: "立即探测",
            disabled: row.state === "disabled" || row.hasKubeconfig === false,
          },
          {
            key: "edit",
            icon: <EditOutlined />,
            label: "编辑",
          },
          {
            type: "divider",
          },
          {
            key: "delete",
            icon: <DeleteOutlined />,
            danger: true,
            label: "删除",
          },
        ].filter(Boolean) as NonNullable<MenuProps["items"]>;

        return (
          <OpsActionDropdown
            placement="bottomRight"
            items={items}
            ariaLabel="操作"
            onClick={({ key }) => {
              if (key === "healthDetail") {
                setHealthDetailCluster(row);
                return;
              }
              if (key === "probe") {
                manualProbeMutation.mutate(row.id);
                return;
              }
              if (key === "edit") {
                openEditModal(row);
                return;
              }
              if (key === "delete") {
                openOpsConfirm({
                  title: "删除集群",
                  description: `确认删除集群「${row.name}」吗？此操作不可恢复。`,
                  impact: "删除后该集群的接入配置和列表记录将不可恢复。",
                  okText: "确认删除",
                  cancelText: "取消",
                  danger: true,
                  onOk: () => void handleDelete(row),
                });
                return;
              }
              if (key === "enable" || key === "disable") {
                openOpsConfirm({
                  title: key === "enable" ? "启用集群" : "停用集群",
                  description:
                    key === "enable"
                      ? `确认启用集群「${row.name}」？`
                      : `确认停用集群「${row.name}」？停用后集群不可操作但可恢复。`,
                  impact: key === "disable" ? "停用后该集群不可操作，但可以重新启用。" : undefined,
                  okText: key === "enable" ? "确认启用" : "确认停用",
                  cancelText: "取消",
                  danger: key === "disable",
                  onOk: () => void handleToggleState(row),
                });
              }
            }}
            trigger={
              <Button
                size="small"
                className="ops-action-trigger"
                icon={<MoreOutlined />}
                aria-label="操作"
                loading={togglingId === row.id || (manualProbeMutation.isPending && manualProbeMutation.variables === row.id)}
              />
            }
          />
        );
      },
    },
  ], [
    deferredHealthResults,
    getSortableColumnProps,
    handleDelete,
    handleToggleState,
    isTableBusy,
    manualProbeMutation,
    nameWidth,
    openEditModal,
    togglingId,
  ]);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsPageHeader
        title={(
          <>
            集群管理
            <span className="resource-page-header__title-suffix">
              <ResourceAddButton onClick={openAddModal} aria-label="创建集群" />
            </span>
          </>
        )}
        subtitle="查看集群版本、资源使用率和运行状态。系统自动健康探测与资源同步，支持禁用/启用。"
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="集群总数" value={healthStats.total} />
          </Card>
        </Col>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="运行中" value={healthStats.running} styles={{ content: { color: "#389e0d" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="离线" value={healthStats.offline} styles={{ content: { color: "#cf1322" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="探测中" value={healthStats.checking} styles={{ content: { color: "#1677ff" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="离线模式" value={healthStats["offline-mode"]} />
          </Card>
        </Col>
        <Col xs={24} md={6} xl={4}>
          <Card>
            <Statistic title="已停用" value={healthStats.disabled} />
          </Card>
        </Col>
      </Row>

      <OpsSurface variant="toolbar" padding="sm">
        <ResourceFilterToolbar>
          <ResourceFilterToolbarItem width="auto">
            <ResourceFacetFilterButton
              label="环境"
              value={environment}
              allLabel="全部环境"
              panelTitle="环境范围"
              options={ENVIRONMENT_OPTIONS}
              onChange={handleEnvironmentChange}
            />
          </ResourceFilterToolbarItem>
        </ResourceFilterToolbar>
      </OpsSurface>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再查看集群信息。" />
      ) : null}

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={query.error instanceof Error ? query.error.message : "获取集群数据时发生错误"}
        />
      ) : null}

      <Card>
        <ResourceTable<ClusterTableRecord>
          rowKey="key"
          tableKey={CLUSTERS_TABLE_KEY}
          columns={columns as ColumnsType<ClusterTableRecord>}
          columnSettings={CLUSTER_COLUMN_SETTINGS}
          dataSource={visibleTableData}
          preferencesClient={preferencesClient}
          globalSearch={globalSearch}
          filters={tableFilters}
          onFiltersChange={handleFiltersChange}
          onResourceNavigate={(request) => {
            if (request.kind !== "Cluster") return;
            const targetId = String(request.id || request.name || "");
            const target = visibleTableData.find((item) => item.id === targetId || item.name === targetId);
            if (!target) return;
            setSelectedCluster(target);
            setDetailOpen(true);
          }}
          loading={loadingState}
          onChange={handleResourceTableChange}
          pagination={getPaginationConfig(query.data?.total ?? visibleTableData.length, isTableBusy)}
          emptyDescription="暂无符合条件的集群数据"
        />
      </Card>

      <ClusterDetailDrawer
        open={detailOpen}
        onClose={handleCloseDetail}
        token={accessToken ?? undefined}
        cluster={selectedCluster}
        runtimeStatus={detailRuntimeStatus}
        onRefreshRequest={handleDetailRefreshRequest}
      />

      <OpsDrawerShell
        title={healthDetailCluster ? `健康详情 · ${healthDetailCluster.name}` : "健康详情"}
        open={Boolean(healthDetailCluster)}
        variant="business"
        onClose={handleCloseHealthDetail}
        bodyClassName="cluster-health-drawer__body"
        footerActions={
          healthDetailCluster ? (
            <Button
              icon={<ReloadOutlined />}
              loading={manualProbeMutation.isPending && manualProbeMutation.variables === healthDetailCluster.id}
              disabled={healthDetailCluster.state === "disabled" || healthDetailCluster.hasKubeconfig === false}
              onClick={() => manualProbeMutation.mutate(healthDetailCluster.id)}
            >
              立即探测
            </Button>
          ) : null
        }
      >
        {healthDetailQuery.isLoading ? <Typography.Text>加载中...</Typography.Text> : null}
        {healthDetailQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="健康详情加载失败"
            description={
              healthDetailQuery.error instanceof Error ? healthDetailQuery.error.message : "请求失败，请稍后重试"
            }
          />
        ) : null}
        {healthDetailQuery.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="集群">{healthDetailQuery.data.summary.clusterName}</Descriptions.Item>
              <Descriptions.Item label="运行状态">
                {runtimeStatusText(healthDetailQuery.data.summary.runtimeStatus)}
              </Descriptions.Item>
              <Descriptions.Item label="最近探测">
                {formatHealthTime(healthDetailQuery.data.summary.checkedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="延迟">{formatLatency(healthDetailQuery.data.summary.latencyMs)}</Descriptions.Item>
              <Descriptions.Item label="来源">{sourceText(healthDetailQuery.data.summary.source)}</Descriptions.Item>
              <Descriptions.Item label="原因">{healthDetailQuery.data.summary.reason || "-"}</Descriptions.Item>
              <Descriptions.Item label="超时预算">
                {formatLatency(healthDetailQuery.data.detail.timeoutMs)}
              </Descriptions.Item>
              <Descriptions.Item label="连续失败次数">
                {healthDetailQuery.data.detail.failureCount ?? "-"}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="诊断详情">
              <Typography.Paragraph
                style={{
                  marginBottom: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {JSON.stringify(healthDetailQuery.data.detail.payload ?? {}, null, 2)}
              </Typography.Paragraph>
            </Card>
          </Space>
        ) : null}
      </OpsDrawerShell>

      <OpsModalShell
        title={editingCluster ? "编辑集群" : "添加集群"}
        description="填写集群元数据和 KubeConfig，平台会据此连接真实集群。"
        identity={editingCluster?.name ?? "集群"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={handleModalCancel}
        okText={editingCluster ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
        width={600}
      >
        <Form form={form} layout="vertical">
          <OpsFormSection title="基础信息" description="用于列表筛选、状态识别和环境归属。">
            <Form.Item
              label="集群名称"
              name="name"
              rules={[{ required: true, message: "请输入集群名称" }]}
            >
              <Input placeholder="例如：prod-cluster-01" />
            </Form.Item>
            <Form.Item
              label="环境"
              name="environment"
              rules={[{ required: true, message: "请选择环境" }]}
            >
              <Select
                placeholder="请选择环境"
                options={[
                  { label: "公有云", value: "公有云" },
                  { label: "私有云", value: "私有云" },
                  { label: "本地", value: "本地" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="供应商"
              name="provider"
              rules={[{ required: true, message: "请输入供应商" }]}
            >
              <Input placeholder="例如：AWS / 阿里云 / 自建" />
            </Form.Item>
            <Form.Item
              label="K8s 版本"
              name="kubernetesVersion"
              rules={[{ required: true, message: "请输入 K8s 版本" }]}
            >
              <Input placeholder="例如：v1.28.4" />
            </Form.Item>
            <Form.Item label="状态" name="status">
              <Select
                placeholder="请选择状态（可选）"
                allowClear
                options={[
                  { label: "正常", value: "正常" },
                  { label: "告警", value: "告警" },
                  { label: "维护", value: "维护" },
                ]}
              />
            </Form.Item>
          </OpsFormSection>
          <OpsFormSection title="接入配置" description="不填写 KubeConfig 时，集群以离线模式管理。">
            <Form.Item
              label="KubeConfig（YAML 格式）"
              name="kubeconfig"
              extra={
                editingCluster
                  ? "如不修改 kubeconfig，留空即可；重新粘贴将覆盖原有配置。"
                  : "粘贴 kubectl config view --raw 的输出内容，用于接入真实集群。"
              }
            >
              <Input.TextArea
                rows={6}
                placeholder={`粘贴 kubectl config view --raw 的输出内容，用于接入真实集群。\n\n示例：\napiVersion: v1\nclusters:\n- cluster:\n    server: https://...\n  name: my-cluster\n...`}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </Form.Item>
          </OpsFormSection>
        </Form>
      </OpsModalShell>
    </Space>
  );
}
