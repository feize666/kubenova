"use client";

import { Card, Descriptions, Empty, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";

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
        borderRadius: 16,
        border: "1px solid var(--color-border, rgba(59, 130, 246, 0.15))",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-card-high, #1a2234) 78%, transparent) 0%, color-mix(in srgb, var(--color-card, #111827) 92%, transparent) 100%)",
        boxShadow: "0 10px 28px rgba(2, 8, 23, 0.14)",
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

export function TagList({ items, color = "default" }: { items: string[]; color?: string }) {
  if (items.length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return (
    <Space size={[6, 6]} wrap>
      {items.map((item) => (
        <Tag key={item} color={color}>
          {item}
        </Tag>
      ))}
    </Space>
  );
}
