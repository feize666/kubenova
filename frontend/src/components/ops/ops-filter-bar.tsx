"use client";

import type { ReactNode } from "react";
import { OpsFilterChip, type OpsFilterChipTone } from "./ops-filter-chip";

export type OpsFilterBarItemWidth = "xs" | "sm" | "md" | "lg" | "xl" | "auto" | "fill";

export type OpsActiveFilter = {
  key: string;
  label: ReactNode;
  value: ReactNode;
  tone?: OpsFilterChipTone;
  disabled?: boolean;
  onClear?: () => void;
};

export type OpsFilterBarProps = {
  children?: ReactNode;
  actions?: ReactNode;
  activeFilters?: OpsActiveFilter[];
  className?: string;
  compact?: boolean;
};

export type OpsFilterBarItemProps = {
  children: ReactNode;
  label?: ReactNode;
  width?: OpsFilterBarItemWidth;
  className?: string;
};

const widthClassMap: Record<OpsFilterBarItemWidth, string> = {
  xs: "ops-filter-bar__item--xs",
  sm: "ops-filter-bar__item--sm",
  md: "ops-filter-bar__item--md",
  lg: "ops-filter-bar__item--lg",
  xl: "ops-filter-bar__item--xl",
  auto: "ops-filter-bar__item--auto",
  fill: "ops-filter-bar__item--fill",
};

export function OpsFilterBar({
  actions,
  activeFilters = [],
  children,
  className,
  compact = false,
}: OpsFilterBarProps) {
  const visibleActiveFilters = activeFilters.filter((item) => Boolean(item.value));

  return (
    <div className={["ops-filter-bar", compact ? "ops-filter-bar--compact" : undefined, className].filter(Boolean).join(" ")}>
      <div className="ops-filter-bar__main">
        <div className="ops-filter-bar__controls">{children}</div>
        {actions ? <div className="ops-filter-bar__actions">{actions}</div> : null}
      </div>
      {visibleActiveFilters.length > 0 ? (
        <div className="ops-filter-bar__active" aria-label="已启用过滤条件">
          {visibleActiveFilters.map((item) => (
            <OpsFilterChip
              key={item.key}
              tone={item.tone ?? "info"}
              closable={Boolean(item.onClear)}
              closeLabel={`移除${String(item.label)}`}
              disabled={item.disabled}
              onClose={() => item.onClear?.()}
            >
              <span className="ops-filter-bar__active-label">{item.label}</span>
              <span className="ops-filter-bar__active-value">{item.value}</span>
            </OpsFilterChip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OpsFilterBarItem({
  children,
  className,
  label,
  width = "md",
}: OpsFilterBarItemProps) {
  return (
    <div className={["ops-filter-bar__item", widthClassMap[width], className].filter(Boolean).join(" ")}>
      {label ? <div className="ops-filter-bar__label">{label}</div> : null}
      {children}
    </div>
  );
}
