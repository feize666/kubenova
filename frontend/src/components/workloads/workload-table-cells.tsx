"use client";

import { OpsStatusTag, type OpsStatusTone } from "@/components/ops/ops-status";

type WorkloadStateTagProps = {
  label: string;
  tone: OpsStatusTone;
};

type WorkloadReplicaCellProps = {
  value: number | string | null | undefined;
  target?: number | string | null;
  variant?: "default" | "ready" | "desired" | "available";
};

function toFiniteNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function WorkloadStateTag({ label, tone }: WorkloadStateTagProps) {
  return (
    <span className="workload-state-cell">
      <span className={`workload-state-cell__dot is-${tone}`} />
      <OpsStatusTag tone={tone}>{label}</OpsStatusTag>
    </span>
  );
}

export function WorkloadReplicaCell({
  value,
  target,
  variant = "default",
}: WorkloadReplicaCellProps) {
  const numericValue = toFiniteNumber(value);
  const numericTarget = toFiniteNumber(target);
  const hasTarget = typeof numericTarget === "number" && numericTarget > 0;
  const percent =
    typeof numericValue === "number" && hasTarget
      ? Math.max(0, Math.min(100, (numericValue / numericTarget) * 100))
      : null;
  const displayValue = value ?? "-";

  return (
    <span className={`workload-replica-cell is-${variant}`}>
      <span className="workload-replica-cell__value">{displayValue}</span>
      {hasTarget ? (
        <span className="workload-replica-cell__track" aria-hidden="true">
          <span style={{ width: `${percent ?? 0}%` }} />
        </span>
      ) : null}
    </span>
  );
}
