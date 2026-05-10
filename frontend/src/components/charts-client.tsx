"use client";

import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Col, Empty, Row, Segmented, Space, Tag, Timeline, Tooltip, theme } from "antd";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { useMemo, useState } from "react";
import ECharts from "@/components/echarts";
import { useThemeMode } from "@/components/theme-context";
import type { DashboardStats } from "@/lib/api/dashboard";

// ---------- 共享静态数据（装饰用，非真实业务数据） ----------

const TREND_TIME = ["00:00", "04:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00", "23:00", "23:59"];
const CPU_TREND    = [18, 22, 35, 42, 58, 63, 60, 55, 48, 43, 38, 32];
const MEMORY_TREND = [35, 37, 42, 46, 52, 55, 54, 51, 48, 45, 42, 40];

const ALERT_DAYS  = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const ALERT_CRIT  = [1, 0, 2, 3, 1, 0, 1];
const ALERT_WARN  = [3, 2, 4, 5, 2, 1, 2];
const ALERT_INFO  = [5, 4, 6, 8, 4, 2, 3];

interface ActivityItem {
  time: string;
  event: string;
  level: "critical" | "warning" | "info" | "success";
}

const ACTIVITY_ITEMS: ActivityItem[] = [
  { time: "23:41", event: "kube-scheduler 重试调度", level: "info" },
  { time: "22:18", event: "node-3 磁盘延迟升高 > 50ms", level: "warning" },
  { time: "21:05", event: "网关 5xx 峰值触发告警", level: "critical" },
  { time: "20:34", event: "AI 根因定位完成，定位到 DB 慢查询", level: "info" },
  { time: "19:49", event: "自动回滚完成，服务已恢复", level: "success" },
  { time: "18:12", event: "订单服务 Pod 自动扩缩容 +2", level: "info" },
  { time: "16:30", event: "证书续期成功（*.prod.cluster）", level: "success" },
];

const LEVEL_COLOR: Record<ActivityItem["level"], string> = {
  critical: "#ef4444",
  warning:  "#f59e0b",
  info:     "#3b82f6",
  success:  "#10b981",
};

const LEVEL_LABEL: Record<ActivityItem["level"], string> = {
  critical: "严重",
  warning:  "警告",
  info:     "信息",
  success:  "恢复",
};

const LEVEL_ICON: Record<ActivityItem["level"], string> = {
  critical: "🔴",
  warning:  "🟡",
  info:     "🔵",
  success:  "🟢",
};

// ---------- 子组件：CPU / 内存趋势图 ----------
function TrendChart({ isDark }: { isDark: boolean }) {
  const option: EChartsOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: isDark ? "#1a2234" : "#fff",
      borderColor: isDark ? "rgba(59,130,246,0.3)" : "#e2e8f0",
      textStyle: { color: isDark ? "#e2e8f0" : "#1e293b", fontSize: 12 },
      formatter: (params: unknown) => {
        const items = params as Array<{ seriesName: string; value: number; marker: string }>;
        if (!items?.length) return "";
        const time = TREND_TIME[items[0] ? (items[0] as unknown as { dataIndex: number }).dataIndex : 0] ?? "";
        return `<div style="font-size:12px;padding:2px 0">${time}</div>` +
          items.map(p => `<div>${p.marker} ${p.seriesName}：<b>${p.value}%</b></div>`).join("");
      },
    },
    legend: {
      top: 4,
      right: 8,
      textStyle: { color: isDark ? "#94a3b8" : "#64748b", fontSize: 12 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
    },
    grid: { left: 44, right: 16, top: 36, bottom: 32 },
    xAxis: {
      type: "category",
      data: TREND_TIME,
      boundaryGap: false,
      axisLine: { lineStyle: { color: isDark ? "rgba(59,130,246,0.2)" : "#e2e8f0" } },
      axisTick: { show: false },
      axisLabel: { color: isDark ? "#64748b" : "#94a3b8", fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "%",
      min: 0,
      max: 100,
      nameTextStyle: { color: isDark ? "#64748b" : "#94a3b8", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: isDark ? "#64748b" : "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: isDark ? "rgba(59,130,246,0.07)" : "rgba(0,0,0,0.06)", type: "dashed" } },
    },
    series: [
      {
        name: "CPU",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: CPU_TREND,
        lineStyle: { color: "#3b82f6", width: 2 },
        areaStyle: {
          color: isDark
            ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(59,130,246,0.45)" },
                { offset: 1, color: "rgba(59,130,246,0.03)" },
              ])
            : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(37,99,235,0.18)" },
                { offset: 1, color: "rgba(37,99,235,0.01)" },
              ]),
        },
        emphasis: { focus: "series" },
      },
      {
        name: "内存",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: MEMORY_TREND,
        lineStyle: { color: "#a855f7", width: 2 },
        areaStyle: {
          color: isDark
            ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(168,85,247,0.35)" },
                { offset: 1, color: "rgba(168,85,247,0.02)" },
              ])
            : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: "rgba(124,58,237,0.14)" },
                { offset: 1, color: "rgba(124,58,237,0.01)" },
              ]),
        },
        emphasis: { focus: "series" },
      },
    ],
    animationDuration: 800,
    animationEasing: "cubicOut",
  }), [isDark]);

  return <ECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />;
}

// ---------- 子组件：集群健康 — 三彩色大数字 ----------
function ClusterHealthNumbers({
  isDark,
  stats,
}: {
  isDark: boolean;
  stats?: DashboardStats;
}) {
  const { token } = theme.useToken();
  const healthy = stats?.clusters.healthy ?? 0;
  const warning = stats?.clusters.warning ?? 0;
  const total   = stats?.clusters.total ?? 0;
  const faulted = Math.max(0, total - healthy - warning);

  if (total === 0) {
    return (
      <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Empty description={<span style={{ color: "#64748b" }}>暂无集群数据</span>} />
      </div>
    );
  }

  const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 0;
  const items = [
    { label: "健康", value: healthy, color: "#10b981", glow: "rgba(16,185,129,0.5)", bg: "rgba(16,185,129,0.08)" },
    { label: "告警", value: warning, color: "#f59e0b", glow: "rgba(245,158,11,0.5)", bg: "rgba(245,158,11,0.08)" },
    { label: "故障", value: faulted, color: "#ef4444", glow: "rgba(239,68,68,0.5)", bg: "rgba(239,68,68,0.08)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 280, justifyContent: "center", gap: 0 }}>
      {/* 三大数字行 */}
      <div style={{ display: "flex", alignItems: "stretch", justifyContent: "center", gap: 0 }}>
        {items.map((item, idx) => (
          <div key={item.label} style={{ display: "flex", alignItems: "stretch" }}>
            {/* 竖线分隔符 */}
            {idx > 0 && (
              <div
                style={{
                  width: 1,
                  margin: "12px 24px",
                  background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                  alignSelf: "stretch",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "16px 20px",
                borderRadius: 10,
                background: item.bg,
                border: `1px solid ${item.color}${isDark ? "28" : "18"}`,
                minWidth: 80,
              }}
            >
              <span
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: item.color,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-2px",
                  filter: isDark ? `drop-shadow(0 0 10px ${item.glow})` : "none",
                  textShadow: isDark ? `0 0 20px ${item.color}60` : "none",
                }}
              >
                {item.value}
              </span>
              <span style={{ fontSize: 12, color: item.color, fontWeight: 600, opacity: 0.85 }}>
                {item.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 健康率进度条 */}
      <div style={{ marginTop: 24, padding: "0 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: token.colorTextSecondary }}>
          <span>集群健康率</span>
          <span style={{ fontWeight: 700, color: healthPct >= 80 ? "#10b981" : "#f59e0b" }}>{healthPct}%</span>
        </div>
        <div
          style={{
            position: "relative",
            height: 8,
            borderRadius: 4,
            background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${healthPct}%`,
              borderRadius: 4,
              background: healthPct >= 80
                ? "linear-gradient(90deg, #10b981, #34d399)"
                : healthPct >= 50
                ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                : "linear-gradient(90deg, #ef4444, #f87171)",
              boxShadow: healthPct >= 80 ? "0 0 10px rgba(16,185,129,0.6)" : "0 0 10px rgba(245,158,11,0.5)",
              transition: "width 0.8s ease",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 4, textAlign: "center" }}>
          共 {total} 个集群
        </div>
      </div>
    </div>
  );
}

// ---------- 子组件：告警分布 — 横向 Progress bar 列表 ----------
function AlertProgressList({ isDark }: { isDark: boolean }) {
  const { token } = theme.useToken();
  // 每天汇总数据转为按类型汇总（展示每日最高值）
  const alertTypes = [
    {
      label: "严重告警",
      color: "#ef4444",
      dotGlow: "rgba(239,68,68,0.5)",
      bg: "rgba(239,68,68,0.08)",
      data: ALERT_CRIT,
    },
    {
      label: "警告告警",
      color: "#f59e0b",
      dotGlow: "rgba(245,158,11,0.5)",
      bg: "rgba(245,158,11,0.08)",
      data: ALERT_WARN,
    },
    {
      label: "提示信息",
      color: "#3b82f6",
      dotGlow: "rgba(59,130,246,0.5)",
      bg: "rgba(59,130,246,0.08)",
      data: ALERT_INFO,
    },
  ];

  const days = ALERT_DAYS;
  const maxVal = Math.max(
    ...ALERT_CRIT.map((c, i) => c + ALERT_WARN[i] + ALERT_INFO[i])
  );

  return (
    <div style={{ padding: "4px 0" }}>
      {/* 日期 × 类型 分层进度条 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {days.map((day, dayIdx) => {
          const crit = ALERT_CRIT[dayIdx];
          const warn = ALERT_WARN[dayIdx];
          const info = ALERT_INFO[dayIdx];
          const total = crit + warn + info;
          return (
            <div key={day} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* 星期标签 */}
              <span
                style={{
                  fontSize: 11,
                  color: token.colorTextSecondary,
                  width: 30,
                  flexShrink: 0,
                  textAlign: "right",
                }}
              >
                {day}
              </span>
              {/* 分段进度条 */}
              <div
                style={{
                  flex: 1,
                  height: 16,
                  borderRadius: 4,
                  background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                  overflow: "hidden",
                  display: "flex",
                }}
              >
                {total > 0 && (
                  <>
                    <div
                      style={{
                        width: `${(crit / maxVal) * 100}%`,
                        background: "#ef4444",
                        opacity: isDark ? 0.9 : 0.8,
                        transition: "width 0.6s ease",
                      }}
                    />
                    <div
                      style={{
                        width: `${(warn / maxVal) * 100}%`,
                        background: "#f59e0b",
                        opacity: isDark ? 0.9 : 0.8,
                        transition: "width 0.6s ease",
                      }}
                    />
                    <div
                      style={{
                        width: `${(info / maxVal) * 100}%`,
                        background: "#3b82f6",
                        opacity: isDark ? 0.85 : 0.75,
                        transition: "width 0.6s ease",
                      }}
                    />
                  </>
                )}
              </div>
              {/* 总数 */}
              <span
                style={{
                  fontSize: 11,
                  color: token.colorTextSecondary,
                  width: 20,
                  flexShrink: 0,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {total}
              </span>
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div style={{ display: "flex", gap: 16, marginTop: 14, justifyContent: "center" }}>
        {alertTypes.map((t) => (
          <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: 2,
                background: t.color,
                boxShadow: isDark ? `0 0 6px ${t.dotGlow}` : "none",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: token.colorTextSecondary }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 子组件：近期活动 — Timeline 风格 ----------
function ActivityTimeline({ isDark }: { isDark: boolean }) {
  const { token } = theme.useToken();

  const timelineItems = ACTIVITY_ITEMS.map((item) => {
    const color = LEVEL_COLOR[item.level];
    const icon = LEVEL_ICON[item.level];
    return {
      dot: (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: `${color}${isDark ? "22" : "15"}`,
            border: `1.5px solid ${color}${isDark ? "80" : "60"}`,
            fontSize: 10,
            boxShadow: isDark ? `0 0 8px ${color}50` : "none",
          }}
        >
          {icon}
        </span>
      ),
      children: (
        <div style={{ paddingBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <span
              style={{
                fontSize: 13,
                color: isDark ? "#cbd5e1" : "#334155",
                flex: 1,
                lineHeight: 1.4,
              }}
            >
              {item.event}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 4,
                background: `${color}${isDark ? "22" : "15"}`,
                color,
                flexShrink: 0,
                border: `1px solid ${color}${isDark ? "35" : "25"}`,
              }}
            >
              {LEVEL_LABEL[item.level]}
            </span>
          </div>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 3 }}>
            今日 {item.time}
          </div>
        </div>
      ),
    };
  });

  return (
    <div style={{ paddingTop: 4 }}>
      <Timeline
        items={timelineItems}
        style={{
          paddingLeft: 4,
        }}
      />
    </div>
  );
}

// ---------- 主导出：DashboardCharts ----------
export function DashboardCharts({ stats }: { stats?: DashboardStats }) {
  const { mode } = useThemeMode();
  const isDark = mode === "dark";
  const { token } = theme.useToken();
  const [healthMetric, setHealthMetric] = useState<"综合健康" | "服务可用性" | "变更风险">("综合健康");

  // 健康评分仪表盘
  const healthScore = healthMetric === "综合健康" ? 86 : healthMetric === "服务可用性" ? 92 : 78;

  const gaugeColor = healthScore >= 80 ? "#10b981" : healthScore >= 60 ? "#f59e0b" : "#ef4444";
  const gaugeGradStart = healthScore >= 80 ? "#10b981" : healthScore >= 60 ? "#f59e0b" : "#ef4444";
  const gaugeGradEnd   = healthScore >= 80 ? "#34d399" : healthScore >= 60 ? "#fbbf24" : "#f87171";

  const gaugeOption: EChartsOption = useMemo(() => ({
    backgroundColor: "transparent",
    series: [
      {
        type: "gauge",
        center: ["50%", "55%"],
        radius: "86%",
        min: 0,
        max: 100,
        splitNumber: 5,
        startAngle: 220,
        endAngle: -40,
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [0.5,  isDark ? "#ef444460" : "#ef444435"],
              [0.75, isDark ? "#f59e0b60" : "#f59e0b35"],
              [1.0,  isDark ? "#10b98160" : "#10b98130"],
            ],
          },
        },
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: gaugeGradStart },
              { offset: 1, color: gaugeGradEnd },
            ]),
            shadowBlur: isDark ? 16 : 4,
            shadowColor: `${gaugeColor}80`,
          },
        },
        pointer: {
          length: "55%",
          width: 4,
          itemStyle: { color: isDark ? "#e2e8f0" : "#1e293b" },
        },
        axisTick: { show: false },
        splitLine: {
          length: 10,
          distance: -22,
          lineStyle: { color: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)", width: 1 },
        },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 32,
          fontWeight: 800,
          color: gaugeColor,
          formatter: "{value}",
          offsetCenter: [0, "28%"],
        },
        title: {
          offsetCenter: [0, "52%"],
          color: isDark ? "#64748b" : "#94a3b8",
          fontSize: 12,
        },
        data: [{ value: healthScore, name: healthMetric }],
      },
    ],
    animationDuration: 600,
  }), [healthScore, isDark, healthMetric, gaugeColor, gaugeGradStart, gaugeGradEnd]);

  const cardBg = isDark
    ? { background: "#111827", border: "1px solid rgba(59,130,246,0.12)" }
    : { background: "#fff", border: "1px solid rgba(59,130,246,0.15)" };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {/* 中部：趋势图 + 集群健康 */}
      <Row gutter={[16, 16]}>
        {/* CPU/内存趋势 */}
        <Col xs={24} xl={14}>
          <Card
            className="cyber-panel"
            title={
              <span style={{ color: token.colorText, fontWeight: 600 }}>
                CPU / 内存趋势
              </span>
            }
            extra={
              <Tag color={isDark ? "processing" : "blue"} style={{ fontSize: 11 }}>
                最近 24h
              </Tag>
            }
            styles={{ body: { paddingTop: 8 } }}
          >
            <TrendChart isDark={isDark} />
          </Card>
        </Col>

        {/* 集群健康 — 三色大数字 */}
        <Col xs={24} xl={10}>
          <Card
            className="cyber-panel"
            title={
              <Space>
                <span style={{ color: token.colorText, fontWeight: 600 }}>
                  集群健康
                </span>
                <Tooltip title="健康=正常运行，告警=有告警但未中断，故障=无法访问">
                  <InfoCircleOutlined style={{ color: "#64748b", fontSize: 13 }} />
                </Tooltip>
              </Space>
            }
            styles={{ body: { paddingTop: 8 } }}
          >
            <ClusterHealthNumbers isDark={isDark} stats={stats} />
          </Card>
        </Col>
      </Row>

      {/* 底部：告警分布 + 活动流 */}
      <Row gutter={[16, 16]}>
        {/* 告警分布 — 横向 Progress bar */}
        <Col xs={24} xl={10}>
          <Card
            className="cyber-panel"
            title={
              <span style={{ color: token.colorText, fontWeight: 600 }}>
                告警分布
              </span>
            }
            extra={
              <Tag color="warning" style={{ fontSize: 11 }}>
                最近 7 天
              </Tag>
            }
            styles={{ body: { paddingTop: 12 } }}
          >
            <AlertProgressList isDark={isDark} />
          </Card>
        </Col>

        {/* 近期活动 — Timeline */}
        <Col xs={24} xl={14}>
          <Card
            className="cyber-panel"
            title={
              <span style={{ color: token.colorText, fontWeight: 600 }}>
                近期活动
              </span>
            }
            extra={
              <span style={{ fontSize: 11, color: "#64748b" }}>
                最新 {ACTIVITY_ITEMS.length} 条
              </span>
            }
            styles={{
              body: {
                maxHeight: 340,
                overflowY: "auto",
                paddingTop: 16,
                scrollbarWidth: "thin",
              },
            }}
          >
            <ActivityTimeline isDark={isDark} />
          </Card>
        </Col>
      </Row>

      {/* 集群健康评分仪表盘 */}
      <Card
        className="cyber-panel"
        title={
          <Space>
            <span style={{ color: token.colorText, fontWeight: 600 }}>
              集群健康评分
            </span>
            <Tooltip title="综合资源利用率、可用性、告警密度与近期变更风险计算">
              <InfoCircleOutlined style={{ color: "#64748b", fontSize: 13 }} />
            </Tooltip>
          </Space>
        }
        extra={
          <Segmented
            size="small"
            value={healthMetric}
            options={["综合健康", "服务可用性", "变更风险"]}
            onChange={(v) => setHealthMetric(v as typeof healthMetric)}
          />
        }
      >
        <Row gutter={[16, 0]} align="middle">
          <Col xs={24} md={8}>
            <ECharts option={gaugeOption} style={{ height: 220 }} notMerge lazyUpdate />
          </Col>
          <Col xs={24} md={16}>
            <Row gutter={[12, 12]}>
              {[
                { label: "在线节点", value: "42", unit: "个", color: "#3b82f6", glow: "rgba(59,130,246,0.4)" },
                { label: "运行 Pod", value: "1,286", unit: "个", color: "#10b981", glow: "rgba(16,185,129,0.4)" },
                { label: "高优告警", value: stats?.alerts.critical?.toString() ?? "0", unit: "条", color: "#ef4444", glow: "rgba(239,68,68,0.4)" },
                { label: "SLA 达成", value: "99.94", unit: "%", color: "#a855f7", glow: "rgba(168,85,247,0.4)" },
              ].map(({ label, value, unit, color, glow }) => (
                <Col xs={12} key={label}>
                  <div
                    style={{
                      ...cardBg,
                      borderRadius: 10,
                      padding: "12px 14px",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {/* 顶部色条 */}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: `linear-gradient(90deg, transparent, ${color}${isDark ? "aa" : "66"}, transparent)`,
                      }}
                    />
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span
                        style={{
                          fontSize: 24,
                          fontWeight: 800,
                          color,
                          fontVariantNumeric: "tabular-nums",
                          filter: isDark ? `drop-shadow(0 0 8px ${glow})` : "none",
                        }}
                      >
                        {value}
                      </span>
                      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{unit}</span>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
            {/* 稳定性进度条 */}
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, ...cardBg }}>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>当前稳定性</div>
              <div style={{ position: "relative", height: 8, borderRadius: 4, background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)", overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${healthScore}%`,
                    borderRadius: 4,
                    background: healthScore >= 80
                      ? `linear-gradient(90deg, ${gaugeGradStart}, ${gaugeGradEnd})`
                      : healthScore >= 60
                      ? "linear-gradient(90deg, #f59e0b, #fcd34d)"
                      : "linear-gradient(90deg, #ef4444, #f87171)",
                    boxShadow: `0 0 10px ${gaugeColor}60`,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: token.colorTextTertiary }}>
                <span>0</span>
                <span style={{ fontWeight: 700, color: gaugeColor }}>{healthScore} / 100</span>
                <span>100</span>
              </div>
            </div>
          </Col>
        </Row>
      </Card>
    </Space>
  );
}

// ---------- 拓扑图表（保留原有，供 /network/topology 使用） ----------
export { };
