"use client";

import type { HTMLAttributes, ReactNode } from "react";

export type OpsMetricTileTone = "neutral" | "info" | "success" | "warning" | "danger";

export type OpsMetricTileProps = HTMLAttributes<HTMLDivElement> & {
  detail?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  statusLabel?: ReactNode;
  suffix?: ReactNode;
  tone?: OpsMetricTileTone;
  trend?: ReactNode;
  value: ReactNode;
};

export function OpsMetricTile({
  className,
  detail,
  icon,
  label,
  meta,
  statusLabel,
  suffix,
  tone = "neutral",
  trend,
  value,
  ...props
}: OpsMetricTileProps) {
  return (
    <div
      {...props}
      data-tone={tone}
      className={[
        "ops-metric-tile",
        `ops-metric-tile--${tone}`,
        className,
      ].filter(Boolean).join(" ")}
    >
      <div className="ops-metric-tile__header">
        <span className="ops-metric-tile__label">{label}</span>
        <span className="ops-metric-tile__header-extra">
          {statusLabel ? <span className="ops-metric-tile__status">{statusLabel}</span> : null}
          {icon ? <span className="ops-metric-tile__icon" aria-hidden>{icon}</span> : null}
        </span>
      </div>
      <div className="ops-metric-tile__value">
        <strong className="ops-metric-tile__value-main">{value}</strong>
        {suffix ? <span className="ops-metric-tile__value-suffix">{suffix}</span> : null}
      </div>
      <span className="ops-metric-tile__rail" aria-hidden />
      {(meta || trend || detail) ? (
        <div className="ops-metric-tile__footer">
          {meta ? <span className="ops-metric-tile__meta">{meta}</span> : null}
          {trend ? <span className="ops-metric-tile__trend">{trend}</span> : null}
          {detail ? <span className="ops-metric-tile__detail">{detail}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
