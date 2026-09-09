"use client";

import {
  ApiOutlined,
  ApartmentOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Col, Progress, Row, Space, Typography } from "antd";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClusterContextProvider, useClusterContext } from "@/components/cluster-context";
import { OpsFilterChip, OpsLoadingState, OpsMetricTile, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { useAuth } from "@/components/auth-context";
import { getDashboardStats } from "@/lib/api/dashboard";
import { QUERY_CACHE_TIMINGS } from "@/lib/query";
import { buildClusterResourceHref } from "@/lib/cluster-workspace";

const panelStyle = {
  background: "#ffffff",
  borderColor: "#b9d7f5",
  boxShadow: "0 8px 24px rgba(24, 91, 167, 0.08)",
};

const softBlueStyle = {
  background: "#f3f8ff",
  border: "1px solid #d5e7fb",
};

const workspaceEntries = [
  { key: "workloads", title: "工作负载", description: "Pod、Deployment 与任务运行状态", path: "workloads/pods", icon: <DeploymentUnitOutlined /> },
  { key: "network", title: "网络管理", description: "Service、Ingress 与端点链路", path: "network/services", icon: <ApiOutlined /> },
  { key: "storage", title: "存储管理", description: "PVC、PV 与存储类", path: "storage/pvc", icon: <DatabaseOutlined /> },
  { key: "configs", title: "配置管理", description: "ConfigMap、Secret 与服务账号", path: "configs/configmaps", icon: <SafetyCertificateOutlined /> },
  { key: "topology", title: "资源拓扑", description: "工作负载、网络、存储依赖关系", path: "network/topology", icon: <ApartmentOutlined /> },
] as const;

function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function usageTone(value: number | undefined) {
  if (value === undefined) return "normal";
  if (value >= 90) return "exception";
  if (value >= 75) return "active";
  return "success";
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

      <section style={{ ...softBlueStyle, borderRadius: 8, padding: 20 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Typography.Text type="secondary">当前集群</Typography.Text>
            <Typography.Title level={3} style={{ margin: "4px 0 8px", color: "#0b4f9c" }}>{cluster.displayName || cluster.name}</Typography.Title>
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

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}><OpsMetricTile tone="info" icon={<CloudServerOutlined />} label="节点" value={cluster.nodeSummary.total} meta={`就绪 ${cluster.nodeSummary.ready} · 未就绪 ${cluster.nodeSummary.notReady}`} /></Col>
        <Col xs={24} sm={12} xl={6}><OpsMetricTile tone="info" icon={<ApiOutlined />} label="名称空间" value={displayValue(statsQuery.data?.namespaces)} meta={statsQuery.isLoading ? "正在同步资源统计" : "当前集群已同步记录"} /></Col>
        <Col xs={24} sm={12} xl={6}><OpsMetricTile tone="success" icon={<DeploymentUnitOutlined />} label="工作负载" value={displayValue(workloadTotal)} meta={workloadTotal === undefined ? "暂无统计数据" : `健康 ${workloadHealthy ?? 0} · 异常 ${workloadUnhealthy ?? 0}`} /></Col>
        <Col xs={24} sm={12} xl={6}><OpsMetricTile tone="info" icon={<DatabaseOutlined />} label="拓扑资源" value={displayValue(topology?.pods)} meta={topology ? `服务 ${topology.services} · 入口 ${topology.ingresses}` : "暂无拓扑统计"} /></Col>
      </Row>

      <OpsSurface variant="panel" padding="md" style={panelStyle} title="资源工作台">
        <Row gutter={[12, 12]}>
          {workspaceEntries.map((entry) => (
            <Col xs={24} sm={12} xl={8} key={entry.key}>
              <Link
                href={buildClusterResourceHref(clusterId, entry.path)}
                className="cluster-workspace-entry"
              >
                <span className="cluster-workspace-entry__icon" aria-hidden>{entry.icon}</span>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.description}</small>
                </span>
              </Link>
            </Col>
          ))}
        </Row>
      </OpsSurface>

      <OpsSurface variant="panel" padding="md" style={panelStyle} title="资源使用率">
        {resourceUsage ? (
          <Row gutter={[32, 20]}>
            <Col xs={24} md={12}>
              <Typography.Text strong>CPU</Typography.Text>
              <Progress percent={Math.round(resourceUsage.cpuUsagePercent)} status={usageTone(resourceUsage.cpuUsagePercent)} strokeColor="#1677ff" trailColor="#dcecff" />
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text strong>内存</Typography.Text>
              <Progress percent={Math.round(resourceUsage.memoryUsagePercent)} status={usageTone(resourceUsage.memoryUsagePercent)} strokeColor="#1677ff" trailColor="#dcecff" />
            </Col>
          </Row>
        ) : (
          <Typography.Text type="secondary">当前没有可用的实时资源使用率数据。</Typography.Text>
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
