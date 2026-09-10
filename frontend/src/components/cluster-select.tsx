"use client";

import { LockOutlined } from "@ant-design/icons";
import { Select } from "antd";
import type { SelectProps } from "antd";
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { resolveWorkspaceClusterFieldValue } from "@/lib/cluster-workspace";

export type ClusterOption = { label: string; value: string };

type ClusterSelectProps = {
  value?: string;
  onChange?: (value: string) => void;
  options: ClusterOption[];
  loading?: boolean;
  placeholder?: string;
  showAllOption?: boolean;
  allowClear?: boolean;
  className?: string;
  notFoundContent?: string;
  unavailable?: boolean;
  style?: CSSProperties;
  disabled?: boolean;
  showSearch?: boolean;
  optionFilterProp?: string;
  filterOption?: (input: string, option?: { label?: string; value?: string }) => boolean;
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
  disabled = false,
  showSearch = true,
  optionFilterProp = "label",
  filterOption,
}: ClusterSelectProps) {
  const workspace = useOptionalClusterWorkspace();
  const workspaceClusterId = resolveWorkspaceClusterFieldValue(workspace?.clusterId, "");
  const shouldShowAllOption = showAllOption ?? placeholder === "全部集群";
  const hasSelectableClusters = options.some((option) => option.value !== "");
  const isUnavailable = !loading && unavailable;
  const scopedOptions = workspaceClusterId
    ? options.filter((option) => option.value === workspaceClusterId)
    : options;
  const workspaceLabel = workspaceClusterId
    ? getClusterDisplayName(
        Object.fromEntries(options.map((option) => [option.value, option.label])),
        workspaceClusterId,
      )
    : "";

  useEffect(() => {
    if (workspaceClusterId && value !== workspaceClusterId) {
      onChange?.(workspaceClusterId);
    }
  }, [onChange, value, workspaceClusterId]);

  const normalizedOptions = workspaceClusterId
    ? [{ label: workspaceLabel || workspaceClusterId, value: workspaceClusterId }]
    : shouldShowAllOption
    ? isUnavailable
      ? []
      : [{ label: placeholder, value: "" }, ...scopedOptions.filter((option) => option.value !== "")]
    : scopedOptions;

  return (
    <Select
      className={className}
      style={{ width: "100%", ...style }}
      placeholder={workspaceClusterId ? "当前集群" : isUnavailable ? "集群状态不可用" : placeholder}
      value={isUnavailable ? undefined : workspaceClusterId || (shouldShowAllOption ? value ?? "" : value || undefined)}
      onChange={(next) => onChange?.(workspaceClusterId || next || "")}
      allowClear={allowClear}
      options={normalizedOptions}
      loading={loading}
      disabled={disabled || Boolean(workspaceClusterId) || isUnavailable}
      suffixIcon={workspaceClusterId ? <LockOutlined /> : undefined}
      notFoundContent={isUnavailable ? "集群状态不可用" : notFoundContent ?? (!loading && !hasSelectableClusters ? "暂无可选集群" : undefined)}
      showSearch={showSearch}
      optionFilterProp={optionFilterProp}
      filterOption={filterOption
        ? (filterOption as SelectProps["filterOption"])
        : ((input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase()))}
    />
  );
}
