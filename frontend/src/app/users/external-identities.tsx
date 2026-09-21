"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Form, Input, Popconfirm, Space, Spin, Typography } from "antd";
import { OpsModalShell } from "@/components/ops";
import { bindExternalIdentity, getExternalIdentities, unbindExternalIdentity, type ExternalIdentity, type UserListItem } from "@/lib/api/users";

export function ExternalIdentities({ user, token, onClose }: { user: UserListItem; token: string; onClose: () => void }) {
  const [form] = Form.useForm<Pick<ExternalIdentity, "issuer" | "subject">>();
  const client = useQueryClient();
  const queryKey = ["users", "external-identities", user.id, token];
  const query = useQuery({ queryKey, queryFn: () => getExternalIdentities(user.id, token), enabled: Boolean(token) });
  const refresh = async () => { await client.invalidateQueries({ queryKey }); };
  const bind = useMutation({
    mutationFn: (values: Pick<ExternalIdentity, "issuer" | "subject">) => bindExternalIdentity(user.id, values, token),
    onSuccess: async () => { form.resetFields(); await refresh(); },
  });
  const unbind = useMutation({ mutationFn: (id: string) => unbindExternalIdentity(user.id, id, token), onSuccess: refresh });
  const pending = bind.isPending || unbind.isPending;
  const error = bind.error || unbind.error || query.error;

  return (
    <OpsModalShell title={`企业身份 · ${user.username}`} open onCancel={onClose} footer={null} width={620} destroyOnHidden>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert type="warning" showIcon title="绑定或解绑会使该用户现有会话失效" description="请从身份提供商核实 Issuer 与 Subject，不要使用邮箱代替 Subject。" />
        {error ? <Alert type="error" showIcon title="操作失败" description={error instanceof Error ? error.message : "请重试"} /> : null}
        {query.isPending ? <Spin /> : query.isError ? <Button onClick={() => void query.refetch()}>重试</Button> : query.data?.items.length ? query.data.items.map(identity => (
          <div key={identity.id} style={{ borderBottom: "1px solid var(--ops-border)", paddingBottom: 12 }}>
            <Typography.Paragraph style={{ overflowWrap: "anywhere", marginBottom: 4 }}>{identity.issuer}</Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ overflowWrap: "anywhere", marginBottom: 8 }}>Subject: {identity.subject}</Typography.Paragraph>
            <Popconfirm title="解绑企业身份？" description="此身份将无法登录，现有会话将失效。本地账号不会被删除。" onConfirm={() => unbind.mutateAsync(identity.id)} okText="解绑" cancelText="取消" disabled={pending}>
              <Button danger size="small" disabled={pending} loading={unbind.isPending && unbind.variables === identity.id}>解绑</Button>
            </Popconfirm>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未绑定企业身份" />}
        <Form form={form} layout="vertical" onFinish={values => { unbind.reset(); bind.mutate(values); }} disabled={pending || !user.isActive}>
          <Form.Item name="issuer" label="Issuer" rules={[{ required: true, message: "请输入身份提供商 Issuer" }, { type: "url", message: "请输入完整 URL" }, { max: 2048 }]}>
            <Input autoComplete="off" placeholder="https://identity.example.com/realms/kubenova" maxLength={2048} />
          </Form.Item>
          <Form.Item name="subject" label="Subject" rules={[{ required: true, whitespace: true, message: "请输入身份提供商用户的 Subject" }, { max: 255 }]}>
            <Input autoComplete="off" maxLength={255} />
          </Form.Item>
          {!user.isActive ? <Typography.Paragraph type="secondary">账号已禁用，无法添加绑定。</Typography.Paragraph> : null}
          <Button type="primary" htmlType="submit" loading={bind.isPending}>绑定身份</Button>
        </Form>
      </Space>
    </OpsModalShell>
  );
}
