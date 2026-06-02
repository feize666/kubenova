"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Select, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import type { ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
  ResourceKeywordSearch,
} from "@/components/resource-filter-toolbar";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { StatusTag } from "@/components/status-tag";
import { getClusters, getClusterNodes } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import type { ClusterNodeListItemModel } from "@/lib/contracts/domain";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";

type DetailTarget = NonNullable<ResourceDetailDrawerProps["request"]>;

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function renderMetric(value: number | null | undefined, capacity: string | null | undefined) {
  if (value === null || value === undefined) {
    return (
      <Space size={4}>
        <Typography.Text>N/A</Typography.Text>
        {capacity ? <Typography.Text type="secondary">/ {capacity}</Typography.Text> : null}
      </Space>
    );
  }
  return (
    <Space size={4}>
      <Typography.Text>{value}%</Typography.Text>
      {capacity ? <Typography.Text type="secondary">/ {capacity}</Typography.Text> : null}
    </Space>
  );
}

function renderRoles(roles: string[]) {
  const visibleRoles = roles.length > 0 ? roles : ["worker"];
  return (
    <Space size={4} wrap>
      {visibleRoles.map((role) => (
        <Tag key={role} color={role === "control-plane" || role === "master" ? "purple" : "blue"}>
          {role}
        </Tag>
      ))}
    </Space>
  );
}

export default function ClusterNodesPage() {
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const [clusterId, setClusterId] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const { resetPage, getSortableColumnProps, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<ClusterNodeListItemModel>({
      defaultPageSize: 10,
      allowedSortBy: ["name", "ready", "kubeletVersion", "createdAt"],
    });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "nodes-page", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const effectiveClusterId = clusterId || clusterOptions[0]?.value || "";
  const selectedClusterName = clusterOptions.find((item) => item.value === effectiveClusterId)?.label ?? "";

  const nodesQuery = useQuery({
    queryKey: ["clusters", "nodes", effectiveClusterId, accessToken],
    queryFn: () => getClusterNodes(effectiveClusterId, accessToken || undefined),
    enabled: !isInitializing && Boolean(accessToken) && Boolean(effectiveClusterId),
  });

  const tableData = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    const nameFilter = getTextFilter(tableFilters, "name");
    const readyFilter = typeof tableFilters.ready === "string" ? tableFilters.ready : "";
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
      const matchReady = readyFilter ? String(item.ready) === readyFilter : true;
      const matchRole = textMatches(item.roles.join(" "), roleFilter);
      const matchVersion = textMatches(item.kubeletVersion, versionFilter);
      return matchKeyword && matchName && matchReady && matchRole && matchVersion;
    });
  }, [keyword, nodesQuery.data?.items, tableFilters]);
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 360 }),
    [tableData],
  );

  const columns: Array<HeadlampResourceTableColumn<ClusterNodeListItemModel>> = [
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
      render: (value: boolean) => <StatusTag state={value ? "succeeded" : "failed"} />,
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
      width: 140,
      render: (_: number | null, row) => renderMetric(row.cpuUsagePercent, row.cpuCapacity),
    },
    {
      title: "内存",
      dataIndex: "memoryUsagePercent",
      key: "memoryUsagePercent",
      width: 150,
      render: (_: number | null, row) => renderMetric(row.memoryUsagePercent, row.memoryCapacity),
    },
    {
      title: "Taints",
      dataIndex: "taints",
      key: "taints",
      width: 180,
      render: (value: string[]) =>
        value.length > 0 ? (
          <Space size={4} wrap>
            {value.slice(0, 2).map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
            {value.length > 2 ? <Tag>+{value.length - 2}</Tag> : null}
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
      render: (value: string | null) => <ResourceTimeCell value={value ?? undefined} now={now} />,
      ...getSortableColumnProps("createdAt"),
    },
  ];

  const handleSearch = () => {
    resetPage();
    setKeyword(keywordInput.trim());
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/clusters/nodes"
          embedded
          freshness={
            nodesQuery.data?.timestamp
              ? { label: "采集时间", value: nodesQuery.data.timestamp, color: "blue" }
              : undefined
          }
          extra={
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void nodesQuery.refetch()}
              loading={nodesQuery.isFetching}
              disabled={!effectiveClusterId}
            >
              刷新
            </Button>
          }
        />
      </Card>

      <Card className="cyber-panel">
        <ResourceFilterToolbar
          actions={
            <Button type="primary" onClick={handleSearch}>
              查询
            </Button>
          }
        >
          <ResourceFilterToolbarItem label="集群" width="md">
            <Select
              showSearch
              allowClear={false}
              placeholder="选择集群"
              value={effectiveClusterId || undefined}
              loading={clustersQuery.isLoading}
              options={clusterOptions}
              optionFilterProp="label"
              onChange={(value) => {
                resetPage();
                setClusterId(value);
              }}
              style={{ width: "100%" }}
            />
          </ResourceFilterToolbarItem>
          <ResourceKeywordSearch
            value={keywordInput}
            onChange={setKeywordInput}
            onSearch={handleSearch}
            placeholder="搜索名称 / 角色 / IP / 版本"
            width="xl"
          />
        </ResourceFilterToolbar>
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon title="未检测到登录状态，请先登录后再查看工作节点。" />
      ) : null}

      {!clustersQuery.isLoading && clusterOptions.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="暂无可读集群"
          description="工作节点页面需要已启用、已配置 kubeconfig 且健康探测可读的集群。"
        />
      ) : null}

      {nodesQuery.data?.degraded ? (
        <Alert
          type="warning"
          showIcon
          title="节点数据处于降级状态"
          description={nodesQuery.data.degradationReason ?? "当前集群节点数据不可用"}
        />
      ) : null}

      {nodesQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="工作节点加载失败"
          description={nodesQuery.error instanceof Error ? nodesQuery.error.message : "获取节点数据时发生错误"}
        />
      ) : null}

      <Card className="cyber-panel">
        {!effectiveClusterId && !clustersQuery.isLoading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择集群" />
        ) : (
          <ResourceTable<ClusterNodeListItemModel>
            rowKey="id"
            tableKey="business.cluster-nodes"
            columns={columns as ColumnsType<ClusterNodeListItemModel>}
            dataSource={tableData}
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
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
              handleTableChange(nextPagination, filters, sorter, extra, nodesQuery.isLoading)
            }
            pagination={getPaginationConfig(nodesQuery.data?.total ?? tableData.length, nodesQuery.isLoading)}
            layoutOptions={{
              nameValues: tableData.map((item) => item.name),
              actionWidth: 0,
            }}
            emptyDescription="暂无符合条件的工作节点"
          />
        )}
      </Card>
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
