"use client";

import { useState } from "react";
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { createIdentityGroup, getGrantGroups, getGroupMembers, getUsers, setGroupMember, type GroupMember } from "@/lib/api/users";

export function GroupManager() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const [groupId, setGroupId] = useState<string>();
  const [search, setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userId, setUserId] = useState<string>();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const groups = useQuery({ queryKey: ["grant-groups", accessToken, search], enabled: Boolean(accessToken), queryFn: () => getGrantGroups(search, accessToken!) });
  const members = useQuery({ queryKey: ["group-members", accessToken, groupId, page], enabled: Boolean(accessToken && groupId), queryFn: () => getGroupMembers(groupId!, page, accessToken!) });
  const users = useQuery({ queryKey: ["grant-users", accessToken, userSearch], enabled: Boolean(accessToken && groupId), queryFn: () => getUsers({ keyword: userSearch, pageSize: 100 }, accessToken!) });
  const create = useMutation({ mutationFn: (name: string) => createIdentityGroup(name, accessToken!), onSuccess: async group => {
    await client.invalidateQueries({ queryKey: ["grant-groups"] });
    await client.invalidateQueries({ queryKey: ["authorization-changes"] });
    setGroupId(group.id); setPage(1); setCreating(false); form.resetFields();
  } });
  const change = useMutation({ mutationFn: (input: { groupId: string; userId: string; active: boolean }) => setGroupMember(input.groupId, input.userId, input.active, accessToken!), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ["group-members"] });
    await client.invalidateQueries({ queryKey: ["authorization-changes"] });
    setUserId(undefined);
  } });
  const readOnly = !members.data || members.isError || members.data.group.managedExternally || !members.data.group.active;
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Space wrap>
      <Select aria-label="用户组" placeholder="选择用户组" style={{ width: 260 }} showSearch filterOption={false} value={groupId} onSearch={setSearch} loading={groups.isFetching}
        onChange={id => { setGroupId(id); setPage(1); setUserId(undefined); change.reset(); }} options={groups.data?.items.map(group => ({ value: group.id, label: group.name }))} />
      <Button icon={<PlusOutlined />} disabled={!accessToken} onClick={() => { create.reset(); setCreating(true); }}>新建用户组</Button>
    </Space>
    {(groups.isError || members.isError || users.isError) && <Alert type="error" message="用户组数据加载失败" action={<Button onClick={() => { void groups.refetch(); if (groupId) { void members.refetch(); void users.refetch(); } }}>重试</Button>} />}
    {change.isError && <Alert type="error" message="成员变更失败，请刷新后重试" />}
    {members.data?.group.managedExternally && <Alert type="info" message="此用户组的成员由外部身份源管理" />}
    {groupId && <>
      <Space wrap><Select aria-label="添加用户" placeholder="选择用户" style={{ width: 260 }} showSearch filterOption={false} onSearch={setUserSearch} value={userId} onChange={setUserId} disabled={readOnly || change.isPending} loading={users.isFetching} options={users.data?.items.filter(user => user.isActive).map(user => ({ value: user.id, label: user.username }))} />
        <Button disabled={readOnly || !userId || change.isPending} onClick={() => change.mutate({ groupId, userId: userId!, active: true })}>添加成员</Button></Space>
      <Table<GroupMember> rowKey="id" size="middle" loading={members.isLoading} dataSource={members.isError ? [] : members.data?.items ?? []} scroll={{ x: 700 }} pagination={{ current: page, pageSize: 20, total: members.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[
        { title: "用户", key: "user", render: (_, member) => member.user.name || member.user.email },
        { title: "登录账号", key: "email", render: (_, member) => member.user.email },
        { title: "账号状态", key: "account", render: (_, member) => member.user.isActive ? "启用" : "停用" },
        { title: "成员状态", key: "state", render: (_, member) => <Tag>{member.state !== "active" ? "已移除" : member.expiresAt && Date.parse(member.expiresAt) <= Date.now() ? "已过期" : Date.parse(member.validFrom) > Date.now() ? "待生效" : "有效"}</Tag> },
        { title: "操作", key: "actions", align: "center", render: (_, member) => <Popconfirm title="移除此成员？" description="该用户的现有登录会话将失效。" onConfirm={() => change.mutateAsync({ groupId, userId: member.user.id, active: false })}><Button danger size="small" disabled={readOnly || member.state !== "active" || change.isPending}>移除</Button></Popconfirm> },
      ]} />
    </>}
    <Modal open={creating} title="新建用户组" okText="创建" cancelText="取消" confirmLoading={create.isPending} maskClosable={false} closable={!create.isPending} cancelButtonProps={{ disabled: create.isPending }} onCancel={() => setCreating(false)} onOk={() => { void form.validateFields().then(values => create.mutate(values.name)).catch(() => {}); }}>
      {create.isError && <Alert type="error" message="创建用户组失败" />}
      <Form form={form} layout="vertical" disabled={create.isPending}><Form.Item name="name" label="用户组名称" rules={[{ required: true, whitespace: true, max: 128 }]}><Input maxLength={128} /></Form.Item></Form>
    </Modal>
  </Space>;
}
