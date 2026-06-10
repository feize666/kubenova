"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Space, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsEmptyState, OpsFilterChip, OpsSurface } from "@/components/ops";
import type { ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
} from "@/components/resource-filter-toolbar";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { StatusTag } from "@/components/status-tag";
import { getClusters, getClusterNodes } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import type { ClusterNodeListItemModel } from "@/lib/contracts/domain";
import {
  useAntdTableSortPagination,
  type HeadlampResourceTableColumn,
  type HeadlampTableFilters,
} from "@/lib/table";
import {
  TABLE_COL_WIDTH,
  getAdaptiveNameWidth,
} from "@/lib/table-column-widths";

type DetailTarget = NonNullable<ResourceDetailDrawerProps["request"]>;

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return (
    !filterValue ||
    String(value ?? "")
      .toLowerCase()
      .includes(filterValue)
  );
}

function parseCpuToCores(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return null;
  if (trimmed.endsWith("n")) return numeric / 1_000_000_000;
  if (trimmed.endsWith("u") || trimmed.endsWith("µ") || trimmed.endsWith("μ"))
    return numeric / 1_000_000;
  if (trimmed.endsWith("m")) return numeric / 1_000;
  if (trimmed.endsWith("K") || trimmed.endsWith("k")) return numeric * 1_000;
  if (trimmed.endsWith("M")) return numeric * 1_000_000;
  if (trimmed.endsWith("G")) return numeric * 1_000_000_000;
  return numeric;
}

function parseMemoryToBytes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)?$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const suffix = (match[2] ?? "").toLowerCase();
  const units: Record<string, number> = {
    "": 1,
    k: 1_000,
    m: 1_000_000,
    g: 1_000_000_000,
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
  };
  const base = units[suffix];
  return base ? amount * base : null;
}

function formatCpu(cores: number): string {
  if (cores > 0 && cores < 1) return `${Math.round(cores * 1000)}m`;
  return `${Math.round(cores * 10) / 10}`;
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3)
    return `${Math.round((bytes / 1024 ** 3) * 10) / 10}Gi`;
  if (bytes >= 1024 ** 2)
    return `${Math.round((bytes / 1024 ** 2) * 10) / 10}Mi`;
  if (bytes >= 1024) return `${Math.round((bytes / 1024) * 10) / 10}Ki`;
  return `${Math.round(bytes)}B`;
}

function renderUsageBar(
  usage: string | null | undefined,
  capacity: string | null | undefined,
  type: "cpu" | "memory",
) {
  const usedValue =
    type === "cpu" ? parseCpuToCores(usage) : parseMemoryToBytes(usage);
  const capacityValue =
    type === "cpu" ? parseCpuToCores(capacity) : parseMemoryToBytes(capacity);
  const rawPercent =
    usedValue !== null && capacityValue !== null && capacityValue > 0
      ? (usedValue / capacityValue) * 100
      : null;
  const percent =
    typeof rawPercent === "number" && Number.isFinite(rawPercent)
      ? Math.max(0, Math.min(rawPercent, 100))
      : null;

  if (percent === null || capacityValue === null) {
    return (
      <Tooltip title="未检测到 metrics-server 节点指标，当前仅显示容量。">
        <span className="node-usage-fallback">
          {capacity ? formatK8sQuantity(capacity, type) : "N/A"}
        </span>
      </Tooltip>
    );
  }

  const formatter = type === "cpu" ? formatCpu : formatMemory;
  const tooltip = `${formatter(usedValue ?? 0)} of ${formatter(capacityValue)} (${(rawPercent ?? 0).toFixed(1)}%)`;
  return (
    <Tooltip title={tooltip}>
      <span className="node-usage-cell" aria-label={tooltip}>
        <span className="node-usage-track">
          <span className="node-usage-fill" style={{ width: `${percent}%` }} />
        </span>
      </span>
    </Tooltip>
  );
}

function formatK8sQuantity(value: string, type: "cpu" | "memory"): string {
  const parsed =
    type === "cpu" ? parseCpuToCores(value) : parseMemoryToBytes(value);
  if (parsed === null) return value;
  return type === "cpu" ? formatCpu(parsed) : formatMemory(parsed);
}

function renderRoles(roles: string[]) {
  const visibleRoles = roles.length > 0 ? roles : ["worker"];
  return (
    <Space size={4} wrap>
      {visibleRoles.map((role) => (
        <OpsFilterChip
          key={role}
          tone={
            role === "control-plane" || role === "master" ? "warning" : "info"
          }
        >
          {role}
        </OpsFilterChip>
      ))}
    </Space>
  );
}

export default function ClusterNodesPage() {
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const [clusterId, setClusterId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const {
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<ClusterNodeListItemModel>({
    defaultPageSize: 10,
    allowedSortBy: ["name", "ready", "kubeletVersion", "createdAt"],
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "nodes-page", accessToken],
    queryFn: () =>
      getClusters(
        { pageSize: 200, state: "active", selectableOnly: true },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () =>
      (clustersQuery.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [clustersQuery.data?.items],
  );
  const effectiveClusterId = clusterId || clusterOptions[0]?.value || "";
  const selectedClusterName =
    clusterOptions.find((item) => item.value === effectiveClusterId)?.label ??
    "";

  const nodesQuery = useQuery({
    queryKey: ["clusters", "nodes", effectiveClusterId, accessToken],
    queryFn: () =>
      getClusterNodes(effectiveClusterId, accessToken || undefined),
    enabled:
      !isInitializing && Boolean(accessToken) && Boolean(effectiveClusterId),
  });

  const tableData = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    const nameFilter = getTextFilter(tableFilters, "name");
    const readyFilter =
      typeof tableFilters.ready === "string" ? tableFilters.ready : "";
    const roleFilter = getTextFilter(tableFilters, "roles");
    const versionFilter = getTextFilter(tableFilters, "kubeletVersion");
    return (nodesQuery.data?.items ?? []).filter((item) => {
      const joined = [
        item.name,
        item.roles.join(" "),
        item.internalIP,
        item.externalIP,
        item.kubeletVersion,
        item.containerRuntimeVersion,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchKeyword = search ? joined.includes(search) : true;
      const matchName = textMatches(item.name, nameFilter);
      const matchReady = readyFilter
        ? String(item.ready) === readyFilter
        : true;
      const matchRole = textMatches(item.roles.join(" "), roleFilter);
      const matchVersion = textMatches(item.kubeletVersion, versionFilter);
      return (
        matchKeyword && matchName && matchReady && matchRole && matchVersion
      );
    });
  }, [keyword, nodesQuery.data?.items, tableFilters]);
  const nameWidth = useMemo(
    () =>
      getAdaptiveNameWidth(
        tableData.map((item) => item.name),
        { max: 360 },
      ),
    [tableData],
  );

  const columns: Array<HeadlampResourceTableColumn<ClusterNodeListItemModel>> =
    [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        width: nameWidth,
        ellipsis: true,
        filter: { type: "text", placeholder: "按节点名称过滤" },
        render: (value: string, row) => (
          <Typography.Link
            strong
            onClick={() =>
              setDetailTarget({
                kind: "Node",
                id: `live-node:${effectiveClusterId}:${row.name}`,
                label: row.name,
              })
            }
          >
            {value}
          </Typography.Link>
        ),
        ...getSortableColumnProps("name"),
      },
      {
        title: "Ready",
        dataIndex: "ready",
        key: "ready",
        width: TABLE_COL_WIDTH.status,
        filter: {
          type: "select",
          placeholder: "按状态过滤",
          options: [
            { label: "就绪", value: "true" },
            { label: "未就绪", value: "false" },
          ],
        },
        render: (value: boolean) => (
          <StatusTag state={value ? "succeeded" : "failed"} />
        ),
        ...getSortableColumnProps("ready"),
      },
      {
        title: "角色",
        dataIndex: "roles",
        key: "roles",
        width: 180,
        filter: { type: "text", placeholder: "按角色过滤" },
        render: (value: string[]) => renderRoles(value),
      },
      {
        title: "CPU",
        dataIndex: "cpuUsagePercent",
        key: "cpuUsagePercent",
        width: 118,
        render: (_: number | null, row) =>
          renderUsageBar(row.cpuUsage, row.cpuCapacity, "cpu"),
      },
      {
        title: "内存",
        dataIndex: "memoryUsagePercent",
        key: "memoryUsagePercent",
        width: 128,
        render: (_: number | null, row) =>
          renderUsageBar(row.memoryUsage, row.memoryCapacity, "memory"),
      },
      {
        title: "Taints",
        dataIndex: "taints",
        key: "taints",
        width: 280,
        render: (value: string[]) =>
          value.length > 0 ? (
            <Space className="node-taints-cell" size={4} wrap>
              {value.slice(0, 2).map((item) => (
                <OpsFilterChip
                  key={item}
                  className="node-taint-chip"
                  title={item}
                  tone="neutral"
                >
                  {item}
                </OpsFilterChip>
              ))}
              {value.length > 2 ? (
                <OpsFilterChip tone="neutral">
                  +{value.length - 2}
                </OpsFilterChip>
              ) : null}
            </Space>
          ) : (
            <Typography.Text type="secondary">无</Typography.Text>
          ),
      },
      {
        title: "Internal IP",
        dataIndex: "internalIP",
        key: "internalIP",
        width: 150,
        render: (value: string | null) => value ?? "—",
      },
      {
        title: "External IP",
        dataIndex: "externalIP",
        key: "externalIP",
        width: 150,
        render: (value: string | null) => value ?? "—",
      },
      {
        title: "Kubelet",
        dataIndex: "kubeletVersion",
        key: "kubeletVersion",
        width: TABLE_COL_WIDTH.version,
        filter: { type: "text", placeholder: "按版本过滤" },
        render: (value: string | undefined) => value ?? "—",
        ...getSortableColumnProps("kubeletVersion"),
      },
      {
        title: "Age",
        dataIndex: "createdAt",
        key: "createdAt",
        width: TABLE_COL_WIDTH.updateTime,
        render: (value: string | null) => (
          <ResourceTimeCell value={value ?? undefined} now={now} />
        ),
        ...getSortableColumnProps("createdAt"),
      },
    ];

  const handleGlobalSearchChange = (value: string) => {
    resetPage();
    setKeyword(value.trim());
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsSurface variant="panel" padding="sm">
        <ResourcePageHeader
          path="/clusters/nodes"
          style={{ marginBottom: 12 }}
        />
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <ResourceFilterToolbar>
            <ResourceFilterToolbarItem width="auto">
              <ResourceScopeFilterButton
                label="集群"
                clusterId={effectiveClusterId}
                namespaceVisible={false}
                clusterOptions={clusterOptions}
                clusterLoading={clustersQuery.isLoading}
                onApply={({ clusterId: nextClusterId }) => {
                  resetPage();
                  setClusterId(nextClusterId || clusterOptions[0]?.value || "");
                }}
              />
            </ResourceFilterToolbarItem>
          </ResourceFilterToolbar>

          {!isInitializing && !accessToken ? (
            <Alert
              className="cluster-resource-state-alert"
              type="warning"
              showIcon
              title="未检测到登录状态，请先登录后再查看工作节点。"
            />
          ) : null}

          {!clustersQuery.isLoading && clusterOptions.length === 0 ? (
            <Alert
              className="cluster-resource-state-alert"
              type="info"
              showIcon
              title="暂无可读集群"
              description="工作节点页面需要已启用、已配置 kubeconfig 且健康探测可读的集群。"
            />
          ) : null}

          {nodesQuery.data?.degraded ? (
            <Alert
              className="cluster-resource-state-alert"
              type="warning"
              showIcon
              title="节点数据处于降级状态"
              description={
                nodesQuery.data.degradationReason ?? "当前集群节点数据不可用"
              }
            />
          ) : null}

          {nodesQuery.isError ? (
            <Alert
              className="cluster-resource-state-alert"
              type="error"
              showIcon
              title="工作节点加载失败"
              description={
                nodesQuery.error instanceof Error
                  ? nodesQuery.error.message
                  : "获取节点数据时发生错误"
              }
            />
          ) : null}

          {!effectiveClusterId && !clustersQuery.isLoading ? (
            <OpsEmptyState
              title="请先选择集群"
              description="工作节点列表需要一个可读集群作为数据源。"
            />
          ) : (
            <ResourceTable<ClusterNodeListItemModel>
              rowKey="id"
              tableKey="business.cluster-nodes"
              columns={columns as ColumnsType<ClusterNodeListItemModel>}
              onResourceNavigate={(request) => setDetailTarget(request)}
              dataSource={tableData}
              preferencesClient={createTablePreferencesClient(
                accessToken || undefined,
              )}
              globalSearch={{
                value: keyword,
                onChange: handleGlobalSearchChange,
                placeholder: "搜索名称 / 角色 / IP / 版本",
              }}
              filters={tableFilters}
              onFiltersChange={(nextFilters) => {
                setTableFilters(nextFilters);
                resetPage();
              }}
              loading={{
                spinning: clustersQuery.isLoading || nodesQuery.isLoading,
                description: selectedClusterName
                  ? `${selectedClusterName} 工作节点加载中...`
                  : "工作节点加载中...",
              }}
              onChange={(nextPagination, filters, sorter, extra) =>
                handleTableChange(
                  nextPagination,
                  filters,
                  sorter,
                  extra,
                  nodesQuery.isLoading,
                )
              }
              pagination={getPaginationConfig(
                nodesQuery.data?.total ?? tableData.length,
                nodesQuery.isLoading,
              )}
              layoutOptions={{
                nameValues: tableData.map((item) => item.name),
                actionWidth: 0,
              }}
              emptyDescription="暂无符合条件的工作节点"
            />
          )}
        </Space>
      </OpsSurface>
      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => setDetailTarget(request)}
      />
    </Space>
  );
}
