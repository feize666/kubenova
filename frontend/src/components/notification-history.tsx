"use client";

import { LeftOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Select, Space } from "antd";
import { useState } from "react";
import { OpsIconActionButton, OpsStatusTag } from "@/components/ops";
import { ResourceTable } from "@/components/resource-table";
import { apiRequest } from "@/lib/api/client";

type Delivery = {
  id: string; alertTitle: string; templateId: string; event: string; status: string;
  attempts: number; createdAt: string; updatedAt: string; error: string | null;
};
const statuses = {
  pending: ["等待投递", "neutral"], sending: ["投递中", "info"],
  sent: ["渠道已接收", "success"], failed: ["投递失败", "danger"],
  expired: ["已过期", "warning"], cancelled: ["已取消", "neutral"],
} as const;

export function NotificationHistory({ clusterId, token }: { clusterId: string; token: string }) {
  const [status, setStatus] = useState<string>();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: ["notification-history", clusterId, token, status, cursor],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ take: "20" });
      if (status) params.set("status", status);
      if (cursor) params.set("cursor", cursor);
      return apiRequest<{ items: Delivery[]; nextCursor: string | null }>(`/api/monitoring/clusters/${encodeURIComponent(clusterId)}/deliveries?${params}`, { token, signal });
    },
    enabled: Boolean(token),
  });
  return <>
    <Space wrap style={{ marginBottom: 12 }}>
      <Select aria-label="投递状态" placeholder="全部状态" allowClear value={status} style={{ width: 160 }}
        options={Object.entries(statuses).map(([value, [label]]) => ({ value, label }))}
        onChange={value => { setStatus(value); setCursors([undefined]); }} />
      <OpsIconActionButton label="刷新投递记录" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()} />
      <OpsIconActionButton label="上一页投递记录" icon={<LeftOutlined />} disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(previous => previous.slice(0, -1))} />
      <OpsIconActionButton label="下一页投递记录" icon={<RightOutlined />} disabled={!query.data?.nextCursor || query.isFetching || query.isError} onClick={() => { if (query.data?.nextCursor) setCursors(previous => [...previous, query.data.nextCursor!]); }} />
    </Space>
    {query.isError ? <Alert type="error" showIcon title="投递记录加载失败" description="请刷新重试" /> :
      <ResourceTable<Delivery> tableKey="notification-delivery-history" rowKey="id" showToolbar={false} viewportScroll={false} size="small" loading={query.isLoading} dataSource={query.data?.items ?? []} pagination={false} emptyDescription="暂无投递记录"
        columns={[
          { title: "告警", dataIndex: "alertTitle", ellipsis: true },
          { title: "渠道 ID", dataIndex: "templateId", ellipsis: true },
          { title: "事件", dataIndex: "event", width: 90, render: value => value === "resolved" ? "恢复" : "告警" },
          { title: "状态", dataIndex: "status", width: 130, render: (value: string) => { const item = statuses[value as keyof typeof statuses]; return <OpsStatusTag tone={item?.[1] ?? "neutral"}>{item?.[0] ?? value}</OpsStatusTag>; } },
          { title: "尝试次数", dataIndex: "attempts", width: 90 },
          { title: "创建时间", dataIndex: "createdAt", width: 180, render: value => new Date(value).toLocaleString() },
          { title: "结果说明", dataIndex: "error", ellipsis: true, render: value => value || "-" },
        ]} />}
  </>;
}
