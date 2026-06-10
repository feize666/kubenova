"use client";

import type { HTMLAttributes, ReactNode } from "react";

export type OpsMetricTileTone = "neutral" | "info" | "success" | "warning" | "danger";

export type OpsMetricTileProps = HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  suffix?: ReactNode;
  tone?: OpsMetricTileTone;
  value: ReactNode;
};

export function OpsMetricTile({
  className,
  icon,
  label,
  meta,
  suffix,
  tone = "neutral",
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
        {icon ? <span className="ops-metric-tile__icon" aria-hidden>{icon}</span> : null}
      </div>
      <div className="ops-metric-tile__value">
        <strong className="ops-metric-tile__value-main">{value}</strong>
        {suffix ? <span className="ops-metric-tile__value-suffix">{suffix}</span> : null}
      </div>
      {meta ? <div className="ops-metric-tile__meta">{meta}</div> : null}
    </div>
  );
}
