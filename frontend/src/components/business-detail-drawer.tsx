"use client";

import { Space, Typography } from "antd";
import type { ReactNode } from "react";
import { DetailDescriptions, DetailSection } from "@/components/resource-detail/section-primitives";
import { OpsDrawerShell, OpsEmptyState, OpsFilterChip } from "@/components/ops";

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
      bodyClassName="business-detail-drawer__body"
      styles={{
        body: { padding: 24 },
      }}
    >
      {sections.length === 0 ? (
        <OpsEmptyState title="暂无详情数据" description="当前记录没有可展示的业务明细。" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <div className="business-detail-drawer__identity">
            <OpsFilterChip tone="info">业务详情</OpsFilterChip>
            {subtitle ? <OpsFilterChip tone="neutral">{subtitle}</OpsFilterChip> : null}
            <OpsFilterChip tone="neutral">{sections.length} 个分组</OpsFilterChip>
          </div>
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
