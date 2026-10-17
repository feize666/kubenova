"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Alert, Checkbox, Form, Input, Modal, Select, Segmented } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useResourceListQuery } from "@/hooks/use-resource-list-query";
import { createAccessGrant, getUsers, getGrantGroups, type CreateAccessGrantPayload } from "@/lib/api/users";
import { getClusters } from "@/lib/api/clusters";
import { getNamespaces } from "@/lib/api/namespaces";

export function CreateGrant({ token, onClose }: { token: string; onClose: () => void }) {
  const [form] = Form.useForm<CreateAccessGrantPayload>();
  const [principalType, setPrincipalType] = useState("user");
  const [groupSearch, setGroupSearch] = useState("");
  const groups = useResourceListQuery({ queryKey: ["grant-groups", token, groupSearch], retry: false, enabled: principalType === "group", queryFn: () => getGrantGroups(groupSearch, token) });
  const clusterId = Form.useWatch("clusterId", form);
  const [userSearch, setUserSearch] = useState("");
  const [clusterSearch, setClusterSearch] = useState("");
  const [namespaceSearch, setNamespaceSearch] = useState("");
  const [selectionScope, setSelectionScope] = useState({ principal: token, cluster: token, namespaces: token, namespaceCluster: "" });
  const client = useQueryClient();
  const users = useResourceListQuery({ queryKey: ["grant-users", token, userSearch], retry: false, queryFn: () => getUsers({ keyword: userSearch, pageSize: 100 }, token) });
  const clusters = useResourceListQuery({ queryKey: ["grant-clusters", token, clusterSearch], retry: false, queryFn: () => getClusters({ keyword: clusterSearch, pageSize: 100 }, token) });
  const namespaces = useResourceListQuery({ queryKey: ["grant-namespaces", token, clusterId, namespaceSearch], retry: false, enabled: Boolean(clusterId), queryFn: () => getNamespaces({ clusterId, keyword: namespaceSearch, pageSize: 100 }, token) });
  const candidatesAvailable = Boolean((principalType === "user" ? users.data : groups.data) && clusters.data && namespaces.data &&
    selectionScope.principal === token && selectionScope.cluster === token && selectionScope.namespaces === token && selectionScope.namespaceCluster === clusterId);
  const submissionState = useRef({ available: candidatesAvailable, token, principalType, selectionScope });
  useLayoutEffect(() => {
    submissionState.current = { available: candidatesAvailable, token, principalType, selectionScope };
  }, [candidatesAvailable, token, principalType, selectionScope]);
  const create = useMutation({
    mutationFn: (body: CreateAccessGrantPayload) => createAccessGrant(body, token),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["access-grants"] });
      await client.invalidateQueries({ queryKey: ["authorization-changes"] });
      onClose();
    },
  });
  const submit = async () => {
    const started = submissionState.current;
    try {
      const values = await form.validateFields();
      // Validation is asynchronous; use the latest access state before submitting.
      const latest = submissionState.current;
      if (!latest.available || latest.token !== started.token || latest.principalType !== started.principalType || latest.selectionScope !== started.selectionScope) return;
      create.mutate({ ...values, userId: principalType === "user" ? values.userId : undefined, groupId: principalType === "group" ? values.groupId : undefined, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined });
    } catch {
      // Ant Design renders validation failures beside their fields.
    }
  };
  return <Modal open title="新建集群授权" okText="创建授权" cancelText="取消" confirmLoading={create.isPending}
    closable={!create.isPending} maskClosable={false} okButtonProps={{ disabled: !candidatesAvailable }} cancelButtonProps={{ disabled: create.isPending }} onCancel={onClose} onOk={() => void submit()}>
    {create.isError && <Alert type="error" showIcon message="创建失败，请检查授权范围、集群连接和账号状态后重试" />}
    {(users.isError || groups.isError || clusters.isError || namespaces.isError) && <Alert type="error" showIcon message="选项加载失败" />}
    <Form form={form} layout="vertical" initialValues={{ role: "viewer", capabilities: [], namespaces: [] }} disabled={create.isPending}>
      <Form.Item label="授权主体"><Segmented value={principalType} options={[{ value: "user", label: "用户" }, { value: "group", label: "用户组" }]} onChange={value => { setPrincipalType(value); form.setFieldsValue({ userId: undefined, groupId: undefined }); }} /></Form.Item>
      {principalType === "user" ? <Form.Item key="user" name="userId" label="用户" preserve={false} rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setUserSearch} onChange={() => setSelectionScope(scope => ({ ...scope, principal: token }))} loading={users.isFetching} options={users.data?.items.filter(user => user.isActive).map(user => ({ value: user.id, label: user.username }))} />
      </Form.Item> : <Form.Item key="group" name="groupId" label="用户组" preserve={false} rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setGroupSearch} onChange={() => setSelectionScope(scope => ({ ...scope, principal: token }))} loading={groups.isFetching} options={groups.data?.items.map(group => ({ value: group.id, label: group.name }))} />
      </Form.Item>}
      <Form.Item name="clusterId" label="集群" rules={[{ required: true }]}>
        <Select showSearch filterOption={false} onSearch={setClusterSearch} loading={clusters.isFetching} onChange={() => { form.setFieldValue("namespaces", []); setNamespaceSearch(""); setSelectionScope(scope => ({ ...scope, cluster: token, namespaceCluster: "" })); }} options={clusters.data?.items.map(cluster => ({ value: cluster.id, label: cluster.name }))} />
      </Form.Item>
      <Form.Item name="namespaces" label="命名空间" rules={[{ required: true, type: "array", min: 1, max: 100 }]}>
        <Select mode="multiple" showSearch filterOption={false} onSearch={setNamespaceSearch} onChange={() => setSelectionScope(scope => ({ ...scope, namespaces: token, namespaceCluster: clusterId }))} disabled={!clusterId} loading={namespaces.isFetching} options={namespaces.data?.items.map(ns => ({ value: ns.namespace, label: ns.namespace }))} />
      </Form.Item>
      <Form.Item name="role" label="角色" rules={[{ required: true }]}>
        <Select options={[{ value: "viewer", label: "只读用户" }, { value: "operator", label: "运维人员" }, { value: "cluster-admin", label: "集群管理员" }]} />
      </Form.Item>
      <Form.Item name="capabilities" label="附加能力">
        <Checkbox.Group options={[{ value: "logs", label: "日志读取" }, { value: "exec", label: "终端执行" }, { value: "secrets", label: "Secret 访问" }, { value: "kubeconfig", label: "Kubeconfig" }, { value: "ai-assistant:use", label: "AI 助手使用" }]} />
      </Form.Item>
      <Form.Item name="expiresAt" label="到期时间（可选）" rules={[{ validator: async (_, value) => { if (value && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) throw new Error("请选择未来时间"); } }]}>
        <Input type="datetime-local" />
      </Form.Item>
    </Form>
  </Modal>;
}
