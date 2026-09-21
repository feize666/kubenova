"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Descriptions, Form, Input, Popconfirm, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { CloudServerOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import {
  getNativeAccessSettings,
  reconcileNativeAccess,
  saveNativeAccessSettings,
  type NativeAccessSettings,
  type NativeAccessSettingsInput,
} from "@/lib/api/native-access";

const initialValues: NativeAccessSettingsInput = {
  enabled: false,
  issuer: "",
  audience: "kubenova-kubectl",
  jwksUri: "",
  gatewayUrl: "",
  revision: 0,
};

function syncTag(state: NativeAccessSettings["syncState"]) {
  if (state === "ready") return <Tag color="green">已同步</Tag>;
  if (state === "failed") return <Tag color="red">同步失败</Tag>;
  return <Tag color="gold">待同步</Tag>;
}

export function NativeAccessSettingsPanel() {
  const { accessToken, role } = useAuth();
  const [clusterId, setClusterId] = useState<string>();
  const [form] = Form.useForm<NativeAccessSettingsInput>();
  const client = useQueryClient();
  const isAdministrator = ["admin", "platform-admin"].includes(role);
  const clusters = useQuery({
    queryKey: ["native-access-clusters", accessToken],
    enabled: Boolean(accessToken && isAdministrator),
    queryFn: () => getClusters({ pageSize: 100 }, accessToken!),
  });
  const settings = useQuery({
    queryKey: ["native-access-settings", accessToken, clusterId],
    enabled: Boolean(accessToken && isAdministrator && clusterId),
    queryFn: () => getNativeAccessSettings(clusterId!, accessToken!),
  });

  useEffect(() => {
    if (!settings.data) return;
    form.setFieldsValue({
      enabled: settings.data.enabled,
      issuer: settings.data.issuer ?? "",
      audience: settings.data.audience ?? "kubenova-kubectl",
      jwksUri: settings.data.jwksUri ?? "",
      gatewayUrl: settings.data.gatewayUrl ?? "",
      revision: settings.data.revision,
    });
  }, [form, settings.data]);

  const save = useMutation({
    mutationFn: (input: NativeAccessSettingsInput) => saveNativeAccessSettings(clusterId!, input, accessToken!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["native-access-settings", accessToken, clusterId] });
    },
  });
  const reconcile = useMutation({
    mutationFn: () => reconcileNativeAccess(clusterId!, accessToken!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["native-access-settings", accessToken, clusterId] });
      await client.invalidateQueries({ queryKey: ["authorization-changes"] });
    },
  });

  const submit = async () => {
    try {
      save.mutate(await form.validateFields());
    } catch {
      // Field errors remain next to their input.
    }
  };

  if (!isAdministrator) {
    return <Alert type="info" showIcon message="个人 kubectl 访问由平台管理员配置" description="这里不会显示网关、身份源或同步状态。" />;
  }

  const current = settings.data;
  return <Space direction="vertical" size="middle" style={{ width: "100%", maxWidth: 920 }}>
    <Alert
      type="info"
      showIcon
      icon={<SafetyCertificateOutlined />}
      message="个人 kubectl 使用 OIDC 短期凭据"
      description="保存配置不会修改集群 RBAC。只有在启用后手动执行“同步访问规则”，才会将当前有效授权写入 KubeNova 自有的 Role 与 RoleBinding。"
    />
    <Space wrap>
      <Select
        aria-label="选择待配置的集群"
        placeholder="选择集群"
        style={{ width: 320 }}
        value={clusterId}
        loading={clusters.isFetching}
        onChange={(value) => {
          setClusterId(value);
          save.reset();
          reconcile.reset();
          form.setFieldsValue(initialValues);
        }}
        options={clusters.data?.items.map((cluster) => ({ value: cluster.id, label: cluster.name }))}
      />
      <Button icon={<ReloadOutlined />} onClick={() => void clusters.refetch()} loading={clusters.isFetching}>刷新集群</Button>
      {clusterId && <Button icon={<ReloadOutlined />} onClick={() => void settings.refetch()} loading={settings.isFetching}>重新读取</Button>}
    </Space>
    {clusters.isError && <Alert type="error" showIcon message="集群列表加载失败" action={<Button onClick={() => void clusters.refetch()}>重试</Button>} />}
    {settings.isError && <Alert type="error" showIcon message="访问配置读取失败" description="请确认当前账号仍是平台管理员，并重试。" action={<Button onClick={() => void settings.refetch()}>重试</Button>} />}
    {clusterId && !settings.isError && <Spin spinning={settings.isLoading}>
      <Form form={form} layout="vertical" initialValues={initialValues} disabled={save.isPending || reconcile.isPending}>
        <Form.Item name="enabled" label="启用个人 kubectl 访问" valuePropName="checked">
          <Switch checkedChildren="已启用" unCheckedChildren="未启用" />
        </Form.Item>
        <Form.Item name="issuer" label="OIDC Issuer" rules={[{ required: true, type: "url", message: "请输入 HTTPS Issuer 地址" }]}>
          <Input placeholder="https://sso.example.com/realms/kubenova" />
        </Form.Item>
        <Form.Item name="audience" label="OIDC Audience" rules={[{ required: true, whitespace: true, max: 200 }]}>
          <Input placeholder="kubenova-kubectl" />
        </Form.Item>
        <Form.Item name="jwksUri" label="JWKS 地址" rules={[{ required: true, type: "url", message: "请输入 HTTPS JWKS 地址" }]}>
          <Input placeholder="https://sso.example.com/realms/kubenova/protocol/openid-connect/certs" />
        </Form.Item>
        <Form.Item name="gatewayUrl" label="访问网关地址" rules={[{ required: true, type: "url", message: "请输入 HTTPS 网关地址" }]}>
          <Input prefix={<CloudServerOutlined />} placeholder="https://gateway.example.com/native" />
        </Form.Item>
        <Form.Item hidden name="revision"><Input /></Form.Item>
      </Form>
      {current && <Descriptions size="small" column={2} bordered items={[
        { key: "state", label: "规则状态", children: syncTag(current.syncState) },
        { key: "revision", label: "配置版本", children: current.revision },
        { key: "synced", label: "最近同步", children: current.syncedAt ? new Date(current.syncedAt).toLocaleString("zh-CN") : "尚未同步" },
        { key: "message", label: "同步说明", children: current.syncMessage || "保存后需要显式同步" },
      ]} />}
      {save.isError && <Alert type="error" showIcon message="保存失败" description="配置可能已被其他管理员更新，请重新读取后再提交。" />}
      {reconcile.isError && <Alert type="error" showIcon message="同步失败" description="未确认任何 RBAC 变更；请检查 OIDC、网关、集群连通性和当前授权范围。" />}
      <Space>
        <Button type="primary" onClick={() => void submit()} loading={save.isPending}>保存配置</Button>
        <Popconfirm
          title="同步当前授权到集群？"
          description="仅会维护 KubeNova 所有的 RBAC 对象；过期、撤销或不再匹配的规则会被移除。"
          okText="同步"
          cancelText="取消"
          onConfirm={() => reconcile.mutate()}
          disabled={!current?.enabled || current.syncState === "ready" && current.syncRevision === current.revision || reconcile.isPending}
        >
          <Button icon={<SyncOutlined />} disabled={!current?.enabled || current.syncState === "ready" && current.syncRevision === current.revision || reconcile.isPending} loading={reconcile.isPending}>同步访问规则</Button>
        </Popconfirm>
      </Space>
      <Typography.Text type="secondary">同步前会重新验证集群 HTTPS API Server、当前命名空间 UID 和每位用户的有效授权。</Typography.Text>
    </Spin>}
  </Space>;
}
