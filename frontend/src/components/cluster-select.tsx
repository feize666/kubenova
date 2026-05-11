"use client";

import { Select } from "antd";
import type { CSSProperties } from "react";

export type ClusterOption = { label: string; value: string };

type ClusterSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: ClusterOption[];
  loading?: boolean;
  placeholder?: string;
  showAllOption?: boolean;
  allowClear?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function ClusterSelect({
  value,
  onChange,
  options,
  loading,
  placeholder = "全部集群",
  showAllOption,
  allowClear = true,
  className = "resource-filter-select",
  style,
}: ClusterSelectProps) {
  const shouldShowAllOption = showAllOption ?? placeholder === "全部集群";
  const normalizedOptions = shouldShowAllOption
    ? [{ label: placeholder, value: "" }, ...options.filter((option) => option.value !== "")]
    : options;

  return (
    <Select
      className={className}
      style={{ width: "100%", ...style }}
      placeholder={placeholder}
      value={shouldShowAllOption ? value ?? "" : value || undefined}
      onChange={(next) => onChange(next ?? "")}
      allowClear={allowClear}
      options={normalizedOptions}
      loading={loading}
      showSearch
      optionFilterProp="label"
      filterOption={(input, option) =>
        String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
