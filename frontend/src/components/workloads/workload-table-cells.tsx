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
}: WorkloadReplicaCellProps) {
  const displayValue = value ?? "-";

  return (
    <span className="workload-replica-cell">
      <span className="workload-replica-cell__value">{displayValue}</span>
    </span>
  );
}
