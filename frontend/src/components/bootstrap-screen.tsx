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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background:
          "radial-gradient(ellipse at 20% 20%, rgba(59,130,246,0.12) 0%, transparent 45%), radial-gradient(ellipse at 80% 80%, rgba(56,189,248,0.08) 0%, transparent 45%), var(--color-bg)",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--color-border)",
          borderRadius: 20,
          background: "var(--color-card)",
          boxShadow: "0 24px 60px rgba(15,23,42,0.18)",
          padding: 28,
        }}
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
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
