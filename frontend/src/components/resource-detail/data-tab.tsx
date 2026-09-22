"use client";

import { Button, Typography, Space, Empty, message } from "antd";
import { CopyOutlined, EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { ResourceDetailResponse } from "@/lib/api/resources";

interface DataTabProps {
  detail: ResourceDetailResponse;
}

export function DataTab({ detail }: DataTabProps) {
  const kind = (detail.descriptor?.resourceKind ?? detail.overview?.kind ?? "").toLowerCase();
  const isSecret = kind.includes("secret");

  // Extract data from runtime or spec
  const runtime = detail.runtime as unknown as Record<string, unknown>;
  const rawSpec = ((detail as unknown as Record<string, unknown>).rawSpec) as Record<string, unknown> | undefined;
  const dataObj = (runtime?.data ?? rawSpec?.data ?? {}) as Record<string, string>;

  const entries = Object.entries(dataObj);

  return (
    <div style={{ padding: "16px 0" }}>
      {entries.length === 0 ? (
        <Empty description={`暂无 ${isSecret ? "Secret" : "ConfigMap"} 数据`} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {entries.map(([key, value]) => (
            <DataRow key={key} entryKey={key} value={String(value)} isSecret={isSecret} />
          ))}
        </Space>
      )}
    </div>
  );
}

function DataRow({
  entryKey,
  value,
  isSecret,
}: {
  entryKey: string;
  value: string;
  isSecret: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败");
    }
  };

  const displayValue = isSecret && !revealed ? "●".repeat(Math.min(value.length, 40)) : value;
  const isLong = value.length > 200;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: "1px solid var(--kn-border, #e8e8e8)",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Typography.Text
          strong
          code
          style={{ fontSize: 13, maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {entryKey}
        </Typography.Text>
        <Space size={4}>
          {isSecret && (
            <Button
              size="small"
              type="text"
              icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? "隐藏" : "显示"}
            </Button>
          )}
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(value)}
          >
            复制
          </Button>
        </Space>
      </div>
      <Typography.Paragraph
        style={{
          margin: 0,
          padding: "8px 10px",
          background: "var(--kn-fill-secondary, #f5f5f5)",
          borderRadius: 4,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.5,
          wordBreak: "break-all",
          maxHeight: expanded ? "none" : isLong ? 80 : "none",
          overflow: "hidden",
          position: "relative" as const,
        }}
      >
        {displayValue}
      </Typography.Paragraph>
      {isLong && !expanded && isSecret && !revealed ? null : isLong && !expanded ? (
        <Button type="link" size="small" onClick={() => setExpanded(true)}>
          展开全部
        </Button>
      ) : null}
    </div>
  );
}
