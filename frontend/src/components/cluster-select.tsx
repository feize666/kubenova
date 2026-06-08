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
  notFoundContent?: string;
  unavailable?: boolean;
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
  notFoundContent,
  unavailable = false,
  style,
}: ClusterSelectProps) {
  const shouldShowAllOption = showAllOption ?? placeholder === "全部集群";
  const hasSelectableClusters = options.some((option) => option.value !== "");
  const isUnavailable = !loading && unavailable;
  const normalizedOptions = shouldShowAllOption
    ? isUnavailable
      ? []
      : [{ label: placeholder, value: "" }, ...options.filter((option) => option.value !== "")]
    : options;

  return (
    <Select
      className={className}
      style={{ width: "100%", ...style }}
      placeholder={isUnavailable ? "集群状态不可用" : placeholder}
      value={isUnavailable ? undefined : shouldShowAllOption ? value ?? "" : value || undefined}
      onChange={(next) => onChange(next ?? "")}
      allowClear={allowClear}
      options={normalizedOptions}
      loading={loading}
      disabled={isUnavailable}
      notFoundContent={isUnavailable ? "集群状态不可用" : notFoundContent ?? (!loading && !hasSelectableClusters ? "暂无可选集群" : undefined)}
      showSearch
      optionFilterProp="label"
      filterOption={(input, option) =>
        String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
