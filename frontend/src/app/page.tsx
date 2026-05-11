"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Col, Row, Skeleton, Space, Tag, Typography } from "antd";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-context";
import {
  ActivityTimeline,
  DashboardMetricShell,
  MetricRingVisual,
  MetricPanel,
  ResourceToolbar,
  SeverityPill,
  SurfacePanel,
  MetricUnitFormatter,
} from "@/components/visual-system";
import { getDashboardStats } from "@/lib/api/dashboard";

const DashboardChartsV2 = dynamic(
  () => import("@/components/dashboard-charts").then((m) => m.DashboardChartsV2),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 420,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    ),
  },
);

function formatAge(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "刚刚";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function getUsageLevel(percent: number | undefined, degraded: boolean) {
  if (degraded || typeof percent !== "number") return "unknown" as const;
  if (percent >= 85) return "critical" as const;
  if (percent >= 65) return "warning" as const;
  return "success" as const;
}

function getUsageSubtitle(params: {
  dataSource: "metrics-server" | "k8s-metadata" | "none";
  degraded: boolean;
  note?: string;
}) {
  if (params.degraded) {
    return params.note ?? "请先执行集群同步以获取真实 CPU/内存数据。";
  }
  return "集群平均";
}

function formatLiveCpu(value?: number | null) {
  return MetricUnitFormatter({ kind: "cpu", value });
}

function formatLiveMemory(value?: number | null) {
  return MetricUnitFormatter({ kind: "memory", value });
}

export default function HomePage() {
  const { accessToken, isInitializing } = useAuth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => getDashboardStats(accessToken || undefined),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const riskSummary = useMemo(() => {
    const critical = stats?.alerts.critical ?? 0;
    const unhealthy = stats?.workloads.unhealthy ?? 0;
    const clusterWarning = stats?.clusters.warning ?? 0;
    const healthScore = stats?.healthScore ?? 0;
    const riskLevel =
      critical > 0 ? "critical" : unhealthy > 0 || clusterWarning > 0 ? "warning" : "success";
    return {
      critical,
      unhealthy,
      clusterWarning,
      healthScore,
      riskLevel,
    } as const;
  }, [stats]);

  const timelineItems = useMemo(
    () =>
      (stats?.recentEvents ?? []).slice(0, 6).map((item) => ({
        id: item.id,
        title: item.event,
        source: item.source,
        time: formatAge(item.timestamp),
        level: item.level,
      })),
    [stats?.recentEvents],
  );

  const resourceUsageSummary = useMemo(() => {
    const usage = stats?.resourceUsage;
    if (!usage) {
      return {
        cpuUsagePercent: undefined as number | undefined,
        memoryUsagePercent: undefined as number | undefined,
        dataSource: "none" as const,
        degraded: true,
        note: isLoading
          ? "正在加载实时使用率数据。"
          : "未检测到可用的 CPU/内存使用率同步数据，请先执行集群同步。",
      };
    }

    return {
      cpuUsagePercent: usage.cpuUsagePercent,
      memoryUsagePercent: usage.memoryUsagePercent,
      dataSource: usage.dataSource,
      degraded: usage.degraded,
      note: usage.note,
      liveSnapshot: usage.liveSnapshot,
    };
  }, [isLoading, stats?.resourceUsage]);

  const liveSnapshot = resourceUsageSummary.liveSnapshot;
  const showResourceUsageWarning = Boolean(stats?.resourceUsage?.degraded) && !isLoading;

  const cpuRing = liveSnapshot?.available ? (
    <MetricRingVisual
      value={formatLiveCpu(liveSnapshot.cpuUsage)}
      percent={typeof liveSnapshot.cpuUsage === "number" ? Math.min(100, liveSnapshot.cpuUsage * 1000) : 0}
      color="#3fb950"
      size={112}
      showGlow
    />
  ) : null;

  const memoryRing = liveSnapshot?.available ? (
    <MetricRingVisual
      value={formatLiveMemory(liveSnapshot.memoryUsage)}
      percent={typeof liveSnapshot.memoryUsage === "number" ? (liveSnapshot.memoryUsage / (1024 ** 3)) * 100 : 0}
      color="#58a6ff"
      size={112}
      showGlow
    />
  ) : null;

  return (
    <Space orientation="vertical" size={14} style={{ width: "100%" }}>
      <ResourceToolbar
        left={
          <>
            <Typography.Text style={{ fontSize: 18, fontWeight: 700, color: "var(--surface-text)" }}>
              智能仪表盘
            </Typography.Text>
            <SeverityPill level={riskSummary.riskLevel} label="当前风险" />
          </>
        }
        right={
          <>
            <Tag variant="filled" color="blue">
              集群 {stats?.clusters.total ?? 0}
            </Tag>
            <Tag variant="filled" color="gold">
              活跃告警 {stats?.alerts.total ?? 0}
            </Tag>
          </>
        }
      />

      {showResourceUsageWarning && stats?.resourceUsage ? (
        <Alert
          type="warning"
          showIcon
          message="资源使用率数据降级"
          description={
            <Space size={8} wrap>
              <span>{stats.resourceUsage.note ?? "请先执行集群同步以获取真实 CPU/内存数据。"}</span>
              <Tag color="default">来源: {stats.resourceUsage.dataSource}</Tag>
            </Space>
          }
        />
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12}>
          <DashboardMetricShell
            title="CPU Usage"
            value={
              liveSnapshot?.available
                ? formatLiveCpu(liveSnapshot.cpuUsage)
                : typeof resourceUsageSummary.cpuUsagePercent === "number"
                  ? `${resourceUsageSummary.cpuUsagePercent}%`
                : "--"
            }
            subtitle={getUsageSubtitle({
              dataSource: resourceUsageSummary.dataSource,
              degraded: resourceUsageSummary.degraded,
              note: resourceUsageSummary.note,
            })}
            badge={<SeverityPill level={getUsageLevel(resourceUsageSummary.cpuUsagePercent, resourceUsageSummary.degraded)} />}
            progress={resourceUsageSummary.cpuUsagePercent ?? 0}
            ring={cpuRing}
          />
        </Col>
        <Col xs={24} md={12}>
          <DashboardMetricShell
            title="Memory Usage"
            value={
              liveSnapshot?.available
                ? formatLiveMemory(liveSnapshot.memoryUsage)
                : typeof resourceUsageSummary.memoryUsagePercent === "number"
                  ? `${resourceUsageSummary.memoryUsagePercent}%`
                : "--"
            }
            subtitle={getUsageSubtitle({
              dataSource: resourceUsageSummary.dataSource,
              degraded: resourceUsageSummary.degraded,
              note: resourceUsageSummary.note,
            })}
            badge={<SeverityPill level={getUsageLevel(resourceUsageSummary.memoryUsagePercent, resourceUsageSummary.degraded)} />}
            progress={resourceUsageSummary.memoryUsagePercent ?? 0}
            ring={memoryRing}
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} lg={6}>
          <MetricPanel
            title="严重告警"
            value={riskSummary.critical}
            level={riskSummary.critical > 0 ? "critical" : "success"}
            subtitle={riskSummary.critical > 0 ? "需要立即处理" : "当前无严重告警"}
          />
        </Col>
        <Col xs={24} md={12} lg={6}>
          <MetricPanel
            title="异常工作负载"
            value={riskSummary.unhealthy}
            level={riskSummary.unhealthy > 0 ? "warning" : "success"}
            subtitle={riskSummary.unhealthy > 0 ? "存在未就绪工作负载" : "核心负载运行稳定"}
          />
        </Col>
        <Col xs={24} md={12} lg={6}>
          <MetricPanel
            title="风险集群"
            value={riskSummary.clusterWarning}
            level={riskSummary.clusterWarning > 0 ? "warning" : "success"}
            subtitle={riskSummary.clusterWarning > 0 ? "建议检查集群状态" : "集群状态稳定"}
          />
        </Col>
        <Col xs={24} md={12} lg={6}>
          <MetricPanel
            title="健康评分"
            value={`${riskSummary.healthScore}`}
            level={riskSummary.healthScore < 70 ? "warning" : "success"}
            progress={riskSummary.healthScore}
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24}>
          <SurfacePanel>
            <div style={{ padding: "12px 14px" }}>
              <Typography.Text style={{ display: "block", fontSize: 11, color: "var(--surface-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                当前变化
              </Typography.Text>
              <Typography.Text style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--surface-subtle)" }}>
                最近告警事件
              </Typography.Text>
            </div>
            <ActivityTimeline items={timelineItems} emptyText="暂无告警事件" />
          </SurfacePanel>
        </Col>
      </Row>

      <SurfacePanel>
        <div style={{ padding: "12px 14px" }}>
          <Typography.Text style={{ display: "block", fontSize: 11, color: "var(--surface-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            当前动作
          </Typography.Text>
          <Typography.Text style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--surface-subtle)" }}>
            高频运维入口
          </Typography.Text>
          <div style={{ marginTop: 12 }}>
            <Space wrap>
              <Link href="/network/topology">
                <Button type="primary">查看资源全景图</Button>
              </Link>
              <Link href="/inspection">
                <Button>查看资源巡检</Button>
              </Link>
              <Link href="/workloads/deployments">
                <Button>查看工作负载</Button>
              </Link>
              <Link href="/workloads/helm">
                <Button>查看 Helm 应用</Button>
              </Link>
            </Space>
          </div>
        </div>
      </SurfacePanel>

      <SurfacePanel>
        <div style={{ padding: "12px 14px" }}>
          <Typography.Text style={{ display: "block", fontSize: 11, color: "var(--surface-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            运行分析
          </Typography.Text>
          <Typography.Text style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--surface-subtle)" }}>
            集群、告警与 live metrics 分布图
          </Typography.Text>
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <DashboardChartsV2 stats={stats} />
        </div>
      </SurfacePanel>

      {isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
    </Space>
  );
}
