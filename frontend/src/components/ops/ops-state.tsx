"use client";

import {
  DisconnectOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  StopOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

export type OpsStateTone = "neutral" | "info" | "success" | "warning" | "danger";
export type OpsStateKind = "loading" | "empty" | "filtered-empty" | "error" | "degraded" | "permission" | "disabled";

export type OpsStateProps = {
  kind?: OpsStateKind;
  tone?: OpsStateTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

function getDefaultTone(kind: OpsStateKind): OpsStateTone {
  if (kind === "loading") return "info";
  if (kind === "error") return "danger";
  if (kind === "degraded") return "warning";
  if (kind === "permission" || kind === "disabled") return "neutral";
  return "neutral";
}

function getStateIcon(kind: OpsStateKind) {
  if (kind === "loading") return <LoadingOutlined className="ops-state__icon-spin" />;
  if (kind === "error") return <ExclamationCircleOutlined />;
  if (kind === "degraded") return <WarningOutlined />;
  if (kind === "permission") return <StopOutlined />;
  if (kind === "disabled") return <DisconnectOutlined />;
  if (kind === "filtered-empty") return <InfoCircleOutlined />;
  return <InboxOutlined />;
}

export function OpsState({
  action,
  className,
  compact = false,
  description,
  kind = "empty",
  title,
  tone,
}: OpsStateProps) {
  const resolvedTone = tone ?? getDefaultTone(kind);

  return (
    <div
      className={[
        "ops-state",
        `ops-state--${kind}`,
        `ops-state--${resolvedTone}`,
        compact ? "ops-state--compact" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      role={kind === "error" || kind === "degraded" ? "alert" : "status"}
      aria-live={kind === "loading" ? "polite" : undefined}
    >
      <div className="ops-state__icon" aria-hidden="true">
        {getStateIcon(kind)}
      </div>
      <div className="ops-state__content">
        <div className="ops-state__title">{title}</div>
        {description ? <div className="ops-state__description">{description}</div> : null}
      </div>
      {action ? <div className="ops-state__action">{action}</div> : null}
    </div>
  );
}

export function OpsLoadingState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="loading" />;
}

export function OpsEmptyState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="empty" />;
}

export function OpsFilteredEmptyState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="filtered-empty" />;
}

export function OpsErrorState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="error" />;
}

export function OpsDegradedState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="degraded" />;
}

export function OpsPermissionState(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="permission" />;
}

export function OpsDisabledReason(props: Omit<OpsStateProps, "kind">) {
  return <OpsState {...props} kind="disabled" />;
}
