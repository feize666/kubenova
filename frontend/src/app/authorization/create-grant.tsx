"use client";

import { useState } from "react";
import { Alert, Checkbox, Form, Input, Modal, Select, Segmented } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAccessGrant, getUsers, getGrantGroups, type CreateAccessGrantPayload } from "@/lib/api/users";
import { getClusters } from "@/lib/api/clusters";
import { getNamespaces } from "@/lib/api/namespaces";

export function CreateGrant({ token, onClose }: { token: string; onClose: () => void }) {
  const [form] = Form.useForm<CreateAccessGrantPayload>();
  const [principalType, setPrincipalType] = useState("user");
  const [groupSearch, setGroupSearch] = useState("");
  const groups = useQuery({ queryKey: ["grant-groups", token, groupSearch], enabled: principalType === "group", queryFn: () => getGrantGroups(groupSearch, token) });
  const clusterId = Form.useWatch("clusterId", form);
  const [userSearch, setUserSearch] = useState("");
  const [clusterSearch, setClusterSearch] = useState("");
  const [namespaceSearch, setNamespaceSearch] = useState("");
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["grant-users", token, userSearch], queryFn: () => getUsers({ keyword: userSearch, pageSize: 100 }, token) });
  const clusters = useQuery({ queryKey: ["grant-clusters", token, clusterSearch], queryFn: () => getClusters({ keyword: clusterSearch, pageSize: 100 }, token) });
  const namespaces = useQuery({ queryKey: ["grant-namespaces", token, clusterId, namespaceSearch], enabled: Boolean(clusterId), queryFn: () => getNamespaces({ clusterId, keyword: namespaceSearch, pageSize: 100 }, token) });
  const create = useMutation({
    mutationFn: (body: CreateAccessGrantPayload) => createAccessGrant(body, token),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["access-grants"] });
      await client.invalidateQueries({ queryKey: ["authorization-changes"] });
      onClose();
    },
  });
  const submit = async () => {
    try {
      const values = await form.validateFields();
      create.mutate({ ...values, userId: principalType === "user" ? values.userId : undefined, groupId: principalType === "group" ? values.groupId : undefined, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined });
    } catch {
      // Ant Design renders validation failures beside their fields.
    }
  };
  return <Modal open title="新建集群授权" okText="创建授权" cancelText="取消" confirmLoading={create.isPending}
    closable={!create.isPending} maskClosable={false} cancelButtonProps={{ disabled: create.isPending }} onCancel={onClose} onOk={() => void submit()}>
    {create.isError && <Alert type="error" showIcon message="创建失败，请检查授权范围、集群连接和账号状态后重试" />}
    {(users.isError || groups.isError || clusters.isError || namespaces.isError) && <Alert type="error" showIcon message="选项加载失败" />}
    <Form form={form} layout="vertical" initialValues={{ role: "viewer", capabilities: [], namespaces: [] }} disabled={create.isPending}>
      <Form.Item label="授权主体"><Segmented value={principalType} options={[{ value: "user", label: "用户" }, { value: "group", label: "用户组" }]} onChange={value => { setPrincipalType(value); form.setFieldsValue({ userId: undefined, groupId: undefined }); }} /></Form.Item>
      {principalType === "user" ? <Form.Item key="user" name="userId" label="用户" preserve={false} rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setUserSearch} loading={users.isFetching} options={users.data?.items.filter(user => user.isActive).map(user => ({ value: user.id, label: user.username }))} />
      </Form.Item> : <Form.Item key="group" name="groupId" label="用户组" preserve={false} rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setGroupSearch} loading={groups.isFetching} options={groups.data?.items.map(group => ({ value: group.id, label: group.name }))} />
      </Form.Item>}
      <Form.Item name="clusterId" label="集群" rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setClusterSearch} loading={clusters.isFetching} onChange={() => { form.setFieldValue("namespaces", []); setNamespaceSearch(""); }} options={clusters.data?.items.map(cluster => ({ value: cluster.id, label: cluster.name }))} />
      </Form.Item>
      <Form.Item name="namespaces" label="命名空间" rules={[{ required: true, type: "array", min: 1, max: 100 }]}>
        <Select mode="multiple" showSearch filterOption={false} onSearch={setNamespaceSearch} disabled={!clusterId} loading={namespaces.isFetching} options={namespaces.data?.items.map(ns => ({ value: ns.namespace, label: ns.namespace }))} />
      </Form.Item>
      <Form.Item name="role" label="角色" rules={[{ required: true }]}>
        <Select options={[{ value: "viewer", label: "只读用户" }, { value: "operator", label: "运维人员" }, { value: "cluster-admin", label: "集群管理员" }]} />
      </Form.Item>
      <Form.Item name="capabilities" label="附加能力">
        <Checkbox.Group options={[{ value: "logs", label: "日志读取" }, { value: "exec", label: "终端执行" }, { value: "secrets", label: "Secret 访问" }, { value: "kubeconfig", label: "Kubeconfig" }]} />
      </Form.Item>
      <Form.Item name="expiresAt" label="到期时间（可选）" rules={[{ validator: async (_, value) => { if (value && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) throw new Error("请选择未来时间"); } }]}>
        <Input type="datetime-local" />
      </Form.Item>
    </Form>
  </Modal>;
}
