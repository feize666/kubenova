"use client";

import { Select } from "antd";
import type { CSSProperties } from "react";
import { useMemo } from "react";

export type ResourceFacetSelectOption = { label: string; value: string };

type ResourceFacetSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ResourceFacetSelectOption[];
  /** Optional label for the "no filter" entry; an explicit empty-value option wins. */
  allLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Single-layer facet filter (resource type, strategy, environment...).
 *
 * Shares the canonical labeled-select presentation with the namespace filter so
 * every list control in the console renders with the same height, typography,
 * hover/focus treatment and dropdown surface instead of a nested popover form.
 */
export function ResourceFacetSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  disabled = false,
  loading = false,
  className,
  style,
}: ResourceFacetSelectProps) {
  const normalizedOptions = useMemo(() => {
    if (options.some((option) => option.value === "")) return options;
    return [{ label: allLabel ?? `全部${label}`, value: "" }, ...options];
  }, [allLabel, label, options]);

  const summary = useMemo(
    () => normalizedOptions.find((option) => option.value === value)?.label ?? value,
    [normalizedOptions, value],
  );

  return (
    <Select<string>
      aria-label={`选择${label}`}
      className={["namespace-filter-select", "resource-facet-select", className].filter(Boolean).join(" ")}
      classNames={{ popup: { root: "namespace-filter-select-dropdown resource-facet-select-dropdown" } }}
      style={{ width: "100%", ...style }}
      value={value}
      onChange={onChange}
      options={normalizedOptions}
      loading={loading}
      disabled={disabled}
      showSearch
      prefix={<span className="namespace-filter-select__label">{label}:</span>}
      placeholder={summary || allLabel || `全部${label}`}
      popupMatchSelectWidth={240}
      listHeight={288}
      notFoundContent={`未找到匹配的${label}`}
      filterOption={(input, option) => {
        if (option?.value === "") return true;
        return String(option?.label ?? "")
          .toLocaleLowerCase()
          .includes(input.trim().toLocaleLowerCase());
      }}
    />
  );
}
