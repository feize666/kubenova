"use client";

import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Descriptions, Drawer, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourcePageHeader } from "@/components/resource-page-header";
import {
  getObservabilitySummary,
  type ObservabilityEntityHealth,
  type ObservabilityEvent,
  type ObservabilitySignalPanel,
  type ObservabilitySourceStatus,
} from "@/lib/api/observability";
import type { MonitoringTimePreset } from "@/lib/api/monitoring";

function sourceTag(item: ObservabilitySourceStatus) {
  if (item.available && !item.degraded) {
    return (
      <Tag color="green" icon={<CheckCircleOutlined />}>
        可用
      </Tag>
    );
  }
  if (item.available) {
    return (
      <Tag color="gold" icon={<WarningOutlined />}>
        降级
      </Tag>
    );
  }
  return (
    <Tag color="red" icon={<ExclamationCircleOutlined />}>
      不可用
    </Tag>
  );
}

function signalTag(status: ObservabilitySignalPanel["status"]) {
  if (status === "available") return <Tag color="green">可用</Tag>;
  if (status === "degraded") return <Tag color="gold">降级</Tag>;
  return <Tag color="red">不可用</Tag>;
}

function entityStatusTag(status: ObservabilityEntityHealth["status"]) {
  if (status === "healthy") return <Tag color="green">健康</Tag>;
  if (status === "warning") return <Tag color="gold">风险</Tag>;
  if (status === "critical") return <Tag color="red">严重</Tag>;
  return <Tag>暂无数据</Tag>;
}

function eventLevelTag(level: ObservabilityEvent["level"]) {
  if (level === "CRITICAL") return <Tag color="red">CRITICAL</Tag>;
  if (level === "WARN") return <Tag color="gold">WARN</Tag>;
  return <Tag color="blue">INFO</Tag>;
}

export default function ObservabilityCenterPage() {
  const { accessToken, isInitializing } = useAuth();
  const [range, setRange] = useState<MonitoringTimePreset>("24h");
  const [selectedScope, setSelectedScope] = useState<ObservabilityEntityHealth["scope"] | "">("");
  const enabled = !isInitializing && Boolean(accessToken);
  const summaryQuery = useQuery({
    queryKey: ["observability", "summary", range, accessToken],
    queryFn: ({ signal }) => getObservabilitySummary({ range }, accessToken || undefined, { signal }),
    enabled,
    refetchInterval: 30_000,
  });
  const summary = summaryQuery.data;
  const selectedEntity = useMemo(
    () => summary?.entities.find((item) => item.scope === selectedScope) ?? null,
    [selectedScope, summary?.entities],
  );

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
          path="/observability"
          embedded
          freshness={summary ? { label: "采集时间", value: summary.timestamp, color: "blue" } : undefined}
          extra={
            <Space wrap>
              <Select
                value={range}
                style={{ width: 120 }}
                onChange={setRange}
                options={[
                  { label: "15 分钟", value: "15m" },
                  { label: "1 小时", value: "1h" },
                  { label: "6 小时", value: "6h" },
                  { label: "24 小时", value: "24h" },
                  { label: "7 天", value: "7d" },
                ]}
              />
              <Button icon={<ReloadOutlined />} loading={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
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
        {summary?.sourceStatus.length ? (
          <Row gutter={[12, 12]}>
            {summary.sourceStatus.map((item) => (
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
              dataSource={summary?.entities ?? []}
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
              dataSource={summary?.signalPanels ?? []}
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
          dataSource={summary?.recentEvents ?? []}
          pagination={false}
          loading={summaryQuery.isLoading}
        />
      </Card>

      <Drawer
        title="实体信号详情"
        open={Boolean(selectedEntity)}
        size="large"
        onClose={() => setSelectedScope("")}
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
                <Tag color={selectedEntity.notificationStatus === "ready" ? "green" : "gold"}>
                  {selectedEntity.notificationStatus}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="SLO">
                <Space wrap>
                  <Tag>{selectedEntity.slo.targetPercent}%</Tag>
                  <Tag>burn {selectedEntity.slo.burnRate}</Tag>
                  <Tag>{selectedEntity.slo.errorBudgetRemainingPercent}% budget</Tag>
                  <Tag color={selectedEntity.slo.status === "healthy" ? "green" : "gold"}>
                    {selectedEntity.slo.status}
                  </Tag>
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="信号关联">
              <Space wrap>
                {Object.entries(selectedEntity.signals).map(([key, value]) => (
                  <Tag key={key} color={value === "available" ? "green" : value === "degraded" ? "gold" : "red"}>
                    {key}: {value}
                  </Tag>
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
                    <Tag key={item.key}>{item.label}: 未配置</Tag>
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
