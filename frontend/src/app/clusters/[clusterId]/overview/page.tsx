"use client";

import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  GlobalOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Col, Progress, Row, Space, Typography } from "antd";
import { useParams } from "next/navigation";
import { ClusterContextProvider, useClusterContext } from "@/components/cluster-context";
import { OpsFilterChip, OpsLoadingState, OpsMetricTile, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { useAuth } from "@/components/auth-context";
import {
  formatDashboardMetric,
  getDashboardStats,
  type DashboardResourceMetric,
} from "@/lib/api/dashboard";
import { QUERY_CACHE_TIMINGS } from "@/lib/query";

const panelStyle = {
  background: "#ffffff",
  borderColor: "#b9d7f5",
  boxShadow: "0 8px 24px rgba(24, 91, 167, 0.08)",
};

const softBlueStyle = {
  background: "#f3f8ff",
  border: "1px solid #d5e7fb",
};

function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "--" : value;
}

function usageTone(value: number | undefined) {
  if (value === undefined) return "normal";
  if (value >= 90) return "exception";
  if (value >= 75) return "active";
  return "success";
}

function formatCapturedAt(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("zh-CN", { hour12: false });
}

function ResourceMetricPanel({
  label,
  metric,
}: {
  label: string;
  metric: DashboardResourceMetric;
}) {
  const presentation = formatDashboardMetric(metric);
  return (
    <div style={{ display: "grid", gap: 12, minHeight: 176 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <Typography.Text strong>{label}</Typography.Text>
          <div style={{ marginTop: 4, color: "#0b4f9c", fontSize: 26, fontWeight: 700 }}>
            {presentation.valueLabel}
          </div>
          <Typography.Text type="secondary">{presentation.capacityLabel}</Typography.Text>
        </div>
        <OpsStatusTag tone={metric.degraded ? "warning" : "success"}>
          {presentation.freshnessLabel}
        </OpsStatusTag>
      </div>
      {presentation.percent === null ? (
        <div
          style={{
            minHeight: 30,
            borderRadius: 6,
            background: "#edf5ff",
            color: "#5e7691",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
          }}
        >
          缺少明确容量，暂不计算百分比
        </div>
      ) : (
        <Progress
          percent={Math.round(presentation.percent)}
          status={usageTone(presentation.percent)}
          strokeColor="#1677ff"
          trailColor="#dcecff"
        />
      )}
      <div style={{ display: "grid", gap: 2 }}>
        <Typography.Text type="secondary">来源：{presentation.sourceLabel}</Typography.Text>
        <Typography.Text type="secondary">采集时间：{formatCapturedAt(metric.capturedAt)}</Typography.Text>
        {metric.note ? <Typography.Text type="warning">{metric.note}</Typography.Text> : null}
      </div>
    </div>
  );
}

function ClusterInfoContent() {
  const { accessToken } = useAuth();
  const { clusterId, cluster, error, isFetching, isLoading, refresh } = useClusterContext();
  const statsQuery = useQuery({
    queryKey: ["dashboard", "stats", "cluster-workspace", clusterId, accessToken],
    queryFn: () => getDashboardStats({ clusterId }, accessToken || undefined),
    enabled: Boolean(accessToken) && Boolean(cluster),
    staleTime: QUERY_CACHE_TIMINGS.listStaleTimeMs,
    gcTime: QUERY_CACHE_TIMINGS.listGcTimeMs,
    retry: 1,
  });

  if (isLoading) {
    return <OpsLoadingState title="正在加载集群信息" description="正在验证集群访问权限并读取实时概览。" />;
  }

  if (error || !cluster) {
    return (
      <OpsSurface variant="panel" padding="md" style={panelStyle}>
        <Alert
          type="error"
          showIcon
          title="集群信息加载失败"
          description={error?.message ?? "未找到该集群或当前账号没有访问权限。"}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>重试</Button>}
        />
      </OpsSurface>
    );
  }

  const resourceUsage = statsQuery.data?.resourceUsage;
  const workloadTotal = statsQuery.data?.workloads.total;
  const workloadHealthy = statsQuery.data?.workloads.healthy;
  const workloadUnhealthy = statsQuery.data?.workloads.unhealthy;
  const topology = statsQuery.data?.topology;
  const statusTone = cluster.runtimeStatus === "running" ? "success" : cluster.runtimeStatus === "checking" ? "warning" : "danger";

  return (
    <div className="resource-workbench" style={{ display: "grid", gap: 16 }}>
      <OpsSurface variant="panel" padding="sm" style={panelStyle}>
        <ResourcePageHeader
          path="/clusters"
          embedded
          title="集群信息"
          description="当前集群的连接状态、节点概览与实时资源快照"
          actions={(
            <Space size={8} wrap>
              <OpsStatusTag tone={statusTone}>{cluster.runtimeStatus}</OpsStatusTag>
              <OpsFilterChip tone="info" icon={<SafetyCertificateOutlined />}>已锁定单集群范围</OpsFilterChip>
              <Button size="small" icon={<ReloadOutlined />} loading={isFetching || statsQuery.isFetching} onClick={() => {
                void refresh();
                void statsQuery.refetch();
              }}>刷新</Button>
            </Space>
          )}
        />
      </OpsSurface>

      {cluster.runtimeStatus !== "running" ? (
        <Alert
          type={cluster.runtimeStatus === "checking" ? "warning" : "error"}
          showIcon
          title={cluster.runtimeStatus === "offline-mode" ? "集群处于离线模式" : "集群实时连接不可用"}
          description="页面仅展示控制面已同步的数据；实时节点和资源数据可能不完整。"
        />
      ) : null}

      {cluster.nodeSummary.degraded ? (
        <Alert
          type="warning"
          showIcon
          title="节点数据已降级"
          description={cluster.nodeSummary.degradationReason || "节点实时清单不可用，当前数量可能不完整。"}
        />
      ) : null}

      <section style={{ ...softBlueStyle, borderRadius: 8, padding: 20 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Typography.Text type="secondary">当前集群</Typography.Text>
            <Typography.Title level={3} style={{ margin: "4px 0 8px", color: "#0b4f9c" }}>{cluster.displayName || cluster.name}</Typography.Title>
            <Typography.Text type="secondary" copyable={{ text: cluster.id }}>ID：{cluster.id}</Typography.Text>
            <Space size={[8, 8]} wrap>
              <OpsFilterChip tone="info">{cluster.metadata.provider || "未识别供应商"}</OpsFilterChip>
              <OpsFilterChip tone="neutral">{cluster.metadata.environment || "未标注环境"}</OpsFilterChip>
              {cluster.metadata.region ? <OpsFilterChip tone="neutral">{cluster.metadata.region}</OpsFilterChip> : null}
            </Space>
          </Col>
          <Col xs={24} lg={10}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div><Typography.Text type="secondary">Kubernetes 版本</Typography.Text><div style={{ color: "#0b4f9c", fontWeight: 700 }}>{displayValue(cluster.platform.kubernetesVersion)}</div></div>
              <div><Typography.Text type="secondary">最后同步</Typography.Text><div style={{ color: "#12375d", fontWeight: 600 }}>{displayValue(cluster.lastSyncTime)}</div></div>
              <div><Typography.Text type="secondary">CNI</Typography.Text><div>{displayValue(cluster.platform.cniPlugin)}</div></div>
              <div><Typography.Text type="secondary">容器运行时</Typography.Text><div>{displayValue(cluster.platform.criRuntime)}</div></div>
            </div>
          </Col>
        </Row>
      </section>

      {statsQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          title="资源统计加载失败"
          description={statsQuery.error instanceof Error ? statsQuery.error.message : "无法读取当前集群的已同步资源统计。"}
          action={<Button size="small" onClick={() => void statsQuery.refetch()}>重试</Button>}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone={cluster.nodeSummary.degraded ? "warning" : "info"} icon={<CloudServerOutlined />} label="节点" value={cluster.nodeSummary.degraded && cluster.nodeSummary.total === 0 ? "--" : cluster.nodeSummary.total} meta={`就绪 ${cluster.nodeSummary.ready} · 未就绪 ${cluster.nodeSummary.notReady}`} /></Col>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone="info" icon={<ApiOutlined />} label="Namespace" value={displayValue(statsQuery.data?.namespaces)} meta={statsQuery.isLoading ? "正在同步资源统计" : "当前集群已同步记录"} /></Col>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone="success" icon={<DeploymentUnitOutlined />} label="Workload" value={displayValue(workloadTotal)} meta={workloadTotal === undefined ? "暂无统计数据" : `健康 ${workloadHealthy ?? 0} · 异常 ${workloadUnhealthy ?? 0}`} /></Col>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone="info" icon={<DatabaseOutlined />} label="Pod" value={displayValue(topology?.pods)} meta="当前集群已同步 Pod" /></Col>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone="info" icon={<NodeIndexOutlined />} label="Service" value={displayValue(topology?.services)} meta="当前集群服务入口" /></Col>
        <Col xs={24} sm={12} xl={8}><OpsMetricTile tone="info" icon={<GlobalOutlined />} label="Ingress" value={displayValue(topology?.ingresses)} meta="当前集群外部入口" /></Col>
      </Row>

      <OpsSurface variant="panel" padding="md" style={panelStyle} title="资源使用率">
        {resourceUsage?.cpu && resourceUsage.memory ? (
          <Row gutter={[32, 20]}>
            <Col xs={24} md={12}>
              <ResourceMetricPanel label="CPU" metric={resourceUsage.cpu} />
            </Col>
            <Col xs={24} md={12}>
              <ResourceMetricPanel label="内存" metric={resourceUsage.memory} />
            </Col>
          </Row>
        ) : (
          <Typography.Text type="secondary">{statsQuery.isLoading ? "正在加载资源指标。" : "当前没有可用的资源指标。"}</Typography.Text>
        )}
      </OpsSurface>
    </div>
  );
}

export default function ClusterOverviewPage() {
  const params = useParams<{ clusterId: string }>();
  const clusterId = typeof params.clusterId === "string" ? params.clusterId : "";

  return (
    <ClusterContextProvider clusterId={clusterId}>
      <ClusterInfoContent />
    </ClusterContextProvider>
  );
}
