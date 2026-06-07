"use client";

import {
  LinkOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Descriptions, Drawer, Empty, Row, Select, Space, Statistic, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsStatusTag } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import {
  getObservabilitySummary,
  type ObservabilityEntityHealth,
  type ObservabilityEvent,
  type ObservabilitySignalPanel,
  type ObservabilitySourceStatus,
} from "@/lib/api/observability";
import type { MonitoringTimePreset } from "@/lib/api/monitoring";
import { listQueryOptions } from "@/lib/query";

const OBSERVABILITY_PATH = "/observability";
const OBSERVABILITY_RANGE_OPTIONS: Array<{ label: string; value: MonitoringTimePreset }> = [
  { label: "15 分钟", value: "15m" },
  { label: "1 小时", value: "1h" },
  { label: "6 小时", value: "6h" },
  { label: "24 小时", value: "24h" },
  { label: "7 天", value: "7d" },
];
const EMPTY_SOURCE_STATUS: ObservabilitySourceStatus[] = [];
const EMPTY_ENTITIES: ObservabilityEntityHealth[] = [];
const EMPTY_SIGNAL_PANELS: ObservabilitySignalPanel[] = [];
const EMPTY_EVENTS: ObservabilityEvent[] = [];

function sourceTag(item: ObservabilitySourceStatus) {
  if (item.available && !item.degraded) {
    return <OpsStatusTag tone="success">可用</OpsStatusTag>;
  }
  if (item.available) {
    return <OpsStatusTag tone="warning">降级</OpsStatusTag>;
  }
  return <OpsStatusTag tone="danger">不可用</OpsStatusTag>;
}

function signalTag(status: ObservabilitySignalPanel["status"]) {
  if (status === "available") return <OpsStatusTag tone="success">可用</OpsStatusTag>;
  if (status === "degraded") return <OpsStatusTag tone="warning">降级</OpsStatusTag>;
  return <OpsStatusTag tone="danger">不可用</OpsStatusTag>;
}

function entityStatusTag(status: ObservabilityEntityHealth["status"]) {
  if (status === "healthy") return <OpsStatusTag tone="success">健康</OpsStatusTag>;
  if (status === "warning") return <OpsStatusTag tone="warning">风险</OpsStatusTag>;
  if (status === "critical") return <OpsStatusTag tone="danger">严重</OpsStatusTag>;
  return <OpsStatusTag tone="neutral">暂无数据</OpsStatusTag>;
}

function eventLevelTag(level: ObservabilityEvent["level"]) {
  if (level === "CRITICAL") return <OpsStatusTag tone="danger">CRITICAL</OpsStatusTag>;
  if (level === "WARN") return <OpsStatusTag tone="warning">WARN</OpsStatusTag>;
  return <OpsStatusTag tone="info">INFO</OpsStatusTag>;
}

export default function ObservabilityCenterPage() {
  const { accessToken, isInitializing } = useAuth();
  const [range, setRange] = useState<MonitoringTimePreset>("24h");
  const [selectedScope, setSelectedScope] = useState<ObservabilityEntityHealth["scope"] | "">("");
  const enabled = !isInitializing && Boolean(accessToken);
  const summaryQuery = useQuery({
    ...listQueryOptions,
    queryKey: ["observability", "summary", range, accessToken],
    queryFn: ({ signal }) => getObservabilitySummary({ range }, accessToken || undefined, { signal }),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const summary = summaryQuery.data;
  const sourceStatus = summary?.sourceStatus ?? EMPTY_SOURCE_STATUS;
  const entities = summary?.entities ?? EMPTY_ENTITIES;
  const signalPanels = summary?.signalPanels ?? EMPTY_SIGNAL_PANELS;
  const recentEvents = summary?.recentEvents ?? EMPTY_EVENTS;
  const selectedEntity = useMemo(
    () => entities.find((item) => item.scope === selectedScope) ?? null,
    [entities, selectedScope],
  );
  const handleRefresh = useCallback(() => {
    void summaryQuery.refetch();
  }, [summaryQuery]);
  const closeEntityDrawer = useCallback(() => setSelectedScope(""), []);

  const entityColumns = useMemo<ColumnsType<ObservabilityEntityHealth>>(
    () => [
      {
        title: "实体",
        dataIndex: "label",
        key: "label",
        render: (value: string, record) =>
          record.detailPath ? (
            <Typography.Link onClick={() => setSelectedScope(record.scope)}>{value}</Typography.Link>
          ) : (
            value
          ),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: entityStatusTag,
      },
      {
        title: "总数",
        dataIndex: "total",
        key: "total",
        width: 100,
      },
      {
        title: "风险",
        key: "risk",
        width: 160,
        render: (_, record) => `${record.critical} 严重 / ${record.warning} 风险`,
      },
    ],
    [],
  );
  const signalColumns = useMemo<ColumnsType<ObservabilitySignalPanel>>(
    () => [
      {
        title: "信号",
        dataIndex: "title",
        key: "title",
        width: 120,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 100,
        render: signalTag,
      },
      {
        title: "摘要",
        dataIndex: "summary",
        key: "summary",
      },
      {
        title: "入口",
        dataIndex: "detailPath",
        key: "detailPath",
        width: 100,
        render: (value?: string) =>
          value ? (
            <Link href={value}>
              <LinkOutlined /> 打开
            </Link>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          ),
      },
    ],
    [],
  );
  const eventColumns = useMemo<ColumnsType<ObservabilityEvent>>(
    () => [
      {
        title: "级别",
        dataIndex: "level",
        key: "level",
        width: 120,
        render: eventLevelTag,
      },
      {
        title: "来源",
        dataIndex: "source",
        key: "source",
        width: 220,
        ellipsis: true,
      },
      {
        title: "事件",
        dataIndex: "message",
        key: "message",
        ellipsis: true,
      },
      {
        title: "时间",
        dataIndex: "timestamp",
        key: "timestamp",
        width: 190,
        render: (value: string) => new Date(value).toLocaleString("zh-CN"),
      },
    ],
    [],
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path={OBSERVABILITY_PATH}
          embedded
          freshness={summary ? { label: "采集时间", value: summary.timestamp, color: "blue" } : undefined}
          extra={
            <Space wrap>
              <Select
                value={range}
                style={{ width: 120 }}
                onChange={setRange}
                options={OBSERVABILITY_RANGE_OPTIONS}
              />
              <Button icon={<ReloadOutlined />} loading={summaryQuery.isFetching} onClick={handleRefresh}>
                刷新
              </Button>
            </Space>
          }
        />
      </Card>

      {!enabled ? <Alert type="warning" showIcon title="未检测到登录状态，请先登录后查看可观测性中心。" /> : null}
      {summaryQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="可观测性汇总加载失败"
          description={summaryQuery.error instanceof Error ? summaryQuery.error.message : "请求失败，请稍后重试"}
        />
      ) : null}
      <Row gutter={[12, 12]}>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="健康分" value={summary?.healthScore ?? 0} suffix="/ 100" />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="活跃告警" value={summary?.activeAlerts.total ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="严重" value={summary?.activeAlerts.critical ?? 0} styles={{ content: { color: "#cf1322" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="风险" value={summary?.activeAlerts.warning ?? 0} styles={{ content: { color: "#d48806" } }} />
          </Card>
        </Col>
      </Row>

      <Card className="cyber-panel" title="数据源状态">
        {sourceStatus.length ? (
          <Row gutter={[12, 12]}>
            {sourceStatus.map((item) => (
              <Col xs={24} md={8} xl={4} key={item.key}>
                <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                  <Space>
                    <Typography.Text strong>{item.label}</Typography.Text>
                    {sourceTag(item)}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.note}
                  </Typography.Text>
                </Space>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据源状态" />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card className="cyber-panel" title="实体健康">
            <Table
              rowKey="scope"
              size="small"
              columns={entityColumns}
              dataSource={entities}
              pagination={false}
              loading={summaryQuery.isLoading}
            />
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card className="cyber-panel" title="信号联动">
            <Table
              rowKey="key"
              size="small"
              columns={signalColumns}
              dataSource={signalPanels}
              pagination={false}
              loading={summaryQuery.isLoading}
            />
          </Card>
        </Col>
      </Row>

      <Card className="cyber-panel" title="最近事件">
        <Table
          rowKey="id"
          size="small"
          columns={eventColumns}
          dataSource={recentEvents}
          pagination={false}
          loading={summaryQuery.isLoading}
        />
      </Card>

      <Drawer
        title="实体信号详情"
        open={Boolean(selectedEntity)}
        size="large"
        onClose={closeEntityDrawer}
        styles={{ wrapper: { width: "min(52vw, 960px)", minWidth: 720 } }}
      >
        {selectedEntity ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="实体">{selectedEntity.label}</Descriptions.Item>
              <Descriptions.Item label="状态">{entityStatusTag(selectedEntity.status)}</Descriptions.Item>
              <Descriptions.Item label="时间范围">
                {summary?.timeRange.from} - {summary?.timeRange.to}
              </Descriptions.Item>
              <Descriptions.Item label="告警 owner">{selectedEntity.alertOwner}</Descriptions.Item>
              <Descriptions.Item label="通知状态">
                <OpsStatusTag tone={selectedEntity.notificationStatus === "ready" ? "success" : "warning"}>
                  {selectedEntity.notificationStatus}
                </OpsStatusTag>
              </Descriptions.Item>
              <Descriptions.Item label="SLO">
                <Space wrap>
                  <OpsFilterChip tone="neutral">{selectedEntity.slo.targetPercent}%</OpsFilterChip>
                  <OpsFilterChip tone="neutral">burn {selectedEntity.slo.burnRate}</OpsFilterChip>
                  <OpsFilterChip tone="neutral">{selectedEntity.slo.errorBudgetRemainingPercent}% budget</OpsFilterChip>
                  <OpsStatusTag tone={selectedEntity.slo.status === "healthy" ? "success" : "warning"}>
                    {selectedEntity.slo.status}
                  </OpsStatusTag>
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="信号关联">
              <Space wrap>
                {Object.entries(selectedEntity.signals).map(([key, value]) => (
                  <OpsStatusTag key={key} tone={value === "available" ? "success" : value === "degraded" ? "warning" : "danger"}>
                    {key}: {value}
                  </OpsStatusTag>
                ))}
              </Space>
            </Card>

            <Card size="small" title="外部深链">
              <Space wrap>
                {selectedEntity.deepLinks.map((item) =>
                  item.available && item.url ? (
                    <Button key={item.key} href={item.url} target="_blank" icon={<LinkOutlined />} size="small">
                      {item.label}
                    </Button>
                  ) : (
                    <OpsFilterChip key={item.key} tone="neutral">{item.label}: 未配置</OpsFilterChip>
                  ),
                )}
              </Space>
            </Card>

            <Card size="small" title="路由入口">
              {selectedEntity.detailPath ? (
                <Link href={selectedEntity.detailPath}>打开资源视图</Link>
              ) : (
                <Typography.Text type="secondary">暂无资源视图入口</Typography.Text>
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
