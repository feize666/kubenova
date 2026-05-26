"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Input, Space } from "antd";
import type { ReactNode } from "react";

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

export function ResourceFilterToolbar({ children, actions, className }: ResourceFilterToolbarProps) {
  return (
    <div className={["resource-filter-toolbar", className].filter(Boolean).join(" ")}>
      <div className="resource-filter-toolbar-controls">{children}</div>
      {actions ? (
        <Space className="resource-filter-toolbar-actions" size={8} wrap>
          {actions}
        </Space>
      ) : null}
    </div>
  );
}

export function ResourceFilterToolbarItem({
  children,
  label,
  width = "md",
  className,
}: ResourceFilterToolbarItemProps) {
  return (
    <div className={["resource-filter-toolbar-item", widthClassMap[width], className].filter(Boolean).join(" ")}>
      {label ? <div className="resource-filter-toolbar-label">{label}</div> : null}
      {children}
    </div>
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
