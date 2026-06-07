"use client";

import { OpsFilterChip, OpsStatusTag, type OpsStatusTone } from "@/components/ops";

type StorageCapacityCellProps = {
  value?: string | null;
};

type StorageModeListCellProps = {
  values?: string[] | null;
  limit?: number;
};

type StorageStateCellProps = {
  label: string;
  tone: OpsStatusTone;
};

export function StorageCapacityCell({ value }: StorageCapacityCellProps) {
  return (
    <span className="storage-capacity-cell">
      {value || "-"}
    </span>
  );
}

export function StorageModeListCell({ values, limit = 2 }: StorageModeListCellProps) {
  const list = values?.filter(Boolean) ?? [];
  if (list.length === 0) return <span className="storage-mode-list is-empty">-</span>;

  const visible = list.slice(0, limit);
  const hidden = Math.max(0, list.length - visible.length);
  return (
    <span className="storage-mode-list">
      {visible.map((value) => (
        <OpsFilterChip key={value} tone="info">{value}</OpsFilterChip>
      ))}
      {hidden > 0 ? <OpsFilterChip tone="neutral">+{hidden}</OpsFilterChip> : null}
    </span>
  );
}

export function StorageStateCell({ label, tone }: StorageStateCellProps) {
  return (
    <span className="storage-state-cell">
      <span className={`storage-state-cell__dot is-${tone}`} />
      <OpsStatusTag tone={tone}>{label}</OpsStatusTag>
    </span>
  );
}
