"use client";

type ConfigCountCellProps = {
  value?: number | null;
  label: string;
};

type ConfigVersionCellProps = {
  value?: number | null;
};

export function ConfigCountCell({ value, label }: ConfigCountCellProps) {
  const count = typeof value === "number" ? value : 0;
  const tone = count > 0 ? "is-active" : "is-empty";

  return (
    <span className={`config-count-cell ${tone}`}>
      <span className="config-count-cell__value">{count}</span>
      <span className="config-count-cell__label">{label}</span>
    </span>
  );
}

export function ConfigVersionCell({ value }: ConfigVersionCellProps) {
  if (typeof value !== "number") {
    return <span className="config-version-cell is-empty">-</span>;
  }

  return (
    <span className="config-version-cell">
      <span className="config-version-cell__prefix">v</span>
      <span className="config-version-cell__value">{value}</span>
    </span>
  );
}
