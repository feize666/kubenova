"use client";

import { CloudDownloadOutlined, LineChartOutlined } from "@ant-design/icons";
import { Button, Col, Row, Space, Typography } from "antd";
import Link from "next/link";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";

export default function SettingsPage() {
  return (
    <main className="portal-settings">
      <ResourcePageHeader
        title="系统设置"
        path="/settings"
        description="集中管理 AI 能力、系统版本与平台级运行参数"
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <OpsSurface variant="panel" padding="sm" className="portal-settings__shortcut">
            <Space align="start" size={12}>
              <span className="portal-settings__shortcut-icon"><CloudDownloadOutlined /></span>
              <span>
                <Typography.Text strong>更新管理</Typography.Text>
                <br />
                <Typography.Text type="secondary">检查版本、升级与回滚运行环境</Typography.Text>
                <br />
                <Link href="/settings/update"><Button type="link" icon={<CloudDownloadOutlined />} style={{ padding: "4px 0" }}>打开更新管理</Button></Link>
              </span>
            </Space>
          </OpsSurface>
        </Col>
        <Col xs={24} md={12}>
          <OpsSurface variant="panel" padding="sm" className="portal-settings__shortcut">
            <Space align="start" size={12}>
              <span className="portal-settings__shortcut-icon"><LineChartOutlined /></span>
              <span>
                <Typography.Text strong>监控与日志</Typography.Text>
                <br />
                <Typography.Text type="secondary">进入集群工作区配置 Prometheus、Grafana、告警和日志</Typography.Text>
                <br />
                <Link href="/clusters"><Button type="link" icon={<LineChartOutlined />} style={{ padding: "4px 0" }}>选择集群</Button></Link>
              </span>
            </Space>
          </OpsSurface>
        </Col>
      </Row>
      <OpsSurface
        variant="panel"
        padding="sm"
        title="AI 助手配置"
      >
        <AiProviderSettings />
      </OpsSurface>
    </main>
  );
}
