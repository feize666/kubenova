"use client";

import { Descriptions, Empty, Space, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { OpsFilterChip, OpsSurface, type OpsFilterChipProps, type OpsFilterChipTone } from "@/components/ops";

export function DetailSection({
  title,
  subtitle,
  extra,
  children,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <OpsSurface
      className="resource-detail-section"
      variant="raised"
      padding="md"
      title={title}
      subtitle={subtitle}
      actions={extra}
    >
      {children}
    </OpsSurface>
  );
}

export function DetailDescriptions({
  items,
  emptyText = "暂无数据",
}: {
  items: Array<{ key: string; label: string; value: ReactNode }>;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  const renderValue = (value: ReactNode) => {
    if (typeof value !== "string" && typeof value !== "number") {
      return value;
    }

    const text = String(value);
    if (!text || text === "-") {
      return text;
    }

    return (
      <Tooltip title={text} placement="topLeft">
        <Typography.Text
          className="resource-detail-field-value"
          ellipsis
          style={{ display: "inline-block", maxWidth: "100%" }}
        >
          {text}
        </Typography.Text>
      </Tooltip>
    );
  };

  return (
    <Descriptions
      size="small"
      column={1}
      bordered
      styles={{
        label: { width: "34%", fontSize: 12, verticalAlign: "top" },
        content: { fontSize: 13 },
      }}
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        children: renderValue(item.value),
      }))}
    />
  );
}

function mapTagColorToTone(color?: string): OpsFilterChipTone {
  if (color === "green" || color === "success") return "success";
  if (color === "gold" || color === "orange" || color === "warning") return "warning";
  if (color === "red" || color === "volcano" || color === "error" || color === "danger") return "danger";
  if (color === "default") return "neutral";
  return "info";
}

export function DetailTag({
  color = "default",
  children,
  ...props
}: Omit<OpsFilterChipProps, "tone"> & {
  color?: string;
}) {
  return (
    <OpsFilterChip {...props} tone={mapTagColorToTone(color)}>
      {children}
    </OpsFilterChip>
  );
}

export function DetailChipList({ items, color = "default" }: { items: string[]; color?: string }) {
  if (items.length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return (
    <Space size={[6, 6]} wrap>
      {items.map((item) => (
        <DetailTag key={item} color={color}>
          {item}
        </DetailTag>
      ))}
    </Space>
  );
}
