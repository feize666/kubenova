"use client";

import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  message,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { buildTablePagination } from "@/lib/table/pagination";
import {
  getCapabilityBaseline,
  type CapabilityBaselineMatrixItem,
  type CapabilityBaselineStatus,
} from "@/lib/api/capabilities";
import {
  executeInspectionAction,
  exportInspectionReport,
  getClusterInspection,
  rerunClusterInspection,
  type InspectionExportFormat,
  type InspectionActionResult,
  type InspectionActionType,
  type MonitoringTimePreset,
  type InspectionIssue,
} from "@/lib/api/monitoring";

const { RangePicker } = DatePicker;
const TIME_PRESETS: Array<{ label: string; value: MonitoringTimePreset | "custom" }> = [
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "自定义", value: "custom" },
];

function severityTag(level: InspectionIssue["severity"]) {
  if (level === "critical") return <Tag color="red">严重</Tag>;
  if (level === "warning") return <Tag color="orange">警告</Tag>;
  return <Tag color="blue">提示</Tag>;
}

const CATEGORY_LABEL: Record<InspectionIssue["category"], string> = {
  cluster: "集群",
  namespace: "名称空间",
  workload: "工作负载",
  network: "网络",
  storage: "存储",
  config: "配置",
  security: "安全",
  alert: "告警",
};

function capabilityStatusTag(status: CapabilityBaselineStatus) {
  if (status === "implemented") return <Tag color="success">已实现</Tag>;
  if (status === "planned") return <Tag color="processing">规划中</Tag>;
  if (status === "in-progress") return <Tag color="blue">进行中</Tag>;
  if (status === "blocked") return <Tag color="red">阻塞</Tag>;
  if (status === "gap") return <Tag color="warning">待补齐</Tag>;
  return <Tag>未知</Tag>;
}

export default function InspectionPage() {
  const { accessToken, isInitializing } = useAuth();
  const [clusterId, setClusterId] = useState("");
  const [exportFormat, setExportFormat] = useState<InspectionExportFormat>("xlsx");
  const [activeResult, setActiveResult] = useState<InspectionActionResult | null>(null);
  const [refreshingInspection, setRefreshingInspection] = useState(false);
  const [timePreset, setTimePreset] = useState<MonitoringTimePreset | "custom">("24h");
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [capabilityPage, setCapabilityPage] = useState(1);
  const [capabilityPageSize, setCapabilityPageSize] = useState(10);
  const [issuePage, setIssuePage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(12);
  const enabled = !isInitializing && Boolean(accessToken);
  const timeQuery = useMemo(() => {
    if (timePreset !== "custom") {
      return { range: timePreset };
    }
    if (customRange?.[0] && customRange?.[1]) {
      return {
        from: customRange[0].toISOString(),
        to: customRange[1].toISOString(),
      };
    }
    return { range: "24h" as MonitoringTimePreset };
  }, [customRange, timePreset]);

  const clustersQuery = useQuery({
    queryKey: ["clusters", "inspection", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true, pageSize: 200 }, accessToken!),
    enabled,
  });

  const reportQuery = useQuery({
    queryKey: ["monitoring", "inspection", clusterId, timeQuery.range, timeQuery.from, timeQuery.to, accessToken],
    queryFn: () =>
      getClusterInspection({
        clusterId: clusterId || undefined,
        ...timeQuery,
        token: accessToken || undefined,
      }),
    enabled,
    refetchInterval: 30_000,
  });

  const capabilityQuery = useQuery({
    queryKey: ["capability-baseline", accessToken],
    queryFn: () => getCapabilityBaseline(accessToken || undefined),
    enabled,
    refetchInterval: 60_000,
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data],
  );

  const actionMutation = useMutation({
    mutationFn: ({ issue, action }: { issue: InspectionIssue; action: InspectionActionType }) =>
      executeInspectionAction(issue.id, action, {
        clusterId: clusterId || undefined,
        token: accessToken || undefined,
      }),
    onSuccess: (result) => {
      setActiveResult(result);
      void reportQuery.refetch();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "执行修复动作失败");
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () =>
      exportInspectionReport({
        clusterId: clusterId || undefined,
        format: exportFormat,
        ...timeQuery,
        token: accessToken || undefined,
      }),
    onSuccess: ({ blob, filename }) => {
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      message.success(`报告已导出：${filename}`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "导出巡检报告失败");
    },
  });

  const handleRefreshInspection = async () => {
    if (!enabled) {
      return;
    }
    setRefreshingInspection(true);
    message.loading({ key: "inspection-refresh", content: "正在重新巡检..." });
    try {
      await rerunClusterInspection({
        clusterId: clusterId || undefined,
        ...timeQuery,
        token: accessToken || undefined,
      });
      await reportQuery.refetch();
      message.success({ key: "inspection-refresh", content: "重新巡检完成，数据已更新" });
    } catch (error) {
      message.error({
        key: "inspection-refresh",
        content: error instanceof Error ? error.message : "巡检失败，请稍后重试",
      });
    } finally {
      setRefreshingInspection(false);
    }
  };

  const columns: ColumnsType<InspectionIssue> = [
    {
      title: "严重级别",
      dataIndex: "severity",
      key: "severity",
      width: 100,
      render: (v: InspectionIssue["severity"]) => severityTag(v),
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 110,
      render: (v: InspectionIssue["category"]) => CATEGORY_LABEL[v] ?? v,
    },
    {
      title: "问题",
      dataIndex: "title",
      key: "title",
      width: 220,
    },
    {
      title: "资源",
      dataIndex: "resourceRef",
      key: "resourceRef",
      width: 260,
      ellipsis: true,
    },
    {
      title: "诊断证据",
      dataIndex: "evidence",
      key: "evidence",
      width: 220,
      render: (v?: string) => v || "-",
    },
    {
      title: "修复建议",
      dataIndex: "suggestion",
      key: "suggestion",
      ellipsis: true,
    },
    {
      title: "修复动作",
      key: "actions",
      width: 280,
      render: (_, record) => {
        const actions = record.actions ?? [];
        if (actions.length === 0) {
          return "-";
        }
        return (
          <Space wrap>
            {actions.map((action) => (
              <Button
                key={`${record.id}-${action.type}`}
                size="small"
                type={action.type === "create-hpa-draft" ? "primary" : "default"}
                loading={actionMutation.isPending}
                onClick={() => actionMutation.mutate({ issue: record, action: action.type })}
              >
                {action.label}
              </Button>
            ))}
          </Space>
        );
      },
    },
  ];

  const capabilityColumns: ColumnsType<CapabilityBaselineMatrixItem> = [
    {
      title: "类别",
      dataIndex: "category",
      key: "category",
      width: 180,
    },
    {
      title: "能力项",
      dataIndex: "capabilityName",
      key: "capabilityName",
      width: 260,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: CapabilityBaselineStatus) => capabilityStatusTag(value),
    },
    {
      title: "Rancher 对标",
      dataIndex: "rancherAlignment",
      key: "rancherAlignment",
      width: 220,
      render: (value?: string) => value || "-",
    },
    {
      title: "KubeSphere 对标",
      dataIndex: "kubesphereAlignment",
      key: "kubesphereAlignment",
      width: 220,
      render: (value?: string) => value || "-",
    },
    {
      title: "关联任务",
      dataIndex: "trackedTask",
      key: "trackedTask",
      width: 180,
      render: (value: string | null | undefined, record) => {
        if (record.status === "planned") {
          return value ? <Tag color="processing">{value}</Tag> : <Tag color="error">未关联任务</Tag>;
        }
        return value || "-";
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string | null) => (value ? new Date(value).toLocaleString("zh-CN") : "-"),
    },
  ];

  const capabilityStats = useMemo(() => {
    const items = capabilityQuery.data?.items ?? [];
    const stats = {
      total: items.length,
      implemented: 0,
      planned: 0,
      gap: 0,
    };
    for (const item of items) {
      if (item.status === "implemented") stats.implemented += 1;
      if (item.status === "planned") stats.planned += 1;
      if (item.status === "gap") stats.gap += 1;
    }
    return {
      total: capabilityQuery.data?.summary?.total ?? stats.total,
      implemented: capabilityQuery.data?.summary?.implemented ?? stats.implemented,
      planned: capabilityQuery.data?.summary?.planned ?? stats.planned,
      gap: capabilityQuery.data?.summary?.gap ?? stats.gap,
    };
  }, [capabilityQuery.data]);

  const capabilityItems = useMemo(() => capabilityQuery.data?.items ?? [], [capabilityQuery.data?.items]);
  const capabilityPagedItems = useMemo(() => {
    const start = (capabilityPage - 1) * capabilityPageSize;
    return capabilityItems.slice(start, start + capabilityPageSize);
  }, [capabilityItems, capabilityPage, capabilityPageSize]);

  const issueItems = useMemo(() => reportQuery.data?.items ?? [], [reportQuery.data?.items]);
  const issuePagedItems = useMemo(() => {
    const start = (issuePage - 1) * issuePageSize;
    return issueItems.slice(start, start + issuePageSize);
  }, [issueItems, issuePage, issuePageSize]);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row justify="space-between" align="middle" gutter={[16, 12]}>
          <Col>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              集群资源巡检
            </Typography.Title>
            <Typography.Text type="secondary">
              参考主流 Kubernetes 平台，统一巡检集群、名称空间、工作负载、网络、存储、配置与活跃告警。
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              <Select
                style={{ width: 220 }}
                value={clusterId}
                onChange={(value) => setClusterId(value)}
                options={clusterOptions}
                loading={clustersQuery.isLoading}
              />
              <Select
                style={{ width: 120 }}
                value={timePreset}
                onChange={(value: MonitoringTimePreset | "custom") => setTimePreset(value)}
                options={TIME_PRESETS}
              />
              {timePreset === "custom" ? (
                <RangePicker
                  showTime
                  format="YYYY-MM-DD HH:mm:ss"
                  value={customRange}
                  onChange={(value) => setCustomRange(value as [Dayjs, Dayjs] | null)}
                />
              ) : null}
              <Button icon={<ReloadOutlined />} onClick={() => void handleRefreshInspection()} loading={refreshingInspection}>
                重新巡检
              </Button>
              <Select
                style={{ width: 130 }}
                value={exportFormat}
                onChange={(value) => setExportFormat(value)}
                options={[
                  { label: "JSON", value: "json" },
                  { label: "CSV", value: "csv" },
                  { label: "Excel", value: "xlsx" },
                ]}
              />
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => exportMutation.mutate()}
                loading={exportMutation.isPending}
                disabled={!enabled}
              >
                导出报告
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
              最后更新时间：{reportQuery.dataUpdatedAt ? new Date(reportQuery.dataUpdatedAt).toLocaleString("zh-CN") : "-"}
            </Typography.Text>
          </Col>
        </Row>
      </Card>

      {!enabled ? <Alert type="warning" showIcon message="请先登录后再执行资源巡检。" /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="巡检评分" value={reportQuery.data?.summary.score ?? 0} suffix="/ 100" />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="资源总数" value={reportQuery.data?.summary.totalResources ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="严重问题" value={reportQuery.data?.summary.critical ?? 0} valueStyle={{ color: "#cf1322" }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="警告问题" value={reportQuery.data?.summary.warning ?? 0} valueStyle={{ color: "#d48806" }} />
          </Card>
        </Col>
      </Row>

      {capabilityQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          message="能力基线矩阵加载失败"
          description={capabilityQuery.error instanceof Error ? capabilityQuery.error.message : "请求失败"}
        />
      ) : null}

      {capabilityQuery.data?.integrityIssues.length ? (
        <Alert
          type="warning"
          showIcon
          message="能力基线存在数据完整性问题"
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {capabilityQuery.data.integrityIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Card
        title="能力基线矩阵（Rancher / KubeSphere 对标）"
        extra={
          <Typography.Text type="secondary">
            最后更新时间：{capabilityQuery.data?.updatedAt ? new Date(capabilityQuery.data.updatedAt).toLocaleString("zh-CN") : "-"}
          </Typography.Text>
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
          <Col xs={24} md={6}>
            <Statistic title="能力项总数" value={capabilityStats.total} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="已实现" value={capabilityStats.implemented} valueStyle={{ color: "#389e0d" }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="规划中" value={capabilityStats.planned} valueStyle={{ color: "#1677ff" }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="待补齐" value={capabilityStats.gap} valueStyle={{ color: "#d48806" }} />
          </Col>
        </Row>

        <Table<CapabilityBaselineMatrixItem>
          rowKey={(record) => `${record.category}-${record.capabilityName}`}
          columns={capabilityColumns}
          dataSource={capabilityPagedItems}
          loading={capabilityQuery.isLoading}
          pagination={buildTablePagination({
            current: capabilityPage,
            pageSize: capabilityPageSize,
            total: capabilityItems.length,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== capabilityPageSize) {
                setCapabilityPageSize(nextPageSize);
                setCapabilityPage(1);
                return;
              }
              setCapabilityPage(nextPage);
            },
          })}
          scroll={{ x: 1300 }}
        />
      </Card>

      {reportQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="巡检失败"
          description={reportQuery.error instanceof Error ? reportQuery.error.message : "请求失败"}
        />
      ) : null}

      <Card>
        <Table<InspectionIssue>
          rowKey="id"
          columns={columns}
          dataSource={issuePagedItems}
          loading={reportQuery.isLoading}
          pagination={buildTablePagination({
            current: issuePage,
            pageSize: issuePageSize,
            total: issueItems.length,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== issuePageSize) {
                setIssuePageSize(nextPageSize);
                setIssuePage(1);
                return;
              }
              setIssuePage(nextPage);
            },
          })}
        />
      </Card>

      <Modal
        open={Boolean(activeResult)}
        width={900}
        title={activeResult?.action === "create-hpa-draft" ? "HPA 草案" : "修复 YAML"}
        onCancel={() => setActiveResult(null)}
        footer={
          <Button onClick={() => setActiveResult(null)} type="primary">
            关闭
          </Button>
        }
      >
        {activeResult ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Alert type={activeResult.success ? "success" : "error"} showIcon message={activeResult.message} />
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="Issue ID">{activeResult.issueId}</Descriptions.Item>
              <Descriptions.Item label="动作">{activeResult.action}</Descriptions.Item>
              <Descriptions.Item label="目标资源">
                {activeResult.target
                  ? `${activeResult.target.kind}/${activeResult.target.namespace ?? "-"}/${activeResult.target.name ?? "-"}`
                  : "-"}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="生成结果">
              <pre style={{ margin: 0, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                {activeResult.generatedYaml || "(无返回内容)"}
              </pre>
            </Card>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
