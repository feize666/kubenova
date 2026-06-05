"use client";

import {
  BugOutlined,
  CodeOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Modal,
  Space,
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { PodMetricCell } from "@/components/visual-system";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { getClusters } from "@/lib/api/clusters";
import { buildLogsRoute } from "@/lib/api/logs";
import {
  deleteWorkload,
  getWorkloadsByKind,
} from "@/lib/api/workloads";
import type { WorkloadListItem, WorkloadKindParam } from "@/lib/api/workloads";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { buildTerminalRoute } from "@/lib/workloads/terminal";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";
import { OpsActionDropdown } from "@/components/ops/ops-action-dropdown";
import { OpsFilterChip } from "@/components/ops/ops-filter-chip";
import { OpsStatusTag } from "@/components/ops/ops-status";

// Pod 状态类型
type PodPhase = "Running" | "Pending" | "Failed" | "Succeeded" | string;

function podPhaseTone(phase: PodPhase) {
  if (phase === "Running") return "success";
  if (phase === "Pending") return "warning";
  if (phase === "Failed") return "danger";
  if (phase === "Succeeded") return "info";
  return "neutral";
}

// 从 statusJson 中提取 Pod 扩展字段
interface PodStatusFields {
  phase?: string;
  podIP?: string;
  nodeName?: string;
  restartCount?: number;
  containerNames?: string[];
  containerImages?: string[];
  replicas?: number;
  readyReplicas?: number;
}

interface PodUsageFields {
  cpuUsagePercent?: number | null;
  memoryUsagePercent?: number | null;
  cpuUsage?: number | null;
  memoryUsage?: number | null;
  history?: Array<{
    timestamp: string;
    cpuUsage: number | null;
    memoryUsage: number | null;
  }>;
  usageAvailable: boolean;
  usageNote?: string;
}

function parseLiveMetrics(value: unknown):
  | {
      capturedAt: string;
      source: string;
      available: boolean;
      freshnessWindowMs: number;
      cpuUsage: number | null;
      memoryUsage: number | null;
      history: Array<{
        timestamp: string;
        cpuUsage: number | null;
        memoryUsage: number | null;
      }>;
      note?: string;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }
          const row = item as Record<string, unknown>;
          return {
            timestamp: typeof row.timestamp === "string" ? row.timestamp : new Date().toISOString(),
            cpuUsage: typeof row.cpuUsage === "number" ? row.cpuUsage : null,
            memoryUsage: typeof row.memoryUsage === "number" ? row.memoryUsage : null,
          };
        })
        .filter(
          (item): item is {
            timestamp: string;
            cpuUsage: number | null;
            memoryUsage: number | null;
          } => Boolean(item),
        )
    : [];
  return {
    capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : new Date().toISOString(),
    source: typeof raw.source === "string" ? raw.source : "none",
    available: raw.available === true,
    freshnessWindowMs:
      typeof raw.freshnessWindowMs === "number" ? raw.freshnessWindowMs : 0,
    cpuUsage: typeof raw.cpuUsage === "number" ? raw.cpuUsage : null,
    memoryUsage: typeof raw.memoryUsage === "number" ? raw.memoryUsage : null,
    history,
    note: typeof raw.note === "string" ? raw.note : undefined,
  };
}

function extractPodStatus(item: WorkloadListItem): PodStatusFields {
  const s = item.statusJson as Record<string, unknown> | undefined;
  if (!s) return {};

  return {
    phase: typeof s.phase === "string" ? s.phase : undefined,
    podIP: typeof s.podIP === "string" ? s.podIP : undefined,
    nodeName: typeof s.nodeName === "string" ? s.nodeName : undefined,
    restartCount: typeof s.restartCount === "number" ? s.restartCount : 0,
    containerNames: Array.isArray(s.containerNames)
      ? s.containerNames.filter((item): item is string => typeof item === "string")
      : [],
    containerImages: Array.isArray(s.containerImages)
      ? s.containerImages.filter((item): item is string => typeof item === "string")
      : [],
    replicas: typeof s.replicas === "number" ? s.replicas : undefined,
    readyReplicas: typeof s.readyReplicas === "number" ? s.readyReplicas : undefined,
  };
}

function readUsagePercent(value: unknown): number | null | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function extractPodUsage(item: WorkloadListItem): PodUsageFields {
  const s = item.statusJson as Record<string, unknown> | undefined;
  if (!s) {
    return {
      usageAvailable: false,
      usageNote: "未同步到 Pod 指标",
    };
  }

  const liveMetrics = parseLiveMetrics(s.liveMetrics);
  if (liveMetrics) {
    return {
      cpuUsage: liveMetrics.cpuUsage,
      memoryUsage: liveMetrics.memoryUsage,
      history: liveMetrics.history,
      usageAvailable: liveMetrics.available,
      usageNote: liveMetrics.note,
    };
  }

  const usageSources = [
    s.usageMetrics,
    s.resourceUsage,
    s.usage,
    s.metrics,
    s.resourceMetrics,
  ].filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));

  const cpuCandidates: unknown[] = [
    s.cpuUsagePercent,
    s.cpuUsage,
    s.cpuPercent,
    ...usageSources.flatMap((source) => [source.cpuUsagePercent, source.cpuUsage, source.cpuPercent]),
  ];
  const memoryCandidates: unknown[] = [
    s.memoryUsagePercent,
    s.memoryUsage,
    s.memoryPercent,
    ...usageSources.flatMap((source) => [source.memoryUsagePercent, source.memoryUsage, source.memoryPercent]),
  ];

  const cpuUsagePercent = cpuCandidates
    .map(readUsagePercent)
    .find((value): value is number => typeof value === "number");
  const memoryUsagePercent = memoryCandidates
    .map(readUsagePercent)
    .find((value): value is number => typeof value === "number");

  const usageAvailable = typeof cpuUsagePercent === "number" || typeof memoryUsagePercent === "number";

  if (!usageAvailable) {
    return {
      usageAvailable: false,
      usageNote: "当前 Pod 未提供实时 CPU / Memory 指标",
    };
  }

  return {
    cpuUsagePercent: cpuUsagePercent ?? null,
    memoryUsagePercent: memoryUsagePercent ?? null,
    usageAvailable: true,
  };
}

type PodRow = WorkloadListItem & {
  key: string;
  phase: string;
  podIP: string;
  nodeName: string;
  restartCount: number;
  containerNames: string[];
  containerImages: string[];
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  cpuUsage: number | null;
  memoryUsage: number | null;
  history?: Array<{
    timestamp: string;
    cpuUsage: number | null;
    memoryUsage: number | null;
  }>;
  usageAvailable: boolean;
  usageNote?: string;
};

function mapItemToRow(item: WorkloadListItem): PodRow {
  const {
    phase,
    podIP,
    nodeName,
    restartCount,
    containerNames,
    containerImages,
    replicas,
    readyReplicas,
  } =
    extractPodStatus(item);
  const { cpuUsagePercent, memoryUsagePercent, cpuUsage, memoryUsage, history, usageAvailable, usageNote } = extractPodUsage(item);
  return {
    ...item,
    key: item.id,
    phase: phase ?? "Unknown",
    podIP: podIP ?? "-",
    nodeName: nodeName ?? "-",
    restartCount: restartCount ?? 0,
    replicas: item.replicas ?? replicas ?? 0,
    readyReplicas: item.readyReplicas ?? readyReplicas ?? 0,
    containerNames: containerNames ?? [],
    containerImages: containerImages ?? [],
    cpuUsagePercent: cpuUsagePercent ?? null,
    memoryUsagePercent: memoryUsagePercent ?? null,
    cpuUsage: cpuUsage ?? null,
    memoryUsage: memoryUsage ?? null,
    history,
    usageAvailable,
    usageNote,
  };
}

function parseSearchInput(input: string): { keyword: string; labels: string[] } {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const labels = tokens.filter((token) => token.includes("="));
  const keywords = tokens.filter((token) => !token.includes("="));
  return {
    keyword: keywords.join(" "),
    labels,
  };
}

// Pod 状态过滤选项
const PHASE_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "Running", value: "Running" },
  { label: "Pending", value: "Pending" },
  { label: "Failed", value: "Failed" },
  { label: "Succeeded", value: "Succeeded" },
];

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

export default function PodsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);

  // 筛选状态
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const phaseFilter = typeof tableFilters.phase === "string" ? tableFilters.phase : "";
  const {
    sortBy,
    sortOrder,
    getSortableColumnProps,
    resetPage,
    pagination,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<PodRow>({
    storageKey: "workloads/pods/table-sort",
    defaultPageSize: 10,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
    allowedSortBy: [
      "name",
      "clusterId",
      "namespace",
      "readyReplicas",
      "phase",
      "cpuUsage",
      "memoryUsage",
      "restartCount",
      "podIP",
      "nodeName",
      "createdAt",
    ],
  });
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  // 集群列表（供筛选下拉）
  const clustersQuery = useQuery({
    queryKey: ["clusters", "list-for-pods", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterFilterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name])),
    [clustersQuery.data],
  );

  // 查询 Pod 列表
  const podsQuery = useQuery({
    queryKey: [
      "workloads",
      "pods",
      clusterId,
      namespace,
      keyword,
      phaseFilter,
      mergedFilters,
      page,
      pageSize,
      sortBy,
      sortOrder,
      accessToken,
    ],
    queryFn: () =>
      getWorkloadsByKind(
        "Pod" as WorkloadKindParam,
        {
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
          keyword: keyword.trim() || undefined,
          page,
          pageSize,
          sortBy,
          sortOrder,
          ...(phaseFilter ? { state: phaseFilter } : {}),
        } as Parameters<typeof getWorkloadsByKind>[1],
        accessToken,
    ),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const tableBusy = podsQuery.isFetching;

  const rows = useMemo<PodRow[]>(
    () => (podsQuery.data?.items ?? []).map(mapItemToRow),
    [podsQuery.data],
  );

  // Extract known namespaces from loaded data for NamespaceSelect suggestions
  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set((podsQuery.data?.items ?? []).map((i) => i.namespace).filter(Boolean)),
      ),
    [podsQuery.data],
  );

  // Client-side filtering applies to the current backend page.
  const tableData = useMemo<PodRow[]>(() => {
    const nameFilter = getTextFilter(tableFilters, "name");
    const clusterFilter = getTextFilter(tableFilters, "clusterId");
    const namespaceFilter = getTextFilter(tableFilters, "namespace");
    const podIpFilter = getTextFilter(tableFilters, "podIP");
    const nodeNameFilter = getTextFilter(tableFilters, "nodeName");
    let nextRows = [...rows];
    nextRows = nextRows.filter(
      (row) =>
        textMatches(row.name, nameFilter) &&
        textMatches(`${row.clusterId} ${getClusterDisplayName(clusterMap, row.clusterId)}`, clusterFilter) &&
        textMatches(row.namespace, namespaceFilter) &&
        textMatches(row.podIP, podIpFilter) &&
        textMatches(row.nodeName, nodeNameFilter),
    );
    if (phaseFilter) nextRows = nextRows.filter((row) => row.phase === phaseFilter);
    if (mergedFilters.length > 0) {
      nextRows = nextRows.filter((row) => {
        const itemLabels = (row.labels as Record<string, string> | null | undefined) ?? {};
        return mergedFilters.every((lf) => {
          const [k, v] = lf.split("=");
          return v ? itemLabels[k] === v : k in itemLabels;
        });
      });
    }
    return nextRows;
  }, [clusterMap, mergedFilters, phaseFilter, rows, tableFilters]);
  const displayedRows = useMemo<PodRow[]>(() => {
    const rowsToSort = [...tableData];
    if (!sortBy || !sortOrder) {
      return rowsToSort;
    }
    const direction = sortOrder === "desc" ? -1 : 1;
    const getNumeric = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const getString = (value: unknown) => (value === null || value === undefined ? "" : String(value));
    return rowsToSort.sort((left, right) => {
      const leftValue = (left as unknown as Record<string, unknown>)[sortBy];
      const rightValue = (right as unknown as Record<string, unknown>)[sortBy];
      const leftNumeric = getNumeric(leftValue);
      const rightNumeric = getNumeric(rightValue);
      if (leftNumeric !== null && rightNumeric !== null) {
        return (leftNumeric - rightNumeric) * direction;
      }
      return getString(leftValue).localeCompare(getString(rightValue), "zh-Hans-CN") * direction;
    });
  }, [sortBy, sortOrder, tableData]);
  const displayedTotal = podsQuery.data?.total ?? tableData.length;
  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labels);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({ clusterId, namespace, keyword });

  const handleDelete = async (row: PodRow) => {
    try {
      await deleteWorkload(row.id, accessToken);
      void message.success(`Pod ${row.name} 删除成功`);
      void podsQuery.refetch();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  function buildTerminalParams(row: PodRow): string {
    return buildTerminalRoute({
      clusterId: row.clusterId,
      clusterName: getClusterDisplayName(clusterMap, row.clusterId),
      namespace: row.namespace,
      pod: row.name,
      containerNames: row.containerNames,
      from: "pods",
      returnTo: "/workloads/pods",
      returnClusterId: clusterId || row.clusterId,
      returnClusterName: getClusterDisplayName(clusterMap, clusterId || row.clusterId),
      returnNamespace: namespace || row.namespace,
      returnKeyword: keyword || row.name,
      returnPhase: phaseFilter || undefined,
      returnPage: page,
    }).replace(/^\/terminal\?/, "");
  }

  function buildLogsParams(row: PodRow): string {
    return buildLogsRoute({
      clusterId: row.clusterId,
      clusterName: getClusterDisplayName(clusterMap, row.clusterId),
      namespace: row.namespace,
      pod: row.name,
      containerNames: row.containerNames,
      resourceKind: "Pod",
      resourceName: row.name,
      resourceId: row.id,
      from: "pods",
      returnTo: "/workloads/pods",
      returnClusterId: clusterId || row.clusterId,
      returnClusterName: getClusterDisplayName(clusterMap, clusterId || row.clusterId),
      returnNamespace: namespace || row.namespace,
      returnKeyword: keyword || row.name,
      returnPhase: phaseFilter || undefined,
      returnPage: page,
      tailLines: 200,
      sinceSeconds: 24 * 60 * 60,
    }).replace(/^\/logs\?/, "");
  }

  function resolveIdentity(row: PodRow): ResourceIdentity {
    return {
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: "Pod",
      name: row.name,
    };
  }

  function buildActionItems(): NonNullable<MenuProps["items"]> {
    return [
      {
        key: "description",
        icon: <EyeOutlined />,
        label: "描述",
      },
      {
        key: "logs",
        icon: <BugOutlined />,
        label: "日志",
      },
      {
        key: "terminal",
        icon: <CodeOutlined />,
        label: "终端",
      },
      {
        key: "yaml",
        icon: <FileTextOutlined />,
        label: "YAML",
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
    ];
  }

  function renderUsageCell(value: number | null, row: PodRow, kind: "cpu" | "memory") {
    if (!row.usageAvailable || value === null) {
      return (
        <Space orientation="vertical" size={2} style={{ width: "100%", alignItems: "flex-start" }}>
          <OpsFilterChip tone="neutral" style={{ marginInlineEnd: 0 }}>
            无可用指标
          </OpsFilterChip>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {row.usageNote ?? "等待同步实时指标"}
          </Typography.Text>
        </Space>
      );
    }

    return (
      <PodMetricCell
        kind={kind}
        value={value}
        percent={
          kind === "cpu"
            ? Math.min(100, Math.max(0, value * 100))
            : Math.min(100, (value / (1024 ** 3)) * 100)
        }
      />
    );
  }

  const columns: Array<HeadlampResourceTableColumn<PodRow>> = [
    {
      title: "Pod 名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "以名称过滤" },
      width: getAdaptiveNameWidth(tableData.map((row) => row.name), { max: 340 }),
      align: "left",
      ellipsis: true,
      ...getSortableColumnProps("name"),
      render: (name: string, row: PodRow) =>
        row.id ? (
          <Typography.Link
            onClick={() => setDetailTarget({ kind: "Pod", id: row.id })}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
          >
            {row.name}
          </Typography.Link>
        ) : (
          <Typography.Text code style={{ fontSize: 12 }}>
            {row.name}
          </Typography.Text>
        ),
    },
    {
      title: "集群",
      dataIndex: "clusterId",
      key: "clusterId",
      required: true,
      filter: { type: "text", placeholder: "以集群过滤" },
      width: TABLE_COL_WIDTH.cluster,
      align: "left",
      ellipsis: true,
      ...getSortableColumnProps("clusterId"),
      render: (_: unknown, row: PodRow) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      filter: { type: "text", placeholder: "以名称空间过滤" },
      width: TABLE_COL_WIDTH.namespace,
      align: "left",
      ...getSortableColumnProps("namespace"),
    },
    {
      title: "就绪",
      dataIndex: "readyReplicas",
      key: "readyReplicas",
      width: 90,
      align: "left",
      ...getSortableColumnProps("readyReplicas"),
      render: (_: unknown, row: PodRow) => `${row.readyReplicas}/${row.replicas}`,
    },
    {
      title: "状态",
      dataIndex: "phase",
      key: "phase",
      width: TABLE_COL_WIDTH.status,
      align: "left",
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: PHASE_OPTIONS.filter((item) => item.value).map((item) => ({ label: item.label, value: item.value })),
      },
      ...getSortableColumnProps("phase"),
      render: (phase: string) => <OpsStatusTag tone={podPhaseTone(phase)}>{phase}</OpsStatusTag>,
    },
    {
      title: "CPU 使用率",
      dataIndex: "cpuUsage",
      key: "cpuUsage",
      width: 160,
      align: "left",
      ...getSortableColumnProps("cpuUsage"),
      render: (_: unknown, row: PodRow) => renderUsageCell(row.cpuUsage ?? row.cpuUsagePercent, row, "cpu"),
    },
    {
      title: "内存使用率",
      dataIndex: "memoryUsage",
      key: "memoryUsage",
      width: 160,
      align: "left",
      ...getSortableColumnProps("memoryUsage"),
      render: (_: unknown, row: PodRow) => renderUsageCell(row.memoryUsage ?? row.memoryUsagePercent, row, "memory"),
    },
    {
      title: <span style={{ whiteSpace: "nowrap" }}>重启次数</span>,
      dataIndex: "restartCount",
      key: "restartCount",
      width: 116,
      align: "left",
      ...getSortableColumnProps("restartCount"),
    },
    {
      title: "Pod IP",
      dataIndex: "podIP",
      key: "podIP",
      filter: { type: "text", placeholder: "以 IP 过滤" },
      width: TABLE_COL_WIDTH.ip,
      align: "left",
      ...getSortableColumnProps("podIP"),
    },
    {
      title: "节点",
      dataIndex: "nodeName",
      key: "nodeName",
      filter: { type: "text", placeholder: "以节点过滤" },
      width: TABLE_COL_WIDTH.node,
      align: "left",
      ellipsis: true,
      ...getSortableColumnProps("nodeName"),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      align: "left",
      ...getSortableColumnProps("createdAt"),
      render: (v: string) => <ResourceTimeCell value={v} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "quick-actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      align: "left",
      render: (_: unknown, row: PodRow) => (
        <OpsActionDropdown
          items={buildActionItems()}
          onClick={({ key }) => {
            if (key === "description") {
              if (row.id) setDetailTarget({ kind: "Pod", id: row.id });
              return;
            }
            if (key === "logs") {
              if (row.id) router.push(`/logs?${buildLogsParams(row)}`);
              return;
            }
            if (key === "terminal") {
              if (row.id) router.push(`/terminal?${buildTerminalParams(row)}`);
              return;
            }
            if (key === "yaml") {
              if (row.id) setYamlTarget(resolveIdentity(row));
              return;
            }
            if (key === "delete") {
              Modal.confirm({
                title: "确认删除 Pod",
                content: `删除 Pod ${row.name} 后将不可恢复`,
                okText: "确认",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => void handleDelete(row),
              });
            }
          }}
          ariaLabel="操作"
          placement="bottomRight"
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/workloads/pods"
          embedded
          description="查看和管理集群中运行的 Pod 实例。"
          style={{ marginBottom: 12 }}
          titleSuffix={
            <ResourceAddButton
              onClick={() => router.push("/workloads/create?kind=Pod")}
              aria-label="创建Pod"
            />
          }
        />
        <ResourceScopeFilterButton
          clusterId={clusterId}
          namespace={namespace}
          clusterOptions={clusterFilterOptions}
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
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再查看 Pod 信息。" style={{ marginBottom: 12 }} />
        ) : null}

        {podsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="加载失败"
            description={
              podsQuery.error instanceof Error ? podsQuery.error.message : "获取 Pod 数据时发生错误"
            }
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <ResourceTable<PodRow>
          rowKey="key"
          tableKey="workloads.pods"
          bordered
          columns={columns as ColumnsType<PodRow>}
          dataSource={displayedRows}
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按 Pod 名称/标签搜索（示例：nginx app=web env=prod）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          loading={{ spinning: podsQuery.isLoading && !podsQuery.data, description: "Pod 数据加载中..." }}
          onChange={(paginationInfo, filters, sorter, extra) =>
            handleTableChange(paginationInfo, filters, sorter, extra, tableBusy)
          }
          pagination={getPaginationConfig(displayedTotal, tableBusy)}
          emptyDescription="暂无 Pod 数据。集群接入完成后，平台将自动同步 Pod 信息。"
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        onNavigateRequest={(request) => setDetailTarget(request)}
        token={accessToken || undefined}
      />

      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        onClose={() => setYamlTarget(null)}
        identity={yamlTarget}
        token={accessToken || undefined}
        onUpdated={() => {
          void message.success("YAML 更新成功");
          void podsQuery.refetch();
        }}
      />
    </Space>
  );
}
