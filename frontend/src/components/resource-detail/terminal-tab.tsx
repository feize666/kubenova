"use client";

import { Button, Select, Space, Typography, Empty } from "antd";
import { CodeOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import type { ResourceDetailResponse } from "@/lib/api/resources";

interface TerminalTabProps {
  detail: ResourceDetailResponse;
}

export function TerminalTab({ detail }: TerminalTabProps) {
  const router = useRouter();
  const [selectedContainer, setSelectedContainer] = useState<string | undefined>();

  const clusterId = String(detail.overview?.clusterId ?? "");
  const namespace = String(detail.overview?.namespace ?? "default");
  const podName = String(detail.overview?.name ?? "");

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

  const effectiveContainer =
    selectedContainer ?? (containers.length > 0 ? containers[0] : undefined);

  const handleOpenTerminal = () => {
    const params = new URLSearchParams();
    params.set("pod", podName);
    params.set("namespace", namespace);
    if (effectiveContainer) params.set("container", effectiveContainer);
    router.push(
      `/clusters/${encodeURIComponent(clusterId)}/terminal?${params.toString()}`,
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
          icon={<CodeOutlined />}
          size="small"
          type="primary"
          onClick={handleOpenTerminal}
          disabled={!podName}
        >
          打开终端
        </Button>
      </Space>

      <div
        style={{
          border: "1px dashed var(--kn-border)",
          borderRadius: 8,
          padding: 40,
          textAlign: "center",
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              终端需在新窗口打开
              <br />
              <Typography.Text type="secondary">
                Pod: {podName || "-"} · Namespace: {namespace}
                {effectiveContainer ? ` · Container: ${effectiveContainer}` : ""}
              </Typography.Text>
            </span>
          }
        />
      </div>
    </div>
  );
}
