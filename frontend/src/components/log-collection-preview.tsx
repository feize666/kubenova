"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CodeOutlined } from "@ant-design/icons";
import { Alert, Input, InputNumber, Modal, Tabs, Typography } from "antd";
import { OpsIconActionButton, OpsState } from "@/components/ops";
import { apiRequest } from "@/lib/api/client";

interface Preview {
  image: string;
  config: Record<string, unknown>;
  manifests: Record<string, unknown>;
  indexTemplate: Record<string, unknown>;
  lifecyclePolicy: Record<string, unknown>;
  logQuery: Record<string, unknown>;
}

function PreviewContent({ clusterId, sourceId, token }: { clusterId: string; sourceId: string; token: string }) {
  const [days, setDays] = useState<number | null>(14);
  const [activeTab, setActiveTab] = useState("config");
  const [caSecretName, setCaSecretName] = useState("");
  const valid = days !== null && Number.isInteger(days) && days >= 1 && days <= 365;
  const query = useQuery({
    queryKey: ["log-collection-preview", clusterId, sourceId, token, days, caSecretName],
    queryFn: ({ signal }) => apiRequest<Preview>("/api/log-center/collection/preview", {
      method: "POST", token, signal, body: { clusterId, dataSourceId: sourceId, retentionDays: days, ...(caSecretName ? { caSecretName } : {}) },
    }),
    enabled: valid, retry: false, gcTime: 0, refetchOnWindowFocus: false,
  });
  return <>
    <Alert type="warning" showIcon message="仅预览，尚未安装采集器或应用索引策略" description="应用保留策略会删除超过保留期的日志。实际采集、权限隔离和恢复验收尚未完成。" />
    <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
      保留天数
      <InputNumber aria-label="日志保留天数" value={days} min={1} max={365} precision={0} onChange={setDays} />
    </label>
    <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 12 }}>
      CA Secret（可选）
      <Input aria-label="CA Secret 名称" placeholder="使用系统信任库" maxLength={253}
        style={{ width: 240, maxWidth: "100%" }} onBlur={event => setCaSecretName(event.target.value.trim())} />
    </label>
    {!valid ? <OpsState kind="error" title="保留天数须为 1 至 365 的整数" />
      : query.isPending ? <OpsState kind="loading" title="正在生成采集预览" />
      : query.isError ? <OpsState kind="error" title="无法生成采集预览" description="请确认管理员权限、HTTPS 数据源和 CA Secret 名称格式。" action={<OpsIconActionButton onClick={() => void query.refetch()}>重试</OpsIconActionButton>} />
      : query.data ? <>
        <Typography.Paragraph style={{ marginTop: 16 }} type="secondary">{query.data.image}</Typography.Paragraph>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={([
          ["config", "采集配置"], ["manifests", "部署清单"], ["indexTemplate", "索引映射"],
          ["lifecyclePolicy", "保留策略"], ["logQuery", "查询字段"],
        ] as const).map(([key, label]) => ({ key, label, children:
          <div>
          {key === "manifests" ? <Alert style={{ marginBottom: 12 }} type="info" showIcon
            message="部署前置条件"
            description="需预先创建 kubenova-system 命名空间和 kubenova-log-writer Secret（api-key），并配置索引映射及保留策略。自定义 CA Secret 须位于同一命名空间，证书键为 ca.crt。仅支持 Linux CRI 日志路径；须审核 hostPath 和 root 用户准入权限。" /> : null}
          <Typography.Paragraph copyable={{ text: JSON.stringify(query.data![key], null, 2) }}>
            <pre style={{ maxHeight: "45vh", overflow: "auto", fontSize: 12 }}>{JSON.stringify(query.data![key], null, 2)}</pre>
          </Typography.Paragraph>
          </div>,
        }))} />
      </> : null}
  </>;
}

export function LogCollectionPreview(props: { clusterId: string; sourceId: string; token: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <OpsIconActionButton icon={<CodeOutlined />} onClick={() => setOpen(true)}>采集预览</OpsIconActionButton>
    <Modal title="日志采集预览" open={open} onCancel={() => setOpen(false)} footer={null} width={840} destroyOnHidden>
      {open ? <PreviewContent key={`${props.clusterId}:${props.sourceId}:${props.token}`} {...props} /> : null}
    </Modal>
  </>;
}
