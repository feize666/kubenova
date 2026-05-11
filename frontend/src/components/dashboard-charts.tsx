"use client";

/**
 * dashboard-charts.tsx
 * Grafana/DataDog-style operational dashboard panels.
 * Dark: #0d1117 bg, rgba(22,27,34,0.9) cards, #30363d borders
 * Light: #f6f8fa bg, #ffffff cards, #d0d7de borders
 */

import { Col, Row, Segmented, theme } from "antd";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  LinearScale,
  Tooltip as ChartTooltip,
} from "chart.js";
import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import type { DashboardStats } from "@/lib/api/dashboard";
import { MetricRingVisual, MetricUnitFormatter } from "@/components/visual-system";

// ---------- Chart.js 注册 ----------
ChartJS.register(BarElement, CategoryScale, LinearScale, ChartTooltip);

// ---------- 共享数据 ----------
interface ActivityItem {
  id: string;
  time: string;
  event: string;
  level: "critical" | "warning" | "info";
  source?: string;
}

const LEVEL_COLOR: Record<ActivityItem["level"], string> = {
  critical: "#f85149",
  warning: "#d29922",
  info: "#58a6ff",
};

const LEVEL_LABEL: Record<ActivityItem["level"], string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

// ---------- 主题 tokens ----------
function useThemeTokens(isDark: boolean) {
  return {
    bg: isDark ? "rgba(22,27,34,0.9)" : "#ffffff",
    border: isDark ? "#30363d" : "#d0d7de",
    titleColor: isDark ? "#8b949e" : "#57606a",
    valueColor: isDark ? "#e6edf3" : "#1f2328",
    metaColor: isDark ? "#484f58" : "#8c959f",
    gridColor: isDark ? "#21262d" : "#eaeef2",
    hoverBg: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
    innerBorder: isDark ? "#21262d" : "#eaeef2",
  };
}

function TrendBars({
  values,
  color,
  isDark,
}: {
  values: number[];
  color: string;
  isDark: boolean;
}) {
  const max = Math.max(...values, 1);
  const minHeight = 8;
  return (
    <div style={{ display: "flex", alignItems: "end", gap: 4, height: 48 }}>
      {values.map((value, index) => {
        const height = Math.max(minHeight, (value / max) * 100);
        return (
          <div
            key={`${index}-${value}`}
            style={{
              flex: 1,
              height: `${height}%`,
              minHeight,
              borderRadius: 4,
              background: color,
              opacity: isDark ? 0.9 : 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

// ---------- 卡片容器 ----------
function Panel({
  isDark,
  children,
  style,
}: {
  isDark: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = useThemeTokens(isDark);
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        boxShadow: isDark
          ? "0 1px 3px rgba(0,0,0,0.4)"
          : "0 1px 3px rgba(27,31,36,0.04)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---------- 卡片头部 ----------
function PanelHeader({
  title,
  extra,
  isDark,
}: {
  title: string;
  extra?: React.ReactNode;
  isDark: boolean;
}) {
  const t = useThemeTokens(isDark);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${t.innerBorder}`,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: t.titleColor,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        }}
      >
        {title}
      </span>
      {extra && (
        <span style={{ fontSize: 11, color: t.titleColor }}>{extra}</span>
      )}
    </div>
  );
}

// ---------- 1. 集群健康 Stat Grid ----------
function ClusterHealthGrid({
  isDark,
  stats,
}: {
  isDark: boolean;
  stats?: DashboardStats;
}) {
  const t = useThemeTokens(isDark);

  const total = stats?.clusters.total ?? 0;
  const healthy = stats?.clusters.healthy ?? 0;
  const warning = stats?.clusters.warning ?? 0;
  const faulted = Math.max(0, total - healthy - warning);

  const items = [
    { label: "健康", value: healthy, color: "#3fb950" },
    { label: "告警", value: warning, color: "#d29922" },
    { label: "故障", value: faulted, color: "#f85149" },
  ];

  const syncTime = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div style={{ padding: "14px 14px 12px" }}>
      {/* 3列 stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: t.innerBorder, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              background: t.bg,
              padding: "12px 10px",
              textAlign: "center",
            }}
          >
            {/* 彩色圆点 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 6 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: item.color,
                  display: "inline-block",
                  boxShadow: isDark ? `0 0 4px ${item.color}80` : "none",
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: t.titleColor,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  letterSpacing: "0.04em",
                }}
              >
                {item.label}
              </span>
            </div>
            {/* 数字 */}
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: item.value > 0 ? item.color : t.metaColor,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {/* 分隔线 + 同步时间 */}
      <div
        style={{
          paddingTop: 10,
          borderTop: `1px solid ${t.innerBorder}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, color: t.metaColor, fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
          总数 / {total}
        </span>
        <span style={{ fontSize: 11, color: t.metaColor, fontFamily: "'SF Mono', 'Fira Code', monospace", fontVariantNumeric: "tabular-nums" }}>
          同步于 {syncTime}
        </span>
      </div>
    </div>
  );
}

// ---------- 2. 告警分布 — 水平条形图 ----------
function AlertBarChart({
  isDark,
  stats,
}: {
  isDark: boolean;
  stats?: DashboardStats;
}) {
  const t = useThemeTokens(isDark);

  const critical = stats?.alerts.critical ?? 0;
  const warning = stats?.alerts.warning ?? 0;
  const info = Math.max(0, (stats?.alerts.total ?? 0) - critical - warning);

  const chartData: ChartData<"bar"> = {
    labels: ["严重", "警告", "提示"],
    datasets: [
      {
        label: "告警数",
        data: [critical, warning, info],
        backgroundColor: ["#f85149", "#d29922", "#58a6ff"],
        borderColor: ["#f85149", "#d29922", "#58a6ff"],
        borderWidth: 0,
        borderRadius: 2,
        borderSkipped: false,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        backgroundColor: isDark ? "#161b22" : "#ffffff",
        borderColor: isDark ? "#30363d" : "#d0d7de",
        borderWidth: 1,
        titleColor: isDark ? "#e6edf3" : "#1f2328",
        bodyColor: isDark ? "#8b949e" : "#57606a",
        titleFont: {
          family: "'SF Mono', 'Fira Code', monospace",
          size: 11,
        },
        bodyFont: {
          family: "'SF Mono', 'Fira Code', monospace",
          size: 11,
        },
        padding: 8,
        callbacks: { label: (ctx) => ` ${ctx.parsed.x} 条` },
      },
      legend: { display: false },
    },
    scales: {
      x: {
        grid: { color: t.gridColor },
        ticks: {
          color: t.titleColor,
          font: { size: 10, family: "'SF Mono', 'Fira Code', monospace" },
          stepSize: 1,
        },
        border: { display: false, dash: [3, 3] },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: t.titleColor,
          font: { size: 11, family: "'SF Mono', 'Fira Code', monospace" },
        },
        border: { display: false },
      },
    },
    animation: { duration: 500 },
  };

  return (
    <div style={{ padding: "12px 14px 14px" }}>
      {/* 3个数字 stat 行 */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 14,
          paddingBottom: 12,
          borderBottom: `1px solid ${t.innerBorder}`,
        }}
      >
        {[
          { label: "严重", value: critical, color: "#f85149" },
          { label: "警告", value: warning, color: "#d29922" },
          { label: "提示", value: info, color: "#58a6ff" },
        ].map((item) => (
          <div key={item.label} style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                color: t.titleColor,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                letterSpacing: "0.06em",
                marginBottom: 3,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: item.color,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
      {/* 水平条形图 */}
      <div style={{ height: 88 }}>
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}

// ---------- 3. 近期活动 — div+flex，monospace ----------
function ActivityList({ isDark, items }: { isDark: boolean; items: ActivityItem[] }) {
  const t = useThemeTokens(isDark);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div>
      {items.map((item, idx) => {
        const color = LEVEL_COLOR[item.level];
        const label = LEVEL_LABEL[item.level];
        const isHovered = hoveredIdx === idx;

        return (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 14px",
              height: 36,
              cursor: "default",
              background: isHovered ? t.hoverBg : "transparent",
              transition: "background 0.1s ease",
              borderBottom: `1px solid ${t.innerBorder}`,
            }}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {/* 彩色4×4方块 */}
            <span
              style={{
                width: 4,
                height: 4,
                background: color,
                flexShrink: 0,
                display: "inline-block",
              }}
            />
            {/* 级别标签 — mono，固定宽 */}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                letterSpacing: "0.04em",
                minWidth: 32,
                flexShrink: 0,
              }}
            >
              {label}
            </span>
            {/* 事件描述 */}
            <span
              style={{
                fontSize: 12,
                color: isDark ? "#c9d1d9" : "#24292f",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.event}
            </span>
            {item.source ? (
              <span
                style={{
                  fontSize: 10,
                  color: t.metaColor,
                  flexShrink: 0,
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                }}
              >
                {item.source}
              </span>
            ) : null}
            {/* 时间戳右对齐 */}
            <span
              style={{
                fontSize: 11,
                color: t.metaColor,
                flexShrink: 0,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {item.time}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 4. 健康评分 — 大数字 + 分段横条 ----------
function HealthScorePanel({
  isDark,
  score,
}: {
  isDark: boolean;
  score: number;
}) {
  const t = useThemeTokens(isDark);

  const scoreColor =
    score >= 80 ? "#3fb950" : score >= 60 ? "#d29922" : "#f85149";
  const scoreLabel =
    score >= 80 ? "健康" : score >= 60 ? "降级" : "严重";

  const zones = [
    { label: "严重", range: "0 – 59", color: "#f85149", active: score < 60 },
    { label: "警告", range: "60 – 79", color: "#d29922", active: score >= 60 && score < 80 },
    { label: "健康", range: "80 – 100", color: "#3fb950", active: score >= 80 },
  ];

  return (
    <div style={{ padding: "20px 14px 16px", textAlign: "center" }}>
      {/* 大数字 */}
      <div
        style={{
          fontSize: 60,
          fontWeight: 700,
          color: scoreColor,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          letterSpacing: "-2px",
        }}
      >
        {score}
      </div>
      {/* 标签 */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: scoreColor,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          letterSpacing: "0.1em",
          marginTop: 4,
          marginBottom: 20,
          opacity: 0.85,
        }}
      >
        {scoreLabel}
      </div>

      {/* 分段横条 */}
      <div
        style={{
          display: "flex",
          gap: 3,
          marginBottom: 8,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {zones.map((z) => (
          <div
            key={z.label}
            style={{
              flex: 1,
              height: 4,
              background: z.color,
              opacity: z.active ? 1 : 0.2,
              transition: "opacity 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* 分段说明 */}
      <div style={{ display: "flex", gap: 3 }}>
        {zones.map((z) => (
          <div
            key={z.label}
            style={{
              flex: 1,
              textAlign: "center",
              opacity: z.active ? 1 : 0.45,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: z.color,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                letterSpacing: "0.06em",
              }}
            >
              {z.label}
            </div>
            <div
              style={{
                fontSize: 10,
                color: t.metaColor,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                marginTop: 2,
              }}
            >
              {z.range}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 主导出 ----------
export function DashboardChartsV2({ stats }: { stats?: DashboardStats }) {
  const { token } = theme.useToken();
  const [healthMetric, setHealthMetric] = useState<"综合健康" | "服务可用性" | "变更风险">(
    "综合健康",
  );

  const baseScore = stats?.healthScore ?? 0;
  const workloadScore =
    stats && stats.workloads.total > 0
      ? Math.round((stats.workloads.healthy / Math.max(stats.workloads.total, 1)) * 100)
      : baseScore;
  const alertPressureScore =
    stats && stats.alerts.total > 0
      ? Math.max(0, 100 - Math.round((stats.alerts.critical * 30 + stats.alerts.warning * 10) / Math.max(stats.alerts.total, 1)))
      : baseScore;
  const scoreMap: Record<typeof healthMetric, number> = {
    综合健康: baseScore,
    服务可用性: workloadScore,
    变更风险: alertPressureScore,
  };
  const healthScore = scoreMap[healthMetric];
  const activityItems: ActivityItem[] = useMemo(
    () =>
      (stats?.recentEvents ?? []).map((item) => ({
        id: item.id,
        time: new Date(item.timestamp).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        event: item.event,
        source: item.source,
        level: item.level,
      })),
    [stats?.recentEvents],
  );
  const liveSnapshot = stats?.resourceUsage?.liveSnapshot;
  const liveHistory = liveSnapshot?.history ?? [];
  const liveCpuSeries = liveHistory
    .map((item) => item.cpuUsage)
    .filter((value): value is number => typeof value === "number");
  const liveMemorySeries = liveHistory
    .map((item) => item.memoryUsage)
    .filter((value): value is number => typeof value === "number");

  // isDark 推断
  const isDark =
    token.colorBgBase === "#0a0e1a" ||
    token.colorBgLayout === "#0a0e1a" ||
    token.colorBgContainer === "rgba(22,27,34,0.9)";
  const t = useThemeTokens(isDark);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Row gutter={[12, 12]}>
        <Col xs={24}>
          <Panel isDark={isDark}>
            <PanelHeader
              title="Live Metrics"
              isDark={isDark}
              extra={
                liveSnapshot ? (
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: isDark ? "rgba(56,189,248,0.1)" : "rgba(14,165,233,0.08)",
                      color: isDark ? "#38bdf8" : "#0284c7",
                      fontSize: 10,
                      fontWeight: 700,
                      border: `1px solid ${isDark ? "rgba(56,189,248,0.25)" : "rgba(14,165,233,0.2)"}`,
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {liveSnapshot.source}
                  </span>
                ) : null
              }
            />
            <div style={{ padding: "12px 14px 14px" }}>
              {liveSnapshot ? (
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={12}>
                    <div style={{ padding: 12, border: `1px solid ${t.innerBorder}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: t.titleColor, marginBottom: 8 }}>CPU</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MetricRingVisual
                        value={MetricUnitFormatter({ kind: "cpu", value: liveSnapshot.cpuUsage })}
                          percent={typeof liveSnapshot.cpuUsage === "number" ? Math.min(100, liveSnapshot.cpuUsage * 1000) : 0}
                          color="#3fb950"
                          size={88}
                          showGlow
                      />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <TrendBars values={liveCpuSeries.length > 0 ? liveCpuSeries : [liveSnapshot.cpuUsage ?? 0]} color="#3fb950" isDark={isDark} />
                      </div>
                    </div>
                  </Col>
                  <Col xs={24} md={12}>
                    <div style={{ padding: 12, border: `1px solid ${t.innerBorder}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: t.titleColor, marginBottom: 8 }}>Memory</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <MetricRingVisual
                        value={MetricUnitFormatter({ kind: "memory", value: liveSnapshot.memoryUsage })}
                          percent={typeof liveSnapshot.memoryUsage === "number" ? (liveSnapshot.memoryUsage / (1024 ** 3)) * 100 : 0}
                          color="#58a6ff"
                          size={88}
                          showGlow
                      />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <TrendBars values={liveMemorySeries.length > 0 ? liveMemorySeries : [liveSnapshot.memoryUsage ?? 0]} color="#58a6ff" isDark={isDark} />
                      </div>
                    </div>
                  </Col>
                </Row>
              ) : (
                <div style={{ color: t.metaColor, fontSize: 12 }}>未检测到 live metrics 数据</div>
              )}
            </div>
          </Panel>
        </Col>
      </Row>

      {/* 第一行：集群健康 + 告警分布 */}
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={10}>
          <Panel isDark={isDark}>
            <PanelHeader
              title="集群健康"
              isDark={isDark}
              extra={
                <span
                  style={{
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: isDark ? "rgba(88,166,255,0.1)" : "rgba(9,105,218,0.08)",
                    color: isDark ? "#58a6ff" : "#0969da",
                    fontSize: 10,
                    fontWeight: 700,
                    border: `1px solid ${isDark ? "rgba(88,166,255,0.25)" : "rgba(9,105,218,0.2)"}`,
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    letterSpacing: "0.04em",
                  }}
                >
                  实时
                </span>
              }
            />
            <ClusterHealthGrid isDark={isDark} stats={stats} />
          </Panel>
        </Col>

        <Col xs={24} xl={14}>
          <Panel isDark={isDark}>
            <PanelHeader title="告警分布" isDark={isDark} />
            <AlertBarChart isDark={isDark} stats={stats} />
          </Panel>
        </Col>
      </Row>

      {/* 第二行：近期活动 + 健康评分 */}
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Panel isDark={isDark} style={{ height: "100%" }}>
            <PanelHeader
              title="近期事件"
              isDark={isDark}
              extra={`最近 ${activityItems.length} 条`}
            />
            <div
              style={{
                maxHeight: 280,
                overflowY: "auto",
                scrollbarWidth: "thin",
              }}
            >
              {activityItems.length > 0 ? (
                <ActivityList isDark={isDark} items={activityItems} />
              ) : (
                <div style={{ padding: 16, color: isDark ? "#8b949e" : "#57606a", fontSize: 12 }}>
                  暂无真实事件数据（请先执行集群同步或等待告警写入）。
                </div>
              )}
            </div>
          </Panel>
        </Col>

        <Col xs={24} xl={10}>
          <Panel isDark={isDark} style={{ height: "100%" }}>
            <PanelHeader
              title="健康评分"
              isDark={isDark}
              extra={
                <Segmented
                  size="small"
                  value={healthMetric}
                  options={["综合健康", "服务可用性", "变更风险"]}
                  onChange={(v) => setHealthMetric(v as typeof healthMetric)}
                  style={{ fontSize: 11 }}
                />
              }
            />
            <HealthScorePanel isDark={isDark} score={healthScore} />
          </Panel>
        </Col>
      </Row>

    </div>
  );
}
