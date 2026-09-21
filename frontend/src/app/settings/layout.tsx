"use client";

import { CloudDownloadOutlined, DatabaseOutlined, RobotOutlined } from "@ant-design/icons";
import { Menu, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SETTINGS_ITEMS = [
  { key: "/settings/update", label: "更新管理", icon: <CloudDownloadOutlined /> },
  { key: "/settings/ai", label: "AI 助手配置", icon: <RobotOutlined /> },
  { key: "/settings/backup", label: "备份与恢复", icon: <DatabaseOutlined /> },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const selectedKeys = SETTINGS_ITEMS.filter(
    (item) => pathname === item.key || pathname.startsWith(`${item.key}/`),
  ).map((item) => item.key);
  const items: MenuProps["items"] = SETTINGS_ITEMS.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: <Link href={item.key} prefetch={false}>{item.label}</Link>,
  }));

  return (
    <div className="settings-shell" style={{ display: "grid", gridTemplateColumns: "minmax(190px, 240px) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
      <aside aria-label="系统设置导航" style={{ borderRight: "1px solid var(--kn-border)", paddingRight: 16 }}>
        <Space orientation="vertical" size={4} style={{ width: "100%" }}>
          <Typography.Title level={4} style={{ margin: 0 }}>系统设置</Typography.Title>
          <Typography.Text type="secondary">平台管理入口</Typography.Text>
          <Menu
            mode="inline"
            selectedKeys={selectedKeys}
            items={items}
            style={{ marginTop: 12, borderInlineEnd: 0, background: "transparent" }}
          />
        </Space>
      </aside>
      <section className="settings-shell__content">{children}</section>
    </div>
  );
}
