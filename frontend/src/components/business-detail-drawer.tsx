"use client";

import { Empty, Space, Typography } from "antd";
import type { ReactNode } from "react";
import { DetailDescriptions, DetailSection } from "@/components/resource-detail/section-primitives";
import { OpsDrawerShell } from "@/components/ops";

export type BusinessDetailItem = {
  key: string;
  label: string;
  value: ReactNode;
};

export type BusinessDetailSection = {
  key: string;
  title: string;
  subtitle?: string;
  items: BusinessDetailItem[];
};

export type BusinessDetailDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  sections: BusinessDetailSection[];
  onClose: () => void;
};

export function BusinessDetailDrawer({
  open,
  title,
  subtitle,
  sections,
  onClose,
}: BusinessDetailDrawerProps) {
  return (
    <OpsDrawerShell
      title={
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{title}</Typography.Text>
          {subtitle ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {subtitle}
            </Typography.Text>
          ) : null}
        </Space>
      }
      open={open}
      onClose={onClose}
      destroyOnHidden
      size="large"
      variant="business"
      styles={{
        body: { padding: 24 },
      }}
    >
      {sections.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情数据" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {sections.map((section) => (
            <DetailSection key={section.key} title={section.title} subtitle={section.subtitle}>
              <DetailDescriptions items={section.items} />
            </DetailSection>
          ))}
        </Space>
      )}
    </OpsDrawerShell>
  );
}
