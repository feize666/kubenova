"use client";

import { ReloadOutlined, RobotOutlined, SafetyOutlined, WarningOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Descriptions, Drawer, Empty, Row, Select, Space, Statistic, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsStatusTag } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import {
  approveAiopsRecommendation,
  getAiopsSummary,
  precheckAiopsRecommendation,
  type AiopsIncidentItem,
  type AiopsRecommendationApproval,
  type AiopsRecommendationItem,
  type AiopsRecommendationPrecheck,
} from "@/lib/api/aiops";
import type { MonitoringTimePreset } from "@/lib/api/monitoring";
import { listQueryOptions } from "@/lib/query";

const AIOPS_PATH = "/aiops";
const AIOPS_RANGE_OPTIONS: Array<{ label: string; value: MonitoringTimePreset }> = [
  { label: "15 分钟", value: "15m" },
  { label: "1 小时", value: "1h" },
  { label: "6 小时", value: "6h" },
  { label: "24 小时", value: "24h" },
  { label: "7 天", value: "7d" },
];
const EMPTY_INCIDENTS: AiopsIncidentItem[] = [];
const EMPTY_RECOMMENDATIONS: AiopsRecommendationItem[] = [];
const EMPTY_ROOT_CAUSES: NonNullable<Awaited<ReturnType<typeof getAiopsSummary>>["rootCauseCandidates"]> = [];
const EMPTY_CORRELATION_GROUPS: NonNullable<Awaited<ReturnType<typeof getAiopsSummary>>["correlationGroups"]> = [];

function severityTag(value: "critical" | "warning" | "info") {
  if (value === "critical") return <OpsStatusTag tone="danger">严重</OpsStatusTag>;
  if (value === "warning") return <OpsStatusTag tone="warning">风险</OpsStatusTag>;
  return <OpsStatusTag tone="info">信息</OpsStatusTag>;
}

function statusTag(value: AiopsIncidentItem["status"]) {
  if (value === "open") return <OpsStatusTag tone="danger">待处理</OpsStatusTag>;
  if (value === "investigating") return <OpsStatusTag tone="processing">诊断中</OpsStatusTag>;
  return <OpsStatusTag tone="success">已缓解</OpsStatusTag>;
}

function riskTag(value: AiopsRecommendationItem["riskLevel"]) {
  if (value === "high") return <OpsStatusTag tone="danger">高</OpsStatusTag>;
  if (value === "medium") return <OpsStatusTag tone="warning">中</OpsStatusTag>;
  return <OpsStatusTag tone="success">低</OpsStatusTag>;
}

export default function AiopsCenterPage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const [range, setRange] = useState<MonitoringTimePreset>("24h");
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [precheckResults, setPrecheckResults] = useState<Record<string, AiopsRecommendationPrecheck>>({});
  const [approvalResults, setApprovalResults] = useState<Record<string, AiopsRecommendationApproval>>({});
  const enabled = !isInitializing && Boolean(accessToken);
  const summaryQuery = useQuery({
    ...listQueryOptions,
    queryKey: ["aiops", "summary", range, accessToken],
    queryFn: ({ signal }) => getAiopsSummary({ range }, accessToken || undefined, { signal }),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const summary = summaryQuery.data;
  const incidentQueue = summary?.incidentQueue ?? EMPTY_INCIDENTS;
  const recommendations = summary?.recommendations ?? EMPTY_RECOMMENDATIONS;
  const rootCauseCandidates = summary?.rootCauseCandidates ?? EMPTY_ROOT_CAUSES;
  const correlationGroups = summary?.correlationGroups ?? EMPTY_CORRELATION_GROUPS;
  const selectedIncident = useMemo(
    () => incidentQueue.find((item) => item.id === selectedIncidentId) ?? null,
    [incidentQueue, selectedIncidentId],
  );
  const selectedRootCause = useMemo(
    () => rootCauseCandidates.find((item) => item.incidentId === selectedIncidentId) ?? null,
    [rootCauseCandidates, selectedIncidentId],
  );
  const selectedRecommendations = useMemo(
    () => recommendations.filter((item) => item.incidentId === selectedIncidentId),
    [recommendations, selectedIncidentId],
  );
  const selectedCorrelationGroup = useMemo(
    () =>
      correlationGroups.find((group) =>
        selectedIncident ? group.affectedScopes.includes(selectedIncident.affectedScope) : false,
      ) ?? null,
    [correlationGroups, selectedIncident],
  );
  const handleRefresh = useCallback(() => {
    void summaryQuery.refetch();
  }, [summaryQuery]);
  const closeIncidentDrawer = useCallback(() => setSelectedIncidentId(""), []);
  const precheckMutation = useMutation({
    mutationFn: (recommendationId: string) => precheckAiopsRecommendation(recommendationId, accessToken || undefined),
    onSuccess: (result) => {
      setPrecheckResults((prev) => ({ ...prev, [result.recommendationId]: result }));
      void message.success(result.status === "passed" ? "Precheck 通过" : "Precheck 阻断");
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "Precheck 失败");
    },
  });
  const approvalMutation = useMutation({
    mutationFn: (recommendationId: string) => approveAiopsRecommendation(recommendationId, accessToken || undefined),
    onSuccess: (result) => {
      setApprovalResults((prev) => ({ ...prev, [result.recommendationId]: result }));
      void message.success("审批已记录，未执行集群变更");
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "审批失败");
    },
  });
  const incidentColumns = useMemo<ColumnsType<AiopsIncidentItem>>(
    () => [
      {
        title: "事故",
        dataIndex: "title",
        key: "title",
        ellipsis: true,
        render: (value: string, record) => (
          <Space orientation="vertical" size={0}>
            <Typography.Link strong onClick={() => setSelectedIncidentId(record.id)}>
              {value}
            </Typography.Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {record.affectedScope}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "级别",
        dataIndex: "severity",
        key: "severity",
        width: 100,
        render: severityTag,
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 110,
        render: statusTag,
      },
      {
        title: "置信度",
        dataIndex: "confidence",
        key: "confidence",
        width: 100,
        render: (value: number) => `${value}%`,
      },
      {
        title: "拓扑影响",
        dataIndex: "topologyImpact",
        key: "topologyImpact",
        width: 180,
        ellipsis: true,
      },
    ],
    [],
  );
  const recommendationColumns = useMemo<ColumnsType<AiopsRecommendationItem>>(
    () => [
      {
        title: "建议",
        dataIndex: "summary",
        key: "summary",
        ellipsis: true,
      },
      {
        title: "风险",
        dataIndex: "riskLevel",
        key: "riskLevel",
        width: 90,
        render: riskTag,
      },
      {
        title: "审批",
        dataIndex: "approvalRequired",
        key: "approvalRequired",
        width: 100,
        render: (value: boolean) => (
          value ? <OpsStatusTag tone="warning">需要</OpsStatusTag> : <OpsStatusTag tone="success">无需</OpsStatusTag>
        ),
      },
      {
        title: "回滚提示",
        dataIndex: "rollbackHint",
        key: "rollbackHint",
        ellipsis: true,
      },
    ],
    [],
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path={AIOPS_PATH}
          embedded
          freshness={summary ? { label: "分析时间", value: summary.timestamp, color: "purple" } : undefined}
          extra={
            <Space wrap>
              <Select
                value={range}
                style={{ width: 120 }}
                onChange={setRange}
                options={AIOPS_RANGE_OPTIONS}
              />
              <Button icon={<ReloadOutlined />} loading={summaryQuery.isFetching} onClick={handleRefresh}>
                刷新
              </Button>
            </Space>
          }
        />
      </Card>

      {!enabled ? <Alert type="warning" showIcon title="未检测到登录状态，请先登录后查看 AIOps 中台。" /> : null}
      {summaryQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="AIOps 汇总加载失败"
          description={summaryQuery.error instanceof Error ? summaryQuery.error.message : "请求失败，请稍后重试"}
        />
      ) : null}
      {summary?.degraded ? (
        <Alert type="warning" showIcon title="分析数据降级" description={summary.note || "当前事故队列可能来自派生信号。"} />
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="异常总数" value={summary?.anomalyOverview.total ?? 0} prefix={<RobotOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="严重异常" value={summary?.anomalyOverview.critical ?? 0} styles={{ content: { color: "#cf1322" } }} prefix={<WarningOutlined />} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="关联分组" value={summary?.correlationGroups.length ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="cyber-panel">
            <Statistic title="审计状态" value={summary?.auditState.auditTrailReady ? "就绪" : "缺失"} prefix={<SafetyOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card className="cyber-panel" title="事故队列">
        <Table
          rowKey="id"
          size="small"
          columns={incidentColumns}
          dataSource={incidentQueue}
          pagination={false}
          loading={summaryQuery.isLoading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事故" /> }}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card className="cyber-panel" title="根因候选">
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              {rootCauseCandidates.map((item) => (
                <Card size="small" key={item.incidentId}>
                  <Space orientation="vertical" size={4}>
                    <Space>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <OpsFilterChip tone="info">{item.modelType}</OpsFilterChip>
                      <OpsFilterChip tone="neutral">{item.confidence}%</OpsFilterChip>
                    </Space>
                    <Typography.Text type="secondary">{item.evidence.join(" / ")}</Typography.Text>
                  </Space>
                </Card>
              ))}
              {summary && rootCauseCandidates.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无根因候选" />
              ) : null}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="cyber-panel" title="推荐动作">
            <Table
              rowKey="id"
              size="small"
              columns={recommendationColumns}
              dataSource={recommendations}
              pagination={false}
              loading={summaryQuery.isLoading}
            />
          </Card>
        </Col>
      </Row>

      <Drawer
        title="Incident Workbench"
        open={Boolean(selectedIncident)}
        size="large"
        onClose={closeIncidentDrawer}
        styles={{ wrapper: { width: "min(100vw, 1040px, max(56vw, 760px))" } }}
      >
        {selectedIncident ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="事故">{selectedIncident.title}</Descriptions.Item>
              <Descriptions.Item label="级别">{severityTag(selectedIncident.severity)}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(selectedIncident.status)}</Descriptions.Item>
              <Descriptions.Item label="影响范围">{selectedIncident.affectedScope}</Descriptions.Item>
              <Descriptions.Item label="拓扑影响">{selectedIncident.topologyImpact}</Descriptions.Item>
              <Descriptions.Item label="置信度">{selectedIncident.confidence}%</Descriptions.Item>
              <Descriptions.Item label="来源">{selectedIncident.source}</Descriptions.Item>
            </Descriptions>

            <Card size="small" title="证据时间线">
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                {[
                  {
                    label: selectedIncident.startedAt,
                    text: `${selectedIncident.source} 信号触发：${selectedIncident.title}`,
                  },
                  {
                    label: summary?.timestamp ?? "",
                    text: `影响面确认：${selectedIncident.affectedScope}`,
                  },
                  {
                    label: summary?.timestamp ?? "",
                    text: `证据数量：${selectedIncident.evidenceCount}`,
                  },
                ].map((item) => (
                  <Space
                    key={`${item.label}:${item.text}`}
                    orientation="vertical"
                    size={0}
                    style={{ display: "flex" }}
                  >
                    <Typography.Text type="secondary">{new Date(item.label).toLocaleString("zh-CN")}</Typography.Text>
                    <Typography.Text>{item.text}</Typography.Text>
                  </Space>
                ))}
              </Space>
            </Card>

            <Card size="small" title="关联分组">
              {selectedCorrelationGroup ? (
                <Space orientation="vertical" size={6}>
                  <Space>
                    <Typography.Text strong>{selectedCorrelationGroup.title}</Typography.Text>
                    {severityTag(selectedCorrelationGroup.severity)}
                    <OpsFilterChip tone="neutral">{selectedCorrelationGroup.incidentCount} 个事故</OpsFilterChip>
                  </Space>
                  <Typography.Text type="secondary">{selectedCorrelationGroup.evidence.join(" / ")}</Typography.Text>
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联分组" />
              )}
            </Card>

            <Card size="small" title="根因候选">
              {selectedRootCause ? (
                <Space orientation="vertical" size={6}>
                  <Space>
                    <Typography.Text strong>{selectedRootCause.title}</Typography.Text>
                    <OpsFilterChip tone="info">{selectedRootCause.modelType}</OpsFilterChip>
                    <OpsFilterChip tone="neutral">{selectedRootCause.confidence}%</OpsFilterChip>
                    <OpsFilterChip tone="neutral">{selectedRootCause.humanState}</OpsFilterChip>
                  </Space>
                  <Typography.Text type="secondary">{selectedRootCause.evidence.join(" / ")}</Typography.Text>
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无根因候选" />
              )}
            </Card>

            <Card size="small" title="推荐与审批">
              <Table
                rowKey="id"
                size="small"
                columns={recommendationColumns}
                dataSource={selectedRecommendations}
                pagination={false}
                expandable={{
                  expandedRowRender: (record) => {
                    const precheck = precheckResults[record.id];
                    const approval = approvalResults[record.id];
                    return (
                      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                        <Space wrap>
                          <Button
                            size="small"
                            onClick={() => precheckMutation.mutate(record.id)}
                            loading={precheckMutation.isPending}
                          >
                            Precheck
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            disabled={!record.approvalRequired}
                            onClick={() => approvalMutation.mutate(record.id)}
                            loading={approvalMutation.isPending}
                          >
                            记录审批
                          </Button>
                          <OpsStatusTag tone={record.precheckStatus === "pending" ? "warning" : "success"}>
                            {record.precheckStatus === "pending" ? "等待 precheck" : "无需 precheck"}
                          </OpsStatusTag>
                        </Space>
                        {precheck ? (
                          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                            <Typography.Text strong>Precheck 结果：{precheck.status}</Typography.Text>
                            {precheck.checks.map((item) => (
                              <Space key={item.key} wrap>
                                <OpsStatusTag tone={item.status === "passed" ? "success" : "danger"}>{item.status}</OpsStatusTag>
                                <Typography.Text>{item.label}</Typography.Text>
                                <Typography.Text type="secondary">{item.message}</Typography.Text>
                              </Space>
                            ))}
                          </Space>
                        ) : null}
                        {approval ? (
                          <Alert
                            type="info"
                            showIcon
                            title={approval.message}
                            description={`审计 ${approval.audit.id} / ${approval.executionStatus} / ${approval.rollbackHint}`}
                          />
                        ) : null}
                      </Space>
                    );
                  },
                }}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
