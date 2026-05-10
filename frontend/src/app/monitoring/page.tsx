"use client";

import { Alert, Card, Space, Typography } from "antd";

export default function MonitoringPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>
          检测中心已下线
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          按当前产品策略，检测中心数据面板与独立入口已移除。
        </Typography.Paragraph>
      </Card>

      <Alert
        type="info"
        showIcon
        message="可用入口"
        description="请从左侧“可观测性”访问当前可用能力（如集群健康、资源巡检）。"
      />
    </Space>
  );
}
