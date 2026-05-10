"use client";

import { Divider, Progress, Space, Typography } from "antd";
import type { CSSProperties, ReactNode } from "react";

type SeverityLevel = "critical" | "warning" | "info" | "success" | "unknown";
type RuntimeStatus = "Running" | "Pending" | "Failed" | "Unknown";

const SEVERITY_STYLE: Record<SeverityLevel, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", label: "严重" },
  warning: { color: "#f59e0b", bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)", label: "警告" },
  info: { color: "#3b82f6", bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.35)", label: "提示" },
  success: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.35)", label: "正常" },
  unknown: { color: "#94a3b8", bg: "rgba(148,163,184,0.14)", border: "rgba(148,163,184,0.35)", label: "未知" },
};

const STATUS_TO_LEVEL: Record<RuntimeStatus, SeverityLevel> = {
  Running: "success",
  Pending: "warning",
  Failed: "critical",
  Unknown: "unknown",
};

export function MetricUnitFormatter({
  kind,
  value,
}: {
  kind: "cpu" | "memory";
  value?: number | null;
}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  if (kind === "cpu") {
    const millicores = Math.round(value * 1000);
    if (millicores >= 1000) {
      return `${(millicores / 1000).toFixed(2)}c`;
    }
    return `${millicores}m`;
  }

  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} Gi`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} Mi`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} Ki`;
  return `${Math.round(value)} B`;
}

export function MetricRingVisual({
  value,
  percent,
  color,
  size = 120,
  showGlow = false,
}: {
  value: string;
  percent: number;
  color: string;
  size?: number;
  showGlow?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = Math.max(10, Math.round(size / 10));
  const radius = Math.max(18, Math.round((size - stroke) / 2 - 8));
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id={`metric-ring-${size}-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.72} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#metric-ring-${size}-${color.replace(/[^a-z0-9]/gi, "")})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${circumference * (1 - clamped / 100)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {showGlow ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: `0 0 20px ${color}26, inset 0 0 20px ${color}12`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <Typography.Text
          style={{
            fontSize: Math.max(12, Math.round(size / 5)),
            fontWeight: 700,
            color: "var(--surface-text)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value}
        </Typography.Text>
      </div>
    </div>
  );
}

export function DashboardMetricShell({
  title,
  value,
  subtitle,
  badge,
  progress,
  ring,
  emptyText = "暂无指标",
}: {
  title: string;
  value: string;
  subtitle?: string;
  badge?: ReactNode;
  progress?: number;
  ring?: ReactNode;
  emptyText?: string;
}) {
  return (
    <SurfacePanel>
      <div style={{ padding: "14px" }}>
        <Typography.Text style={{ display: "block", fontSize: 11, color: "var(--surface-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </Typography.Text>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: ring ? "1fr auto" : "1fr", gap: 12, alignItems: "center" }}>
          <div>
            <Typography.Text
              style={{
                display: "block",
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1,
                color: "var(--surface-text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </Typography.Text>
            <Typography.Text style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--surface-subtle)" }}>
              {subtitle ?? emptyText}
            </Typography.Text>
            {badge ? <div style={{ marginTop: 10 }}>{badge}</div> : null}
            {typeof progress === "number" ? (
              <div style={{ marginTop: 10 }}>
                <Progress percent={Math.max(0, Math.min(100, progress))} showInfo={false} size={["100%", 4]} />
              </div>
            ) : null}
          </div>
          {ring ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{ring}</div> : null}
        </div>
      </div>
    </SurfacePanel>
  );
}

export function PodMetricCell({
  value,
  percent,
  kind,
}: {
  value?: number | null;
  percent?: number | null;
  kind: "cpu" | "memory";
}) {
  const ringValue = MetricUnitFormatter({ kind, value });
  const displayPercent = typeof percent === "number" && Number.isFinite(percent) ? percent : 0;
  const color = kind === "cpu" ? "#3fb950" : "#58a6ff";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <MetricRingVisual value={ringValue} percent={displayPercent} color={color} size={64} />
    </div>
  );
}

export function SurfacePanel({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        border: "1px solid var(--surface-border)",
        background: "var(--surface-bg)",
        borderRadius: 12,
        boxShadow: "0 6px 20px rgba(15, 23, 42, 0.06)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SurfaceHeader({
  title,
  subtitle,
  extra,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--surface-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text style={{ display: "block", fontSize: 11, color: "var(--surface-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </Typography.Text>
        {subtitle ? (
          <Typography.Text style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--surface-subtle)" }}>
            {subtitle}
          </Typography.Text>
        ) : null}
      </div>
      {extra}
    </div>
  );
}

export function SeverityPill({ level, label }: { level: SeverityLevel; label?: string }) {
  const style = SEVERITY_STYLE[level];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 11,
        lineHeight: "18px",
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.color,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {label ?? style.label}
    </span>
  );
}

export function RuntimeStatusPill({ status }: { status: RuntimeStatus }) {
  return <SeverityPill level={STATUS_TO_LEVEL[status]} label={status} />;
}

export function MetricPanel({
  title,
  value,
  subtitle,
  level = "info",
  progress,
  trend,
  chart,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  level?: SeverityLevel;
  progress?: number;
  trend?: Array<{
    label?: string;
    value?: number | null;
  }>;
  chart?: ReactNode;
}) {
  return (
    <DashboardMetricShell
      title={title}
      value={String(value)}
      subtitle={subtitle}
      badge={!subtitle ? <SeverityPill level={level} /> : undefined}
      progress={progress}
      ring={
        chart ? (
          chart
        ) : trend && trend.length > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "end",
              gap: 4,
              minHeight: 24,
            }}
          >
            {trend.map((item, index) => {
              const height =
                typeof item.value === "number" && Number.isFinite(item.value)
                  ? Math.max(6, Math.min(24, item.value * 18))
                  : 6;
              return (
                <span
                  key={`${item.label ?? "trend"}-${index}`}
                  title={item.label}
                  style={{
                    width: 6,
                    height,
                    borderRadius: 999,
                    background: "linear-gradient(180deg, rgba(59,130,246,0.9), rgba(34,197,94,0.9))",
                    opacity: 0.85,
                  }}
                />
              );
            })}
          </div>
        ) : undefined
      }
    />
  );
}

export function ActivityTimeline({
  items,
  emptyText = "暂无活动",
}: {
  items: Array<{ id: string; title: string; source?: string; time?: string; level: SeverityLevel }>;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <div style={{ padding: "14px" }}>
        <Typography.Text type="secondary">{emptyText}</Typography.Text>
      </div>
    );
  }
  return (
    <div style={{ padding: "8px 14px 12px" }}>
      {items.map((item, index) => (
        <div key={item.id} style={{ display: "flex", gap: 10, padding: "8px 0" }}>
          <div style={{ marginTop: 3 }}>
            <SeverityPill level={item.level} label="" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text style={{ display: "block", fontSize: 13, color: "var(--surface-text)" }}>{item.title}</Typography.Text>
            <Space split={<Divider type="vertical" style={{ marginInline: 4 }} />} size={4} style={{ marginTop: 2 }}>
              {item.source ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.source}</Typography.Text> : null}
              {item.time ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.time}</Typography.Text> : null}
            </Space>
          </div>
          {index < items.length - 1 ? null : null}
        </div>
      ))}
    </div>
  );
}

export function ResourceToolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <SurfacePanel style={{ padding: "10px 12px", borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{left}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{right}</div>
      </div>
    </SurfacePanel>
  );
}
