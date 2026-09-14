"use client";

import { Alert, Empty, Skeleton, Typography } from "antd";
import { OpsStatusTag, OpsSurface } from "@/components/ops";
import type { GrafanaPanelConfiguration } from "@/lib/api/observability-config";

export interface GrafanaPanelProps {
  configuration?: GrafanaPanelConfiguration;
  loading?: boolean;
  error?: unknown;
}

/** Renders only the server-produced embed URL; provider credentials never enter this component. */
export function GrafanaPanel({ configuration, loading = false, error }: GrafanaPanelProps) {
  return (
    <OpsSurface
      className="ops-observability-panel ops-observability-panel--grafana"
      variant="panel"
      padding="sm"
      title="Grafana 面板"
      actions={configuration ? <OpsStatusTag tone={configuration.available ? "success" : "warning"}>{configuration.available ? "可用" : "不可用"}</OpsStatusTag> : null}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : error ? (
        <Alert
          type="warning"
          showIcon
          title="Grafana 面板加载失败"
          description={error instanceof Error ? error.message : "Grafana 面板暂时不可用。"}
        />
      ) : configuration?.available && configuration.embedUrl ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Typography.Text type="secondary">
            Dashboard {configuration.dashboardUid} · Panel {configuration.panelId} · {configuration.defaultTimeRange}
          </Typography.Text>
          <iframe
            title="Grafana 集群监控面板"
            src={configuration.embedUrl}
            loading="lazy"
            allow="fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ width: "100%", minHeight: 420, border: "1px solid var(--kn-border)", borderRadius: 4, background: "var(--ops-surface-raised)" }}
          />
        </div>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            title="Grafana 面板不可用"
            description={configuration?.reason ?? "尚未配置 Grafana 面板。"}
          />
          {!configuration ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Grafana 面板配置" /> : null}
        </>
      )}
    </OpsSurface>
  );
}

