"use client";

import { Empty, Typography } from "antd";
import { ResourcePageHeader } from "@/components/resource-page-header";

export default function SettingsPage() {
  return (
    <main className="portal-settings">
      <ResourcePageHeader
        title="系统设置"
        path="/settings"
        description="集中管理系统版本与 AI 助手能力"
      />
      <section aria-labelledby="settings-index-title" style={{ display: "grid", gap: 8 }}>
        <Typography.Title id="settings-index-title" level={4} style={{ margin: 0 }}>
          设置模块
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          从左侧选择更新管理或 AI 助手配置。
        </Typography.Paragraph>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择一个设置模块" />
      </section>
    </main>
  );
}
