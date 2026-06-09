"use client";

import { Skeleton, Space, Typography } from "antd";

export function BootstrapScreen({
  title = "KubeNova",
  description = "正在初始化控制台，请稍候...",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="bootstrap-screen">
      <div className="bootstrap-screen__panel">
        <Space orientation="vertical" size={18} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0, color: "var(--surface-text)" }}>
              {title}
            </Typography.Title>
            <Typography.Text style={{ color: "var(--surface-subtle)" }}>{description}</Typography.Text>
          </div>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Space>
      </div>
    </div>
  );
}
