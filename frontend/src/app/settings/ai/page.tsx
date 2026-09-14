"use client";

import { RobotOutlined } from "@ant-design/icons";
import { OpsSurface } from "@/components/ops";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { ResourcePageHeader } from "@/components/resource-page-header";

export default function SettingsAiPage() {
  return (
    <main className="portal-settings">
      <OpsSurface variant="panel" padding="sm">
        <ResourcePageHeader
          title={<span><RobotOutlined style={{ marginRight: 8 }} />AI 助手配置</span>}
          path="/settings/ai"
          embedded
          description="管理 AI Provider 连接与模型能力"
        />
      </OpsSurface>
      <OpsSurface variant="panel" padding="sm" title="Provider 配置">
        <AiProviderSettings />
      </OpsSurface>
    </main>
  );
}
