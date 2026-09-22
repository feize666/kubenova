"use client";

import { Button, Typography, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import type { ResourceDetailResponse } from "@/lib/api/resources";
import { getResourceYaml } from "@/lib/api/resources";

interface YamlTabProps {
  detail: ResourceDetailResponse;
  token?: string;
}

async function fetchYaml(
  identity: { clusterId: string; namespace: string; kind: string; name: string },
  token?: string,
): Promise<string> {
  try {
    const data = await getResourceYaml(identity, token);
    if (data && typeof data === "object" && "yaml" in data) {
      return String((data as any).yaml ?? "");
    }
    return "";
  } catch {
    return "";
  }
}

export function YamlTab({ detail, token }: YamlTabProps) {
  const [yaml, setYaml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const kind = detail.descriptor?.resourceKind ?? detail.overview?.kind ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchYaml(
      {
        clusterId: String(detail.overview?.clusterId ?? ""),
        namespace: String(detail.overview?.namespace ?? ""),
        kind,
        name: String(detail.overview?.name ?? ""),
      },
      token,
    )
      .then((y) => {
        if (!cancelled) {
          setYaml(y || "# 暂无 YAML 数据");
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err?.message ?? "加载失败"));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kind, detail.overview?.name, token]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      message.success("已复制 YAML");
    } catch {
      message.error("复制失败");
    }
  };

  return (
    <div style={{ padding: "16px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 8,
        }}
      >
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          disabled={!yaml || loading}
        >
          复制
        </Button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Typography.Text type="secondary">加载中...</Typography.Text>
        </div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Typography.Text type="danger">{error}</Typography.Text>
        </div>
      ) : (
        <pre
          style={{
            background: "var(--kn-bg-code, #1e1e1e)",
            color: "var(--kn-text-code, #d4d4d4)",
            borderRadius: 8,
            padding: 16,
            fontSize: 12,
            lineHeight: 1.6,
            overflow: "auto",
            maxHeight: "calc(100vh - 280px)",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {yaml}
        </pre>
      )}
    </div>
  );
}
