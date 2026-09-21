"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Space, Table, Tooltip, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useAuth } from "@/components/auth-context";
import { getAuthorizationChanges, type AuthorizationChange } from "@/lib/api/users";

const reasons: Record<string, string> = { "grant-created": "创建授权", "grant-revoked": "撤销授权" };

export function AuthorizationAudit() {
  const { accessToken } = useAuth();
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["authorization-changes", accessToken, page], enabled: Boolean(accessToken), queryFn: () => getAuthorizationChanges(page, accessToken!) });
  const identifier = (value: string | null) => value ? <Typography.Text copyable>{value}</Typography.Text> : "—";
  return <Space direction="vertical" style={{ width: "100%", minWidth: 0 }}>
    <Tooltip title="刷新审计记录"><Button aria-label="刷新审计记录" icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()} /></Tooltip>
    {query.isError && <Alert type="error" showIcon message="审计记录加载失败" action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    <Table<AuthorizationChange> rowKey="id" size="middle" loading={query.isLoading} dataSource={query.isError ? [] : query.data?.items ?? []}
      scroll={{ x: 1000 }} locale={{ emptyText: query.isError ? "暂时无法读取审计记录" : "暂无授权变更记录" }}
      pagination={{ current: page, pageSize: 20, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
      columns={[
        { title: "变更时间", dataIndex: "committedAt", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "操作", dataIndex: "reason", width: 120, render: (value: string) => reasons[value] ?? value },
        { title: "操作人 ID", dataIndex: "actorUserId", width: 240, render: identifier },
        { title: "授权 ID", dataIndex: "grantId", width: 240, render: identifier },
        { title: "关联用户 ID", dataIndex: "affectedUserId", width: 240, render: identifier },
        { title: "版本", dataIndex: "version", width: 80 },
      ]} />
  </Space>;
}
