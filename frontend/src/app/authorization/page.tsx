"use client";
import { useState } from "react";
import { CreateGrant } from "./create-grant";
import { AuthorizationAudit } from "./audit-list";
import { GroupManager } from "./group-manager";
import { NativeAccessSettingsPanel } from "./native-access-settings";
import UsersPage from "@/app/users/page";
import { useAuth } from "@/components/auth-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { getAccessGrants, revokeAccessGrant, type AccessGrantListResponse } from "@/lib/api/users";

type Grant = AccessGrantListResponse["items"][number];
const roleNames: Record<string, string> = { "cluster-admin": "集群管理员", operator: "运维人员", viewer: "只读用户" };
const capabilityNames: Record<string, string> = { logs: "日志读取", exec: "终端执行", secrets: "Secret 访问", kubeconfig: "Kubeconfig" };
const formatDate = (value: string) => new Date(value).toLocaleString("zh-CN");

function GrantList() {
  const [creating, setCreating] = useState(false);
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const grants = useQuery({
    queryKey: ["access-grants", accessToken],
    queryFn: () => getAccessGrants(undefined, accessToken!),
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAccessGrant(id, accessToken!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["access-grants"] });
      await client.invalidateQueries({ queryKey: ["authorization-changes"] });
    },
  });
  const status = (grant: Grant) => {
    if (grant.state === "revoked") return <Tag>已撤销</Tag>;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return <Tag>已过期</Tag>;
    if (Date.parse(grant.validFrom) > Date.now()) return <Tag color="blue">待生效</Tag>;
    if (grant.state !== "active") return <Tag>{grant.state}</Tag>;
    return <Tag color="green">有效</Tag>;
  };
  return <Space direction="vertical" size="middle" style={{ width: "100%", minWidth: 0 }}>
    <Space><Button type="primary" icon={<PlusOutlined />} disabled={!accessToken} onClick={() => setCreating(true)}>新建授权</Button><Tooltip title="刷新授权列表"><Button aria-label="刷新授权列表" icon={<ReloadOutlined />} loading={grants.isFetching} onClick={() => void grants.refetch()} /></Tooltip></Space>
    {creating && accessToken && <CreateGrant token={accessToken} onClose={() => setCreating(false)} />}
    {grants.isError && <Alert type="error" showIcon message="授权列表加载失败" action={<Button onClick={() => void grants.refetch()}>重试</Button>} />}
    {revoke.isError && <Alert type="error" showIcon message="撤销失败，授权状态未确认，请刷新后重试" />}
    {revoke.isSuccess && <Alert type="success" showIcon message="授权已撤销" />}
    <Table<Grant> rowKey="id" size="middle" loading={grants.isLoading} dataSource={grants.isError ? [] : grants.data?.items ?? []}
      scroll={{ x: 1100 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: grants.isError ? "暂时无法读取授权" : "暂无集群访问授权" }}
      columns={[
        { title: "授权主体", key: "principal", width: 180, render: (_, grant) => <><Typography.Text>{grant.principal?.username ?? grant.principal?.name ?? "未知主体"}</Typography.Text><br /><Typography.Text type="secondary">{grant.principal?.type === "group" ? "用户组" : "用户"}</Typography.Text></> },
        { title: "集群", key: "cluster", width: 160, render: (_, grant) => grant.cluster.name },
        { title: "角色", dataIndex: "role", width: 130, render: (role: string) => roleNames[role] ?? role },
        { title: "命名空间", key: "namespaces", width: 190, render: (_, grant) => grant.namespaces.length ? <Space size={[0, 4]} wrap>{grant.namespaces.map(ns => <Tag key={ns.uid}>{ns.name}</Tag>)}</Space> : <Typography.Text type="warning">未授权任何命名空间</Typography.Text> },
        { title: "能力权限", key: "capabilities", width: 180, render: (_, grant) => grant.capabilities.length ? <Space size={[0, 4]} wrap>{grant.capabilities.map(cap => <Tag key={cap}>{capabilityNames[cap] ?? cap}</Tag>)}</Space> : "无附加能力" },
        { title: "状态", key: "state", width: 100, render: (_, grant) => status(grant) },
        { title: "有效期", key: "validity", width: 200, render: (_, grant) => <>{formatDate(grant.validFrom)}<br /><Typography.Text type="secondary">至 {grant.expiresAt ? formatDate(grant.expiresAt) : "长期有效"}</Typography.Text></> },
        { title: "操作", key: "actions", width: 100, align: "center", render: (_, grant) => <Popconfirm title="撤销此授权？" description="关联用户的现有登录会话将失效。" okText="撤销" cancelText="取消" onConfirm={() => revoke.mutateAsync(grant.id)} disabled={grant.state === "revoked" || revoke.isPending}>
          <Button danger size="small" disabled={grant.state === "revoked" || revoke.isPending} loading={revoke.isPending && revoke.variables === grant.id}>撤销</Button>
        </Popconfirm> },
      ]} />
  </Space>;
}

export default function AuthorizationPage() {
  return <Tabs defaultActiveKey="users" destroyOnHidden items={[
    { key: "users", label: "用户管理", children: <UsersPage /> },
    { key: "grants", label: "集群访问授权", children: <GrantList /> },
    { key: "groups", label: "用户组", children: <GroupManager /> },
    { key: "kubectl", label: "kubectl 访问", children: <NativeAccessSettingsPanel /> },
    { key: "audit", label: "授权审计", children: <AuthorizationAudit /> },
  ]} />;
}
