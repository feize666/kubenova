"use client";

import {
  BugOutlined,
  CodeOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  MoreOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Dropdown,
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
import type { ColumnsType, ColumnType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { PodMetricCell } from "@/components/visual-system";
import { ClusterSelect } from "@/components/cluster-select";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { getClusters } from "@/lib/api/clusters";
import { buildLogsRoute } from "@/lib/api/logs";
import {
  deleteWorkload,
  getWorkloadsByKind,
} from "@/lib/api/workloads";
import type { WorkloadListItem, WorkloadKindParam } from "@/lib/api/workloads";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { NamespaceSelect } from "@/components/namespace-select";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { buildTerminalRoute } from "@/lib/workloads/terminal";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";

// Pod 状态类型
type PodPhase = "Running" | "Pending" | "Failed" | "Succeeded" | string;

function podPhaseColor(phase: PodPhase): string {
  if (phase === "Running") return "green";
  if (phase === "Pending") return "gold";
  if (phase === "Failed") return "red";
  if (phase === "Succeeded") return "blue";
  return "default";
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

export default function PodsPage() {
  const router = useRouter();
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();

  // 筛选状态
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
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

  // Client-side filtering only applies to labels on the current backend page.
  const tableData = useMemo<PodRow[]>(() => {
    let nextRows = rows.filter((row) => hasKnownCluster(clusterMap, row.clusterId));
    if (phaseFilter) {
      nextRows = nextRows.filter((row) => row.phase === phaseFilter);
    }
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
  }, [clusterMap, mergedFilters, phaseFilter, rows]);
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
  const handleSearch = () => {
    const parsed = parseSearchInput(keywordInput);
    resetPage();
    setMergedFilters(parsed.labels);
    setKeyword(parsed.keyword);
  };

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

  function buildActionItems(): MenuProps["items"] {
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
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            无可用指标
          </Tag>
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

  const columns: ColumnsType<PodRow> = [
    {
      title: "Pod 名称",
      dataIndex: "name",
      key: "name",
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
            {name}
          </Typography.Link>
        ) : (
          <Typography.Text code style={{ fontSize: 12 }}>
            {name}
          </Typography.Text>
        ),
    } as unknown as ColumnType<PodRow>,
    {
      title: "集群",
      dataIndex: "clusterId",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      align: "left",
      ellipsis: true,
      ...getSortableColumnProps("clusterId"),
      render: (_: unknown, row: PodRow) => getClusterDisplayName(clusterMap, row.clusterId),
    } as unknown as ColumnType<PodRow>,
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      align: "left",
      ...getSortableColumnProps("namespace"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "就绪",
      dataIndex: "readyReplicas",
      key: "readyReplicas",
      width: 90,
      align: "left",
      ...getSortableColumnProps("readyReplicas"),
      render: (_: unknown, row: PodRow) => `${row.readyReplicas}/${row.replicas}`,
    } as unknown as ColumnType<PodRow>,
    {
      title: "状态",
      dataIndex: "phase",
      key: "phase",
      width: TABLE_COL_WIDTH.status,
      align: "left",
      ...getSortableColumnProps("phase"),
      render: (phase: string) => <Tag color={podPhaseColor(phase)}>{phase}</Tag>,
    } as unknown as ColumnType<PodRow>,
    {
      title: "CPU 使用率",
      dataIndex: "cpuUsage",
      key: "cpuUsage",
      width: 160,
      align: "left",
      ...getSortableColumnProps("cpuUsage"),
      render: (_: unknown, row: PodRow) => renderUsageCell(row.cpuUsage ?? row.cpuUsagePercent, row, "cpu"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "内存使用率",
      dataIndex: "memoryUsage",
      key: "memoryUsage",
      width: 160,
      align: "left",
      ...getSortableColumnProps("memoryUsage"),
      render: (_: unknown, row: PodRow) => renderUsageCell(row.memoryUsage ?? row.memoryUsagePercent, row, "memory"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "重启次数",
      dataIndex: "restartCount",
      key: "restartCount",
      width: TABLE_COL_WIDTH.replicas,
      align: "left",
      ...getSortableColumnProps("restartCount"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "Pod IP",
      dataIndex: "podIP",
      key: "podIP",
      width: TABLE_COL_WIDTH.ip,
      align: "left",
      ...getSortableColumnProps("podIP"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "节点",
      dataIndex: "nodeName",
      key: "nodeName",
      width: TABLE_COL_WIDTH.node,
      align: "left",
      ellipsis: true,
      ...getSortableColumnProps("nodeName"),
    } as unknown as ColumnType<PodRow>,
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      align: "left",
      ...getSortableColumnProps("createdAt"),
      render: (v: string) => <ResourceTimeCell value={v} now={now} mode="relative" />,
    } as unknown as ColumnType<PodRow>,
    {
      title: "操作",
      key: "quick-actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      align: "left",
      render: (_: unknown, row: PodRow) => (
        <Dropdown
          menu={{
            items: buildActionItems(),
            onClick: ({ key }) => {
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
            },
          }}
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: "pod-actions-dropdown" }}
        >
          <Button size="small" className="pod-action-trigger" icon={<MoreOutlined />} aria-label="操作" />
        </Dropdown>
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
              aria-label="新增 Pod"
            />
          }
        />
        <Row gutter={[8, 8]} align="middle" style={{ marginBottom: 10 }}>
          <Col xs={24} sm={12} md={5} lg={4}>
            <ClusterSelect
              value={clusterId}
              onChange={(v) => {
                onClusterChange(v);
                resetPage();
              }}
              options={clusterFilterOptions}
              loading={clustersQuery.isLoading}
            />
          </Col>
          <Col xs={24} sm={12} md={4} lg={3}>
            <NamespaceSelect
              value={namespace}
              onChange={(v) => {
                onNamespaceChange(v);
                resetPage();
              }}
              knownNamespaces={knownNamespaces}
              clusterId={clusterId}
              disabled={namespaceDisabled}
              placeholder={namespacePlaceholder}
            />
          </Col>
          <Col xs={24} md={7} lg={6}>
            <Input
              allowClear
              placeholder="按 Pod 名称/标签搜索（示例：nginx app=web env=prod）"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col xs={24} sm={12} md={4} lg={3}>
            <Select
              className="resource-filter-select"
              style={{ width: "100%" }}
              value={phaseFilter}
              onChange={(v) => {
                setPhaseFilter(v);
                resetPage();
              }}
              options={PHASE_OPTIONS}
              placeholder="状态过滤"
            />
          </Col>
          <Col xs={24} md={3} lg={3}>
            <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch}>
              查询
            </Button>
          </Col>
        </Row>

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

        <Table<PodRow>
          rowKey="key"
          bordered
          columns={columns}
          dataSource={displayedRows}
          loading={{ spinning: podsQuery.isLoading && !podsQuery.data, description: "Pod 数据加载中..." }}
          scroll={{ x: getTableScrollX(columns) }}
          className="pod-table"
          onChange={(paginationInfo, filters, sorter, extra) =>
            handleTableChange(paginationInfo, filters, sorter, extra, tableBusy)
          }
          pagination={getPaginationConfig(displayedTotal, tableBusy)}
          locale={{
            emptyText:
              podsQuery.isLoading && !podsQuery.data ? (
                "正在加载..."
              ) : (
                <Empty description="暂无 Pod 数据。如已配置集群 kubeconfig，平台将自动同步 Pod 信息。" />
              ),
          }}
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
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

      <style>{`
        .pod-action-trigger.ant-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 30px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid var(--pod-action-trigger-border);
          background: var(--pod-action-trigger-bg);
          color: var(--pod-action-trigger-text);
          box-shadow: var(--pod-action-trigger-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(14px);
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            border-color 0.18s ease,
            background 0.18s ease;
        }

        .pod-action-trigger.ant-btn:hover,
        .pod-action-trigger.ant-btn:focus-visible {
          border-color: var(--pod-action-trigger-border-hover);
          background: var(--pod-action-trigger-bg-hover);
          color: var(--pod-action-trigger-text-hover);
          box-shadow: var(--pod-action-trigger-shadow-hover), 0 0 0 4px var(--pod-action-trigger-ring), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .pod-action-trigger.ant-btn:hover {
          transform: translateY(-1px);
        }

        .pod-action-trigger .ant-btn-icon .anticon {
          color: var(--pod-action-trigger-icon);
          font-size: 13px;
        }

        .pod-action-trigger .ant-btn-icon + span {
          font-weight: 600;
          letter-spacing: 0.01em;
        }

        .pod-actions-dropdown .ant-dropdown-menu {
          min-width: 188px;
          padding: 8px;
          border-radius: 16px;
          border: 1px solid var(--pod-actions-menu-border);
          background: var(--pod-actions-menu-bg);
          box-shadow: var(--pod-actions-menu-shadow);
          backdrop-filter: blur(18px);
        }

        .pod-actions-dropdown .ant-dropdown-menu-item {
          min-height: 38px;
          margin: 2px 0;
          padding: 8px 12px;
          border-radius: 12px;
          color: var(--pod-actions-menu-item-text);
          transition: background-color 0.18s ease, transform 0.18s ease;
        }

        .pod-actions-dropdown .ant-dropdown-menu-item:hover {
          background: var(--pod-actions-menu-item-hover);
          transform: translateX(1px);
        }

        .pod-actions-dropdown .ant-dropdown-menu-item-danger:hover {
          background: var(--pod-actions-menu-item-danger-hover);
        }

        .pod-actions-dropdown .ant-dropdown-menu-item .ant-dropdown-menu-title-content {
          font-size: 13px;
          font-weight: 500;
        }

        .pod-actions-dropdown .ant-dropdown-menu-item .anticon {
          font-size: 14px;
          color: var(--pod-actions-menu-item-icon);
        }

        .pod-actions-dropdown .ant-dropdown-menu-item-danger .anticon {
          color: var(--pod-actions-menu-item-danger-icon);
        }

        .pod-actions-dropdown .ant-dropdown-menu-item-divider {
          margin: 6px 4px;
          border-color: rgba(148, 163, 184, 0.16);
        }

      `}</style>
    </Space>
  );
}
