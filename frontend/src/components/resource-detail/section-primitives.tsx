"use client";

import { Card, Descriptions, Empty, Space, Typography } from "antd";
import type { ReactNode } from "react";
import { OpsFilterChip, type OpsFilterChipProps, type OpsFilterChipTone } from "@/components/ops";

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
    <Card
      size="small"
      variant="borderless"
      style={{
        borderRadius: 8,
        border: "1px solid var(--ops-border-subtle, var(--color-border, rgba(59, 130, 246, 0.15)))",
        background: "var(--ops-surface-raised, var(--color-card, #111827))",
        boxShadow: "var(--ops-shadow-subtle, 0 10px 28px rgba(2, 8, 23, 0.14))",
      }}
      styles={{
        header: { paddingBlock: 14, paddingInline: 18 },
        body: { padding: 16 },
      }}
      title={
        <Space orientation="vertical" size={2} style={{ width: "100%" }}>
          <Typography.Text strong style={{ fontSize: 15 }}>
            {title}
          </Typography.Text>
          {subtitle ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {subtitle}
            </Typography.Text>
          ) : null}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
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
        children: item.value,
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
