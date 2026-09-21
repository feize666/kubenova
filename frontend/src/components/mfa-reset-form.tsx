"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Radio, Space, Typography } from "antd";
import { confirmMfaReset, exchangeMfaResetOidc, prepareMfaReset, type MfaStatus, type ResetFactor } from "@/lib/api/mfa-reset";

type Props = {
  accessToken: string;
  target: { id: string; username: string };
  status: MfaStatus;
  callbackUrl?: string;
  onDone: () => void;
  onCancel: () => void;
};

export function MfaResetForm({ accessToken, target, status, callbackUrl, onDone, onCancel }: Props) {
  const [form] = Form.useForm();
  const [proof, setProof] = useState<{ token: string; deadline: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setProof(null); setError(""); setBusy(false); form.resetFields();
    return () => { generation.current++; };
  }, [accessToken, target.id, form]);
  useEffect(() => {
    if (!proof) return;
    const timer = window.setTimeout(() => {
      setProof(null); setError("验证已过期，请重新验证身份。");
    }, Math.max(0, proof.deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [proof]);

  if (!status.canManageMfa) return <Alert type="warning" showIcon title="当前账号没有 MFA 管理权限" />;
  const cancel = () => { generation.current++; setProof(null); form.resetFields(); onCancel(); };
  return <section style={{ maxWidth: 480 }}>
    <Typography.Title level={4}>重置多因素验证</Typography.Title>
    <Typography.Paragraph style={{ overflowWrap: "anywhere" }}>目标账号：{target.username}</Typography.Paragraph>
    <Alert type="warning" showIcon title="重置后，该账号的验证器和恢复码失效，所有登录会话立即撤销。" />
    {error && <Alert type="error" showIcon title={error} style={{ marginTop: 16 }} />}
    {!proof ? <Form form={form} layout="vertical" initialValues={{ method: "totp" }} style={{ marginTop: 20 }} onFinish={async values => {
      const current = generation.current;
      setBusy(true); setError(""); form.resetFields();
      const factor: ResetFactor | undefined = status.enabled ? { code: values.code, method: values.method } : undefined;
      try {
        const result = callbackUrl
          ? await exchangeMfaResetOidc(accessToken, target.id, callbackUrl, factor)
          : await prepareMfaReset(accessToken, target.id, values.password, factor);
        if (generation.current !== current) return;
        if (!/^[A-Za-z0-9_-]{43}$/.test(result.token) || !Number.isInteger(result.expiresIn) || result.expiresIn <= 0 || result.expiresIn > 300) throw new Error("Invalid proof");
        setProof({ token: result.token, deadline: Date.now() + result.expiresIn * 1000 });
      } catch {
        if (generation.current === current) setError(callbackUrl ? "企业身份验证失败或已使用，请重新发起验证。" : "身份验证失败，请检查密码和验证码后重试。");
      } finally { if (generation.current === current) setBusy(false); }
    }}>
      {!callbackUrl && <Form.Item name="password" label="您的当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
        <Input.Password autoComplete="current-password" maxLength={1024} disabled={busy} />
      </Form.Item>}
      {status.enabled && <>
        <Form.Item name="method" label="二次验证方式"><Radio.Group disabled={busy} options={[{ label: "验证器", value: "totp" }, { label: "恢复码", value: "recovery" }]} /></Form.Item>
        <Form.Item name="code" label="验证码或恢复码" rules={[{ required: true, message: "请输入验证码或恢复码" }]}><Input.Password autoComplete="one-time-code" maxLength={128} disabled={busy} /></Form.Item>
      </>}
      <Space wrap><Button type="primary" htmlType="submit" loading={busy} disabled={!callbackUrl && !status.passwordReauthenticationAvailable}>验证身份</Button><Button disabled={busy} onClick={cancel}>取消</Button></Space>
    </Form> : <Space wrap style={{ marginTop: 20 }}>
      <Button danger type="primary" loading={busy} onClick={async () => {
        if (busy || Date.now() >= proof.deadline) { setProof(null); return; }
        const current = generation.current;
        const token = proof.token;
        setBusy(true); setError("");
        try {
          await confirmMfaReset(accessToken, target.id, token);
          if (generation.current === current) { setProof(null); onDone(); }
        } catch { if (generation.current === current) { setProof(null); setError("重置未完成，请重新验证身份并确认账号状态。"); } }
        finally { if (generation.current === current) setBusy(false); }
      }}>确认重置 MFA</Button>
      <Button disabled={busy} onClick={cancel}>取消</Button>
    </Space>}
  </section>;
}
