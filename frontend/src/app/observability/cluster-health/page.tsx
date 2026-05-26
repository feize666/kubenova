"use client";

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
} from "@/components/resource-filter-toolbar";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { useAntdTableSortPagination } from "@/lib/table";
import {
  getClusterHealthDetail,
  getClusterHealthList,
  probeClusterHealth,
  type ClusterHealthListItem,
  type RuntimeStatus,
} from "@/lib/api/cluster-health";

function lifecycleLabel(state: ClusterHealthListItem["lifecycleState"]) {
  if (state === "active") return "启用";
  if (state === "disabled") return "已停用";
  return "已删除";
}

function runtimeStatusTag(status: RuntimeStatus) {
  if (status === "running") {
    return (
      <Tag color="green" icon={<CheckCircleOutlined />}>
        运行中
      </Tag>
    );
  }
  if (status === "offline") {
    return (
      <Tag color="red" icon={<ExclamationCircleOutlined />}>
        离线
      </Tag>
    );
  }
  if (status === "checking") {
    return (
      <Tag color="processing" icon={<SyncOutlined spin />}>
        探测中
      </Tag>
    );
  }
  if (status === "disabled") {
    return <Tag>已停用</Tag>;
  }
  return (
    <Tag color="blue" icon={<ClockCircleOutlined />}>离线模式</Tag>
  );
}

function lifecycleTag(state: ClusterHealthListItem["lifecycleState"]) {
  if (state === "active") return <Tag color="green">{lifecycleLabel(state)}</Tag>;
  if (state === "disabled") return <Tag color="orange">{lifecycleLabel(state)}</Tag>;
  return <Tag>{lifecycleLabel(state)}</Tag>;
}

function sourceTag(source: ClusterHealthListItem["source"]) {
  if (!source) return <Tag>未记录</Tag>;
  if (source === "manual") return <Tag color="purple">手动触发</Tag>;
  if (source === "event") return <Tag color="gold">事件触发</Tag>;
  return <Tag color="cyan">自动探测</Tag>;
}

function resolveProbeFailureReason(reason?: string | null) {
  const normalizedReason = reason?.trim();
  return normalizedReason ? normalizedReason : "暂未返回失败原因";
}

export default function ClusterHealthCenterPage() {
  const { accessToken, isInitializing } = useAuth();
  const enabled = !isInitializing && Boolean(accessToken);
  const clustersQuery = useQuery({
    queryKey: ["clusters", "cluster-health", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken || ""),
    enabled,
  });

  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [environment, setEnvironment] = useState("");
  const [provider, setProvider] = useState("");
  const [lifecycleState, setLifecycleState] = useState<"" | "active" | "disabled" | "deleted">("");
  const [runtimeStatus, setRuntimeStatus] = useState<"" | RuntimeStatus>("");
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const {
    sortBy,
    sortOrder,
    pagination,
    setPagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } =
    useAntdTableSortPagination<ClusterHealthListItem>({
      defaultPageSize: 10,
      allowedSortBy: ["clusterName", "runtimeStatus", "checkedAt", "latencyMs"],
    });
  const [detailClusterId, setDetailClusterId] = useState<string>("");
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const healthQuery = useQuery({
    queryKey: [
      "cluster-health",
      {
        keyword,
        environment,
        provider,
        lifecycleState,
        runtimeStatus,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      },
      accessToken,
    ],
    queryFn: () =>
      getClusterHealthList(
        {
          keyword: keyword.trim() || undefined,
          environment: environment || undefined,
          provider: provider || undefined,
          lifecycleState: lifecycleState || undefined,
          runtimeStatus: runtimeStatus || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken || undefined,
      ),
    enabled,
    refetchInterval: 30_000,
  });
  const detailQuery = useQuery({
    queryKey: ["cluster-health-detail", detailClusterId, accessToken],
    queryFn: () => getClusterHealthDetail(detailClusterId, accessToken || undefined),
    enabled: enabled && Boolean(detailClusterId),
  });

  const manualProbeMutation = useMutation({
    mutationFn: (clusterId: string) => probeClusterHealth(clusterId, accessToken || undefined),
    onSuccess: (result) => {
      void message.success(
        result.ok
          ? `探测成功，耗时 ${result.latencyMs ?? 0}ms`
          : `探测失败：${resolveProbeFailureReason(result.reason)}`,
      );
      void healthQuery.refetch();
      if (detailClusterId) {
        void detailQuery.refetch();
      }
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "手动探测失败");
    },
  });

  const items = useMemo(() => {
    const raw = healthQuery.data?.items ?? [];
    const clusterFilter = typeof tableFilters.clusterName === "string" ? tableFilters.clusterName.toLowerCase() : "";
    const lifecycleFilter = typeof tableFilters.lifecycleState === "string" ? tableFilters.lifecycleState : "";
    const runtimeFilter = typeof tableFilters.runtimeStatus === "string" ? tableFilters.runtimeStatus : "";
    const sourceFilter = typeof tableFilters.source === "string" ? tableFilters.source : "";
    const reasonFilter = typeof tableFilters.reason === "string" ? tableFilters.reason.toLowerCase() : "";
    return raw.filter((item) => {
      const clusterName = getClusterDisplayName(clusterMap, item.clusterId, item.clusterName).toLowerCase();
      const matchCluster = clusterFilter
        ? item.clusterId.toLowerCase().includes(clusterFilter) || clusterName.includes(clusterFilter)
        : true;
      const matchLifecycle = lifecycleFilter ? item.lifecycleState === lifecycleFilter : true;
      const matchRuntime = runtimeFilter ? item.runtimeStatus === runtimeFilter : true;
      const matchSource = sourceFilter ? item.source === sourceFilter : true;
      const matchReason = reasonFilter ? (item.reason ?? "").toLowerCase().includes(reasonFilter) : true;
      return matchCluster && matchLifecycle && matchRuntime && matchSource && matchReason;
    });
  }, [
    clusterMap,
    healthQuery.data?.items,
    tableFilters.clusterName,
    tableFilters.lifecycleState,
    tableFilters.reason,
    tableFilters.runtimeStatus,
    tableFilters.source,
  ]);
  const stats = useMemo(() => {
    const total = items.length;
    const running = items.filter((item) => item.runtimeStatus === "running").length;
    const offline = items.filter((item) => item.runtimeStatus === "offline").length;
    const checking = items.filter((item) => item.runtimeStatus === "checking").length;
    return { total, running, offline, checking };
  }, [items]);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((healthQuery.data?.total ?? 0) / pagination.pageSize)),
    [healthQuery.data?.total, pagination.pageSize],
  );

  useEffect(() => {
    setPagination((prev) => {
      if (prev.pageIndex + 1 <= totalPages) {
        return prev;
      }
      return { ...prev, pageIndex: totalPages - 1 };
    });
  }, [setPagination, totalPages]);

  const columns: Array<HeadlampResourceTableColumn<ClusterHealthListItem>> = [
    {
      title: "集群",
      dataIndex: "clusterName",
      key: "clusterName",
      required: true,
      filter: { type: "text", placeholder: "以集群过滤" },
      ...getSortableColumnProps("clusterName", healthQuery.isLoading),
      render: (value: string, record) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{getClusterDisplayName(clusterMap, record.clusterId, value)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "生命周期",
      dataIndex: "lifecycleState",
      key: "lifecycleState",
      width: 120,
      filter: {
        type: "select",
        placeholder: "以生命周期过滤",
        options: [
          { label: lifecycleLabel("active"), value: "active" },
          { label: lifecycleLabel("disabled"), value: "disabled" },
          { label: lifecycleLabel("deleted"), value: "deleted" },
        ],
      },
      render: (value) => lifecycleTag(value),
    },
    {
      title: "运行状态",
      dataIndex: "runtimeStatus",
      key: "runtimeStatus",
      width: 140,
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: [
          { label: "运行中", value: "running" },
          { label: "离线", value: "offline" },
          { label: "探测中", value: "checking" },
          { label: "已停用", value: "disabled" },
          { label: "离线模式", value: "offline-mode" },
        ],
      },
      ...getSortableColumnProps("runtimeStatus", healthQuery.isLoading),
      render: (value: RuntimeStatus) => runtimeStatusTag(value),
    },
    {
      title: "延迟",
      dataIndex: "latencyMs",
      key: "latencyMs",
      width: 100,
      ...getSortableColumnProps("latencyMs", healthQuery.isLoading),
      render: (value: number | null) => (value === null ? "-" : `${value}ms`),
    },
    {
      title: "最近探测",
      dataIndex: "checkedAt",
      key: "checkedAt",
      width: 190,
      ...getSortableColumnProps("checkedAt", healthQuery.isLoading),
      render: (value: string | null, record) =>
        value ? (
          <Tooltip title={record.isStale ? "结果已过期" : "结果新鲜"}>
            <Typography.Text type={record.isStale ? "warning" : undefined}>
              {new Date(value).toLocaleString("zh-CN")}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">未探测</Typography.Text>
        ),
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以来源过滤",
        options: [
          { label: "手动触发", value: "manual" },
          { label: "事件触发", value: "event" },
          { label: "自动探测", value: "scheduled" },
        ],
      },
      render: (value) => sourceTag(value),
    },
    {
      title: "原因",
      dataIndex: "reason",
      key: "reason",
      filter: { type: "text", placeholder: "以原因过滤" },
      render: (value: string | null) => value || "-",
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: 220,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => setDetailClusterId(record.clusterId)}>
            详情
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SyncOutlined />}
            loading={manualProbeMutation.isPending}
            onClick={() => manualProbeMutation.mutate(record.clusterId)}
          >
            立即探测
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              集群健康中心
            </Typography.Title>
            <Typography.Text type="secondary">
              自动健康探测与故障定位入口。支持筛选、详情查看与手动探测兜底。
            </Typography.Text>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={() => void healthQuery.refetch()}>
              刷新
            </Button>
          </Col>
        </Row>
      </Card>

      {!enabled ? (
        <Alert type="warning" showIcon message="未登录或登录初始化中，请稍后重试。" />
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="集群总数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="运行中" value={stats.running} styles={{ content: { color: "#389e0d" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="离线" value={stats.offline} styles={{ content: { color: "#cf1322" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="探测中" value={stats.checking} styles={{ content: { color: "#1677ff" } }} />
          </Card>
        </Col>
      </Row>

      <Card>
        <ResourceFilterToolbar
          actions={
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeywordInput("");
                setKeyword("");
                setEnvironment("");
                setProvider("");
                setLifecycleState("");
                setRuntimeStatus("");
                resetPage();
                void healthQuery.refetch();
              }}
            >
              重置
            </Button>
          }
        >
          <ResourceFilterToolbarItem label="环境" width="sm">
            <Input
              allowClear
              value={environment}
              placeholder="环境"
              onChange={(e) => {
                resetPage();
                setEnvironment(e.target.value);
              }}
            />
          </ResourceFilterToolbarItem>
          <ResourceFilterToolbarItem label="供应商" width="sm">
            <Input
              allowClear
              value={provider}
              placeholder="供应商"
              onChange={(e) => {
                resetPage();
                setProvider(e.target.value);
              }}
            />
          </ResourceFilterToolbarItem>
          <ResourceFilterToolbarItem label="生命周期" width="sm">
            <Select
              style={{ width: "100%" }}
              value={lifecycleState}
              onChange={(value) => {
                resetPage();
                setLifecycleState(value);
              }}
              options={[
                { label: "全部生命周期", value: "" },
                { label: lifecycleLabel("active"), value: "active" },
                { label: lifecycleLabel("disabled"), value: "disabled" },
                { label: lifecycleLabel("deleted"), value: "deleted" },
              ]}
            />
          </ResourceFilterToolbarItem>
          <ResourceFilterToolbarItem label="运行状态" width="sm">
            <Select
              style={{ width: "100%" }}
              value={runtimeStatus}
              onChange={(value) => {
                resetPage();
                setRuntimeStatus(value);
              }}
              options={[
                { label: "全部运行状态", value: "" },
                { label: "运行中", value: "running" },
                { label: "离线", value: "offline" },
                { label: "探测中", value: "checking" },
                { label: "已停用", value: "disabled" },
                { label: "离线模式", value: "offline-mode" },
              ]}
            />
          </ResourceFilterToolbarItem>
        </ResourceFilterToolbar>
      </Card>

      {healthQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="健康列表加载失败"
          description={healthQuery.error instanceof Error ? healthQuery.error.message : "请求失败，请稍后重试"}
        />
      ) : null}

      <Card>
        <ResourceTable<ClusterHealthListItem>
          rowKey="clusterId"
          tableKey="observability.clusterHealth"
          columns={columns as ColumnsType<ClusterHealthListItem>}
          dataSource={items}
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: (value) => {
              setKeywordInput(value);
              setKeyword(value.trim());
              resetPage();
            },
            placeholder: "搜索集群名 / ID",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          loading={healthQuery.isLoading}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, healthQuery.isLoading)
          }
          pagination={getPaginationConfig(healthQuery.data?.total ?? 0, healthQuery.isLoading)}
        />
      </Card>

      <Drawer
        title="集群健康详情"
        open={Boolean(detailClusterId)}
        size="large"
        onClose={() => setDetailClusterId("")}
        styles={{
          wrapper: {
            width: "min(50vw, 960px)",
            minWidth: 720,
          },
        }}
      >
        {detailQuery.isLoading ? <Typography.Text>加载中...</Typography.Text> : null}
        {detailQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="详情加载失败"
            description={detailQuery.error instanceof Error ? detailQuery.error.message : "请求失败，请稍后重试"}
          />
        ) : null}
        {detailQuery.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="集群">
                {getClusterDisplayName(
                  clusterMap,
                  detailQuery.data.summary.clusterId,
                  detailQuery.data.summary.clusterName,
                )}
              </Descriptions.Item>
              <Descriptions.Item label="生命周期">
                {lifecycleTag(detailQuery.data.summary.lifecycleState)}
              </Descriptions.Item>
              <Descriptions.Item label="运行状态">
                {runtimeStatusTag(detailQuery.data.summary.runtimeStatus)}
              </Descriptions.Item>
              <Descriptions.Item label="最近探测">
                {detailQuery.data.summary.checkedAt
                  ? new Date(detailQuery.data.summary.checkedAt).toLocaleString("zh-CN")
                  : "未探测"}
              </Descriptions.Item>
              <Descriptions.Item label="延迟">
                {detailQuery.data.summary.latencyMs === null
                  ? "-"
                  : `${detailQuery.data.summary.latencyMs}ms`}
              </Descriptions.Item>
              <Descriptions.Item label="来源">{sourceTag(detailQuery.data.summary.source)}</Descriptions.Item>
              <Descriptions.Item label="原因">{detailQuery.data.summary.reason || "-"}</Descriptions.Item>
              <Descriptions.Item label="超时预算">
                {detailQuery.data.detail.timeoutMs === null ? "-" : `${detailQuery.data.detail.timeoutMs}ms`}
              </Descriptions.Item>
              <Descriptions.Item label="连续失败次数">
                {detailQuery.data.detail.failureCount ?? "-"}
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
                {JSON.stringify(detailQuery.data.detail.payload ?? {}, null, 2)}
              </Typography.Paragraph>
            </Card>
            <Button
              type="primary"
              icon={<SyncOutlined />}
              loading={manualProbeMutation.isPending}
              onClick={() => manualProbeMutation.mutate(detailClusterId)}
            >
              手动探测
            </Button>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
