"use client";

import type { ReactNode } from "react";

export type OpsSeverityLevel = "critical" | "warning" | "info" | "success" | "neutral" | "unknown";
export type OpsStatusTone = OpsSeverityLevel | "processing" | "danger";

const STATUS_TONE_CLASS: Record<OpsStatusTone, string> = {
  critical: "ops-status--critical",
  danger: "ops-status--critical",
  warning: "ops-status--warning",
  info: "ops-status--info",
  success: "ops-status--success",
  neutral: "ops-status--neutral",
  unknown: "ops-status--unknown",
  processing: "ops-status--processing",
};

const STATE_TONE: Record<string, { tone: OpsStatusTone; label: string }> = {
  active: { tone: "success", label: "已启用" },
  disabled: { tone: "neutral", label: "已禁用" },
  deleted: { tone: "danger", label: "已删除" },
  unknown: { tone: "unknown", label: "未知" },
  running: { tone: "success", label: "运行中" },
  pending: { tone: "warning", label: "等待中" },
  failed: { tone: "danger", label: "失败" },
  succeeded: { tone: "success", label: "成功" },
  firing: { tone: "danger", label: "告警中" },
  resolved: { tone: "success", label: "已恢复" },
  silenced: { tone: "neutral", label: "已静默" },
  Healthy: { tone: "success", label: "健康" },
  Warning: { tone: "warning", label: "告警" },
  Critical: { tone: "danger", label: "严重" },
  Maintenance: { tone: "neutral", label: "维护中" },
};

const SEVERITY_LABEL: Record<OpsSeverityLevel, string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
  success: "正常",
  neutral: "中性",
  unknown: "未知",
};

function toneClass(tone: OpsStatusTone) {
  return STATUS_TONE_CLASS[tone] ?? STATUS_TONE_CLASS.unknown;
}

export function OpsStatusTag({
  state,
  tone,
  children,
  className,
}: {
  state?: string;
  tone?: OpsStatusTone;
  children?: ReactNode;
  className?: string;
}) {
  const resolved = state ? STATE_TONE[state] : undefined;
  const resolvedTone = tone ?? resolved?.tone ?? "neutral";
  const label = children ?? resolved?.label ?? state ?? "-";
  return (
    <span className={["ops-status-tag", toneClass(resolvedTone), className].filter(Boolean).join(" ")}>
      {label}
    </span>
  );
}

export function OpsSeverityPill({
  level,
  label,
  className,
}: {
  level: OpsSeverityLevel;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <span className={["ops-severity-pill", toneClass(level), className].filter(Boolean).join(" ")}>
      {label ?? SEVERITY_LABEL[level]}
    </span>
  );
}
