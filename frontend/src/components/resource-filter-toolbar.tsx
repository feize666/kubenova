"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Input, Space } from "antd";
import type { ReactNode } from "react";
import {
  OpsFilterBar,
  OpsFilterBarItem,
  type OpsActiveFilter,
} from "@/components/ops";

export type ResourceFilterToolbarItemWidth = "xs" | "sm" | "md" | "lg" | "xl" | "auto" | "fill";

export type ResourceFilterToolbarItemProps = {
  children: ReactNode;
  label?: ReactNode;
  width?: ResourceFilterToolbarItemWidth;
  className?: string;
};

export type ResourceFilterToolbarProps = {
  children?: ReactNode;
  actions?: ReactNode;
  activeFilters?: OpsActiveFilter[];
  className?: string;
};

export type ResourceKeywordSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
  width?: ResourceFilterToolbarItemWidth;
};

const widthClassMap: Record<ResourceFilterToolbarItemWidth, string> = {
  xs: "resource-filter-toolbar-item-xs",
  sm: "resource-filter-toolbar-item-sm",
  md: "resource-filter-toolbar-item-md",
  lg: "resource-filter-toolbar-item-lg",
  xl: "resource-filter-toolbar-item-xl",
  auto: "resource-filter-toolbar-item-auto",
  fill: "resource-filter-toolbar-item-fill",
};

export function ResourceFilterToolbar({ activeFilters, children, actions, className }: ResourceFilterToolbarProps) {
  return (
    <OpsFilterBar
      activeFilters={activeFilters}
      className={["resource-filter-toolbar", className].filter(Boolean).join(" ")}
      actions={actions ? (
        <Space className="resource-filter-toolbar-actions" size={8} wrap>
          {actions}
        </Space>
      ) : null}
    >
      {children}
    </OpsFilterBar>
  );
}

export function ResourceFilterToolbarItem({
  children,
  label,
  width = "md",
  className,
}: ResourceFilterToolbarItemProps) {
  return (
    <OpsFilterBarItem
      label={label}
      width={width}
      className={["resource-filter-toolbar-item", widthClassMap[width], className].filter(Boolean).join(" ")}
    >
      {children}
    </OpsFilterBarItem>
  );
}

export function ResourceKeywordSearch({
  value,
  onChange,
  onSearch,
  placeholder = "按名称/标签搜索",
  width = "lg",
}: ResourceKeywordSearchProps) {
  return (
    <ResourceFilterToolbarItem width={width}>
      <Input
        prefix={<SearchOutlined />}
        allowClear
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onSearch}
      />
    </ResourceFilterToolbarItem>
  );
}
