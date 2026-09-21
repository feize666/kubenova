"use client";

import { CopyOutlined, KeyOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Input, Popconfirm, Space, message } from "antd";
import { useEffect, useState } from "react";
import { OpsIconActionButton, OpsModalShell, OpsStatusTag } from "@/components/ops";
import { apiRequest } from "@/lib/api/client";

export function AlertReceiverConfiguration({ clusterId, token }: { clusterId: string; token: string }) {
  const [origin, setOrigin] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, context] = message.useMessage();
  const route = `/api/monitoring/clusters/${encodeURIComponent(clusterId)}/receiver`;
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const query = useQuery({
    queryKey: ["alert-receiver-status", clusterId, token],
    queryFn: ({ signal }) => apiRequest<{ configured: boolean; enabled: boolean; updatedAt: string | null }>(route, { token, signal }),
    enabled: Boolean(token),
  });
  async function mutate(rotate: boolean) {
    setPending(true); setSecret(null); setError(null);
    try {
      // Never put the one-time credential in query/mutation caches or storage.
      if (rotate) {
        const result = await apiRequest<{ token: string }>(`${route}/rotate`, { method: "POST", token });
        setSecret(result.token);
      } else await apiRequest(route, { method: "DELETE", token });
      await query.refetch();
    } catch {
      setError("操作未确认成功，请刷新状态后重试；轮换请求失败时原令牌可能已失效。");
    } finally { setPending(false); }
  }
  return <>
    {context}
    {query.isError ? <Alert type="error" showIcon title="接收配置加载失败" /> : null}
    {error ? <Alert type="error" showIcon title={error} /> : null}
    <Descriptions column={1} size="small" style={{ marginBottom: 16 }} items={[
      { key: "status", label: "接收状态", children: <OpsStatusTag tone={query.data?.enabled ? "success" : "neutral"}>{query.isLoading ? "加载中" : query.isError ? "未知" : query.data?.enabled ? "已启用" : query.data?.configured ? "已停用" : "未配置"}</OpsStatusTag> },
      { key: "url", label: "接收地址", children: <Input aria-label="告警接收地址" value={`${origin}${route}/alerts`} readOnly /> },
      { key: "updated", label: "更新时间", children: query.data?.updatedAt ? new Date(query.data.updatedAt).toLocaleString() : "-" },
    ]} />
    <Space wrap>
      <Popconfirm title="生成新的接收令牌？" description="旧令牌将立即失效，需要同步更新 Alertmanager 凭据。" onConfirm={() => mutate(true)} okText="确认生成" cancelText="取消">
        <Button type="primary" icon={<KeyOutlined />} loading={pending} disabled={query.isLoading || query.isError}>{query.data?.configured ? "轮换令牌" : "生成令牌"}</Button>
      </Popconfirm>
      <Popconfirm title="停用告警接收？" description="停用后该集群的新告警将无法接入。" onConfirm={() => mutate(false)} okText="确认停用" cancelText="取消">
        <Button danger icon={<StopOutlined />} disabled={!query.data?.enabled || pending}>停用接收</Button>
      </Popconfirm>
      <OpsIconActionButton title="刷新接收状态" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()} />
    </Space>
    <OpsModalShell title="新的接收令牌" destroyOnHidden open={secret !== null} onCancel={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>关闭</Button>}>
      <Alert type="warning" showIcon title="令牌仅展示一次，关闭后无法再次查看。" style={{ marginBottom: 12 }} />
      <Input.Password aria-label="新接收令牌" value={secret ?? ""} readOnly autoComplete="off" />
      <OpsIconActionButton title="复制接收令牌" icon={<CopyOutlined />} onClick={async () => {
        try { if (secret) { await navigator.clipboard.writeText(secret); messages.success("已复制"); } }
        catch { messages.error("复制失败"); }
      }} />
    </OpsModalShell>
  </>;
}
