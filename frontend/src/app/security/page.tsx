"use client";

import {
  AuditOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { TableProps } from "antd";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { NamespaceSelect } from "@/components/namespace-select";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { buildTablePagination } from "@/lib/table/pagination";
import {
  type AuditLogRecord,
  type SecurityEvent,
  getAuditLogs,
  getSecurityEvents,
  getSecurityStats,
  resolveSecurityEvent,
} from "@/lib/api/security";

const PAGE_SIZE = 20;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "", "zh-CN", { sensitivity: "base" });
}

function compareTime(left: string | undefined, right: string | undefined): number {
  return (Date.parse(left ?? "") || 0) - (Date.parse(right ?? "") || 0);
}

function SeverityTag({ severity }: { severity: string }) {
  const map: Record<string, { color: string; label: string }> = {
    critical: { color: "red", label: "严重" },
    high: { color: "orange", label: "高危" },
    medium: { color: "gold", label: "中危" },
    low: { color: "blue", label: "低危" },
  };
  const cfg = map[severity] ?? { color: "default", label: severity };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}

function EventStatusTag({ status }: { status: string }) {
  if (status === "resolved") {
    return (
      <Tag color="green" icon={<CheckCircleOutlined />}>
        已解决
      </Tag>
    );
  }
  return (
    <Tag color="red" icon={<ExclamationCircleOutlined />}>
      待处理
    </Tag>
  );
}

function ActionTag({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: "cyan",
    update: "blue",
    delete: "red",
    enable: "green",
    disable: "orange",
    batch: "purple",
    scale: "geekblue",
    restart: "volcano",
    rollback: "magenta",
    query: "default",
  };
  return <Tag color={map[action] ?? "default"}>{action}</Tag>;
}

function ResultTag({ result }: { result: string }) {
  if (result === "success") {
    return <Tag color="success">成功</Tag>;
  }
  return <Tag color="error">失败</Tag>;
}

function SecurityEventsTab() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [refreshingEvents, setRefreshingEvents] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"ascend" | "descend" | null>(null);

  const enabled = !isInitializing && Boolean(accessToken);
  const clustersQuery = useQuery({
    queryKey: ["clusters", "security-events", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken),
    enabled,
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const clusterOptions = useMemo(
    () => [{ label: "全部集群", value: "" }, ...(clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id }))],
    [clustersQuery.data?.items],
  );
  const clusterNameToIdMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.name, item.id])),
    [clustersQuery.data?.items],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["security", "events", severityFilter, statusFilter, clusterId, namespace, page],
    queryFn: () =>
      getSecurityEvents(
        {
          severity: severityFilter,
          status: statusFilter,
          page,
          pageSize: PAGE_SIZE,
        },
        accessToken || undefined,
      ),
    enabled,
    refetchInterval: 30_000,
  });

  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.items ?? [])
            .map((item) => item.namespace?.trim() ?? "")
            .filter((item) => item.length > 0),
        ),
      ),
    [data?.items],
  );

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveSecurityEvent(id, accessToken || undefined),
    onSuccess: () => {
      void messageApi.success("已标记为已解决");
      void queryClient.invalidateQueries({ queryKey: ["security", "events"] });
      void queryClient.invalidateQueries({ queryKey: ["security", "stats"] });
    },
    onError: () => {
      void messageApi.error("操作失败，请稍后重试");
    },
  });

  const filteredItems = useMemo(() => {
    const raw = data?.items ?? [];
    const scoped = raw.filter((item) => {
      if (clusterId) {
        const itemClusterId = clusterNameToIdMap[item.cluster] ?? item.cluster;
        if (itemClusterId !== clusterId) return false;
      }
      if (namespace && (item.namespace ?? "") !== namespace) return false;
      return true;
    });
    if (!keyword.trim()) return scoped;
    const kw = keyword.trim().toLowerCase();
    const withKeyword = scoped.filter(
      (item) =>
        item.title.toLowerCase().includes(kw) ||
        item.type.toLowerCase().includes(kw) ||
        item.resourceName.toLowerCase().includes(kw) ||
        item.cluster.toLowerCase().includes(kw),
    );
    return withKeyword;
  }, [clusterId, clusterNameToIdMap, data?.items, keyword, namespace]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (!sortBy || !sortOrder) return list;
    const direction = sortOrder === "ascend" ? 1 : -1;
    list.sort((left, right) => {
      switch (sortBy) {
        case "severity":
          return direction * compareText(left.severity, right.severity);
        case "title":
          return direction * compareText(left.title, right.title);
        case "type":
          return direction * compareText(left.type, right.type);
        case "resourceName":
          return direction * compareText(left.resourceName, right.resourceName);
        case "cluster":
          return direction * compareText(left.cluster, right.cluster);
        case "occurredAt":
          return direction * compareTime(left.occurredAt, right.occurredAt);
        case "status":
          return direction * compareText(left.status, right.status);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredItems, sortBy, sortOrder]);

  const handleRefreshEvents = async () => {
    setRefreshingEvents(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["security", "events"] });
    } finally {
      setRefreshingEvents(false);
    }
  };

  const columns: TableProps<SecurityEvent>["columns"] = [
    {
      title: "严重程度",
      dataIndex: "severity",
      key: "severity",
      width: 90,
      sorter: true,
      sortOrder: sortBy === "severity" ? sortOrder : null,
      render: (v: string) => <SeverityTag severity={v} />,
    },
    {
      title: "事件标题",
      dataIndex: "title",
      key: "title",
      sorter: true,
      sortOrder: sortBy === "title" ? sortOrder : null,
      ellipsis: true,
      render: (v: string, record) => (
        <Tooltip title={`类型: ${record.type}`}>
          <span>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: "事件类型",
      dataIndex: "type",
      key: "type",
      width: 180,
      sorter: true,
      sortOrder: sortBy === "type" ? sortOrder : null,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "资源名称",
      dataIndex: "resourceName",
      key: "resourceName",
      width: 160,
      sorter: true,
      sortOrder: sortBy === "resourceName" ? sortOrder : null,
      render: (v: string) => (
        <Typography.Text code style={{ fontSize: 12 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "集群",
      dataIndex: "cluster",
      key: "cluster",
      width: 140,
      sorter: true,
      sortOrder: sortBy === "cluster" ? sortOrder : null,
      render: (v: string) => <Tag>{getClusterDisplayName(clusterMap, v)}</Tag>,
    },
    {
      title: "发生时间",
      dataIndex: "occurredAt",
      key: "occurredAt",
      width: 155,
      sorter: true,
      sortOrder: sortBy === "occurredAt" ? sortOrder : null,
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }}>{formatTime(v)}</Typography.Text>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      sorter: true,
      sortOrder: sortBy === "status" ? sortOrder : null,
      render: (v: string) => <EventStatusTag status={v} />,
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, record) => {
        if (record.status === "resolved") {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已处理
            </Typography.Text>
          );
        }
        return (
          <Button
            size="small"
            type="link"
            loading={resolveMutation.isPending && resolveMutation.variables === record.id}
            onClick={() => resolveMutation.mutate(record.id)}
          >
            标记已解决
          </Button>
        );
      },
    },
  ];

  return (
    <>
      {contextHolder}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="集群"
          style={{ width: 200 }}
          value={clusterId}
          options={clusterOptions}
          loading={clustersQuery.isLoading}
          onChange={(v) => {
            setClusterId(v);
            setNamespace("");
            setPage(1);
          }}
        />
        <NamespaceSelect
          style={{ width: 180 }}
          value={namespace}
          onChange={(v) => {
            setNamespace(v);
            setPage(1);
          }}
          clusterId={clusterId}
          knownNamespaces={knownNamespaces}
          disabled={!clusterId}
        />
        <Select
          placeholder="严重程度"
          allowClear
          style={{ width: 130 }}
          value={severityFilter}
          onChange={(v) => {
            setSeverityFilter(v);
            setPage(1);
          }}
          options={[
            { label: "全部", value: undefined },
            { label: "严重 (critical)", value: "critical" },
            { label: "高危 (high)", value: "high" },
            { label: "中危 (medium)", value: "medium" },
            { label: "低危 (low)", value: "low" },
          ]}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 130 }}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { label: "全部", value: undefined },
            { label: "待处理 (open)", value: "open" },
            { label: "已解决 (resolved)", value: "resolved" },
          ]}
        />
        <Input
          placeholder="搜索标题 / 类型 / 资源 / 集群..."
          prefix={<SearchOutlined />}
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        <Button
          icon={<ReloadOutlined />}
          loading={refreshingEvents}
          onClick={() => void handleRefreshEvents()}
        >
          刷新
        </Button>
      </Space>

        <Table<SecurityEvent>
          rowKey="id"
          columns={columns}
          dataSource={sortedItems}
          loading={isLoading}
          size="small"
          scroll={{ x: 1000 }}
          onChange={(_pagination, _filters, sorter) => {
            if (Array.isArray(sorter)) return;
            const nextSortBy = typeof sorter.columnKey === "string" ? sorter.columnKey : "";
            const nextSortOrder = sorter.order ?? null;
            setSortBy(nextSortBy);
            setSortOrder(nextSortOrder);
            setPage(1);
          }}
          pagination={buildTablePagination({
            current: page,
            pageSize: PAGE_SIZE,
            total: keyword.trim() || clusterId || namespace || sortBy ? sortedItems.length : (data?.total ?? 0),
            onChange: (p) => setPage(p),
          })}
        rowClassName={(record) =>
          record.severity === "critical" && record.status === "open"
            ? "ant-table-row-danger"
            : ""
        }
      />
    </>
  );
}

function AuditLogsTab() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [refreshingAuditLogs, setRefreshingAuditLogs] = useState(false);

  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [resultFilter, setResultFilter] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"ascend" | "descend" | null>(null);

  const enabled = !isInitializing && Boolean(accessToken);

  const { data, isLoading } = useQuery({
    queryKey: ["security", "audit-logs", actionFilter, resultFilter, page],
    queryFn: () =>
      getAuditLogs(
        { action: actionFilter, result: resultFilter, page, pageSize: PAGE_SIZE },
        accessToken || undefined,
      ),
    enabled,
  });

  const filteredItems = useMemo(() => {
    const raw = data?.items ?? [];
    if (!keyword.trim()) return raw;
    const kw = keyword.trim().toLowerCase();
    return raw.filter(
      (item) =>
        item.actor.toLowerCase().includes(kw) ||
        item.resourceType.toLowerCase().includes(kw) ||
        item.resourceId.toLowerCase().includes(kw),
    );
  }, [data?.items, keyword]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (!sortBy || !sortOrder) return list;
    const direction = sortOrder === "ascend" ? 1 : -1;
    list.sort((left, right) => {
      switch (sortBy) {
        case "actor":
          return direction * compareText(left.actor, right.actor);
        case "role":
          return direction * compareText(left.role, right.role);
        case "action":
          return direction * compareText(left.action, right.action);
        case "resourceType":
          return direction * compareText(left.resourceType, right.resourceType);
        case "resourceId":
          return direction * compareText(left.resourceId, right.resourceId);
        case "result":
          return direction * compareText(left.result, right.result);
        case "timestamp":
          return direction * compareTime(left.timestamp, right.timestamp);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredItems, sortBy, sortOrder]);

  const handleRefreshAuditLogs = async () => {
    setRefreshingAuditLogs(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["security", "audit-logs"] });
    } finally {
      setRefreshingAuditLogs(false);
    }
  };

  const columns: TableProps<AuditLogRecord>["columns"] = [
    {
      title: "操作用户",
      dataIndex: "actor",
      key: "actor",
      width: 130,
      sorter: true,
      sortOrder: sortBy === "actor" ? sortOrder : null,
      render: (v: string) => (
        <Space size={4}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {v}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 140,
      sorter: true,
      sortOrder: sortBy === "role" ? sortOrder : null,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "操作类型",
      dataIndex: "action",
      key: "action",
      width: 100,
      sorter: true,
      sortOrder: sortBy === "action" ? sortOrder : null,
      render: (v: string) => <ActionTag action={v} />,
    },
    {
      title: "资源类型",
      dataIndex: "resourceType",
      key: "resourceType",
      width: 160,
      sorter: true,
      sortOrder: sortBy === "resourceType" ? sortOrder : null,
      render: (v: string) => (
        <Tag style={{ margin: 0 }}>{v}</Tag>
      ),
    },
    {
      title: "资源名称",
      dataIndex: "resourceId",
      key: "resourceId",
      sorter: true,
      sortOrder: sortBy === "resourceId" ? sortOrder : null,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text code style={{ fontSize: 12 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "结果",
      dataIndex: "result",
      key: "result",
      width: 80,
      sorter: true,
      sortOrder: sortBy === "result" ? sortOrder : null,
      render: (v: string) => <ResultTag result={v} />,
    },
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 155,
      sorter: true,
      sortOrder: sortBy === "timestamp" ? sortOrder : null,
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }}>{formatTime(v)}</Typography.Text>
      ),
    },
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="操作类型"
          allowClear
          style={{ width: 150 }}
          value={actionFilter}
          onChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
          options={[
            { label: "全部", value: undefined },
            { label: "创建 (create)", value: "create" },
            { label: "更新 (update)", value: "update" },
            { label: "删除 (delete)", value: "delete" },
            { label: "启用 (enable)", value: "enable" },
            { label: "禁用 (disable)", value: "disable" },
            { label: "查询 (query)", value: "query" },
          ]}
        />
        <Select
          placeholder="操作结果"
          allowClear
          style={{ width: 130 }}
          value={resultFilter}
          onChange={(v) => {
            setResultFilter(v);
            setPage(1);
          }}
          options={[
            { label: "全部", value: undefined },
            { label: "成功 (success)", value: "success" },
            { label: "失败 (failure)", value: "failure" },
          ]}
        />
        <Input
          placeholder="搜索用户 / 资源类型 / 资源名..."
          prefix={<SearchOutlined />}
          style={{ width: 280 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        <Button
          icon={<ReloadOutlined />}
          loading={refreshingAuditLogs}
          onClick={() => void handleRefreshAuditLogs()}
        >
          刷新
        </Button>
      </Space>

      <Table<AuditLogRecord>
        rowKey="id"
        columns={columns}
        dataSource={sortedItems}
        loading={isLoading}
        size="small"
        scroll={{ x: 900 }}
        onChange={(_pagination, _filters, sorter) => {
          if (Array.isArray(sorter)) return;
          const nextSortBy = typeof sorter.columnKey === "string" ? sorter.columnKey : "";
          const nextSortOrder = sorter.order ?? null;
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
          setPage(1);
        }}
        pagination={buildTablePagination({
          current: page,
          pageSize: PAGE_SIZE,
          total: keyword.trim() || sortBy ? sortedItems.length : (data?.total ?? 0),
          onChange: (p) => setPage(p),
        })}
      />
    </>
  );
}

export default function SecurityPage() {
  const { accessToken, isInitializing } = useAuth();
  const enabled = !isInitializing && Boolean(accessToken);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["security", "stats"],
    queryFn: () => getSecurityStats(accessToken || undefined),
    enabled,
    refetchInterval: 60_000,
  });

  const complianceColor =
    (stats?.complianceScore ?? 0) >= 90
      ? "#52c41a"
      : (stats?.complianceScore ?? 0) >= 70
        ? "#faad14"
        : "#ff4d4f";

  const tabItems = [
    {
      key: "events",
      label: (
        <Space>
          <WarningOutlined />
          安全事件
        </Space>
      ),
      children: (
        <Card className="cyber-panel">
          <SecurityEventsTab />
        </Card>
      ),
    },
    {
      key: "audit-logs",
      label: (
        <Space>
          <AuditOutlined />
          审计日志
        </Space>
      ),
      children: (
        <Card className="cyber-panel">
          <AuditLogsTab />
        </Card>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        安全审计
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
        聚合漏洞扫描、安全事件与操作审计日志，全面掌握集群安全态势。
      </Typography.Paragraph>

      {/* 统计卡片 */}
      <Skeleton loading={statsLoading} active paragraph={{ rows: 1 }}>
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic
                title="高危漏洞数"
                value={stats?.criticalVulnerabilities ?? 0}
                valueStyle={{
                  color: (stats?.criticalVulnerabilities ?? 0) > 0 ? "#ff4d4f" : undefined,
                }}
                prefix={<LockOutlined />}
                suffix={
                  (stats?.criticalVulnerabilities ?? 0) > 0 ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      需立即处理
                    </Typography.Text>
                  ) : null
                }
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic
                title="待处理事件"
                value={stats?.openEvents ?? 0}
                valueStyle={{
                  color: (stats?.openEvents ?? 0) > 0 ? "#faad14" : undefined,
                }}
                prefix={<ExclamationCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic
                title="合规评分"
                value={stats?.complianceScore ?? 0}
                suffix="%"
                valueStyle={{ color: complianceColor }}
                prefix={<SafetyCertificateOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic
                title="今日审计日志"
                value={stats?.todayAuditLogs ?? 0}
                prefix={<FileTextOutlined />}
              />
            </Card>
          </Col>
        </Row>
      </Skeleton>

      {/* 安全事件 + 审计日志 Tabs */}
      <Tabs defaultActiveKey="events" items={tabItems} />
    </div>
  );
}
