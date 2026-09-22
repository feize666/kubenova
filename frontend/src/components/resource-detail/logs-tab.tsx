"use client";

import { Button, Select, Space, Typography, Empty, Spin } from "antd";
import { ExportOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import type { ResourceDetailResponse } from "@/lib/api/resources";

interface LogsTabProps {
  detail: ResourceDetailResponse;
}

/**
 * Logs tab for Pod detail.
 * Shows a preview area with a "Open Fullscreen" button.
 */
export function LogsTab({ detail }: LogsTabProps) {
  const router = useRouter();
  const [selectedContainer, setSelectedContainer] = useState<string | undefined>();

  const clusterId = String(detail.overview?.clusterId ?? "");
  const namespace = String(detail.overview?.namespace ?? "default");
  const podName = String(detail.overview?.name ?? "");

  // Extract container names from runtime
  const containers = useMemo(() => {
    const runtime = detail.runtime as unknown as Record<string, unknown>;
    const containers = runtime?.containers as Array<Record<string, unknown>> | undefined;
    if (containers && containers.length > 0) {
      return containers.map((c: Record<string, unknown>) =>
        String(c.name ?? c.containerName ?? "-"),
      );
    }
    const images = Array.isArray(runtime?.images) ? (runtime.images as string[]) : [];
    return images.map((_, i) => `container-${i}`);
  }, [detail]);

  // Default to first container
  const effectiveContainer =
    selectedContainer ?? (containers.length > 0 ? containers[0] : undefined);

  const handleOpenFullscreen = () => {
    const params = new URLSearchParams();
    params.set("pod", podName);
    params.set("namespace", namespace);
    if (effectiveContainer) params.set("container", effectiveContainer);
    router.push(
      `/clusters/${encodeURIComponent(clusterId)}/logs?${params.toString()}`,
    );
  };

  return (
    <div style={{ padding: "16px 0" }}>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Space size={8}>
          <Typography.Text type="secondary">容器：</Typography.Text>
          {containers.length > 1 ? (
            <Select
              size="small"
              value={effectiveContainer}
              onChange={setSelectedContainer}
              style={{ minWidth: 160 }}
              options={containers.map((c) => ({ value: c, label: c }))}
            />
          ) : (
            <Typography.Text>{effectiveContainer ?? "-"}</Typography.Text>
          )}
        </Space>
        <Button
          icon={<ExportOutlined />}
          size="small"
          onClick={handleOpenFullscreen}
          disabled={!podName}
        >
          全屏日志
        </Button>
      </Space>

      {/* Log preview area — placeholder until real log API is wired */}
      <div
        style={{
          background: "var(--kn-bg-code, #1e1e1e)",
          color: "var(--kn-text-code, #d4d4d4)",
          borderRadius: 8,
          padding: 16,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.6,
          maxHeight: 400,
          overflow: "auto",
        }}
      >
        {!podName ? (
          <Empty description="无法获取 Pod 信息" />
        ) : (
          <div>
            <div style={{ color: "var(--kn-text-dim, #888)", marginBottom: 8 }}>
              # Pod: {podName} · Namespace: {namespace}
              {effectiveContainer ? ` · Container: ${effectiveContainer}` : ""}
            </div>
            <div style={{ color: "var(--kn-text-dim, #666)" }}>
              点击「全屏日志」打开完整日志视图...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
