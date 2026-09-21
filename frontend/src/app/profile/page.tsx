"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Descriptions, Form, Input, Space, Tag, Typography } from "antd";
import { DownloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useAuth, MFA_OIDC_PURPOSE_KEY } from "@/components/auth-context";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { apiRequest } from "@/lib/api/client";
import { downloadNativeKubeconfig, listNativeKubeconfigClusters, type NativeKubeconfigClusterList } from "@/lib/api/native-access";

type MfaStatus = { enabled: boolean; passwordReauthenticationAvailable: boolean };

export default function ProfilePage() {
  const { username, role, accessToken, enrollment, enrollmentError, beginEnrollment, confirmEnrollment, cancelEnrollment } = useAuth();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [oidc, setOidc] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nativeClusters, setNativeClusters] = useState<NativeKubeconfigClusterList["items"]>([]);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativeDownload, setNativeDownload] = useState("");
  const [passwordForm] = Form.useForm();
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void apiRequest<MfaStatus>("/api/v1/auth/mfa/status", { token: accessToken }).then(value => { if (active) setStatus(value); }).catch(() => { if (active) setError("无法获取安全状态，请刷新重试或重新登录。"); });
    void apiRequest<{ enabled: boolean }>("/api/v1/auth/oidc/status").then(value => { if (active) setOidc(value.enabled); }).catch(() => {});
    return () => { active = false; };
  }, [accessToken]);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    setNativeLoading(true);
    void listNativeKubeconfigClusters(accessToken).then(value => { if (active) setNativeClusters(value.items); }).catch(() => { if (active) setNativeClusters([]); }).finally(() => { if (active) setNativeLoading(false); });
    return () => { active = false; };
  }, [accessToken]);
  useEffect(() => {
    if (!enrollment) return;
    const timer = window.setTimeout(cancelEnrollment, Math.max(0, enrollment.deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [enrollment, cancelEnrollment]);

  const startOidc = async () => {
    setBusy(true); setError(""); cancelEnrollment();
    try {
      const result = await apiRequest<{ url: string }>("/api/v1/auth/oidc/enrollment/prepare", { method: "POST", token: accessToken, suppressAuthExpiryBroadcast: true });
      const target = new URL(result.url);
      if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname))) throw new Error("Invalid provider URL");
      // Routing hint only; the authenticated server exchange binds the principal.
      sessionStorage.setItem(MFA_OIDC_PURPOSE_KEY, "enrollment");
      window.location.assign(target.href);
    } catch { sessionStorage.removeItem(MFA_OIDC_PURPOSE_KEY); setError("企业身份验证暂不可用，请重试或重新登录。"); setBusy(false); }
  };

  return <main style={{ padding: 24, maxWidth: 880 }}>
    <ResourcePageHeader title="个人中心" path="/profile" />
    <Descriptions size="small" column={1} style={{ margin: "24px 0" }} items={[{ key: "name", label: "账号", children: username }, { key: "role", label: "角色", children: role }]} />
    <section style={{ borderTop: "1px solid var(--ops-border-default)", paddingTop: 24 }}>
      <Typography.Title level={4}><SafetyCertificateOutlined /> 多因素验证</Typography.Title>
      <Tag color={status?.enabled ? "success" : "default"}>{status ? status.enabled ? "已启用" : "未启用" : "正在加载"}</Tag>
      {(error || enrollmentError) && <Alert type="error" showIcon title={error || enrollmentError} style={{ marginTop: 16 }} />}
      {status?.enabled && <Typography.Paragraph style={{ marginTop: 16 }}>登录时需要验证器验证码或恢复码。</Typography.Paragraph>}
      {status && !status.enabled && !enrollment && <div style={{ maxWidth: 400, marginTop: 24 }}>
        {status.passwordReauthenticationAvailable && <Form form={passwordForm} layout="vertical" onFinish={async ({ password }) => {
          setBusy(true); setError(""); passwordForm.resetFields();
          try { await beginEnrollment(password); } catch { setError("身份验证失败，请检查密码或重新登录后重试。"); } finally { setBusy(false); }
        }}>
          <Form.Item name="password" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}><Input.Password autoComplete="current-password" maxLength={1024} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>验证身份</Button>
        </Form>}
        {oidc && <Button style={{ marginTop: 16 }} loading={busy} onClick={() => void startOidc()}>通过企业账号验证身份</Button>}
        {!status.passwordReauthenticationAvailable && !oidc && <Alert type="warning" title="当前没有可用的身份验证方式，请联系管理员。" />}
      </div>}
      {enrollment && <div style={{ maxWidth: 480, marginTop: 24 }}>
        <Typography.Title level={5}>添加到验证器</Typography.Title>
        <Descriptions column={1} size="small" items={[
          { key: "account", label: "账号", children: `KubeNova:${username}` },
          { key: "secret", label: "设置密钥", children: <code style={{ overflowWrap: "anywhere", userSelect: "all" }}>{enrollment.secret}</code> },
          { key: "algorithm", label: "类型", children: "基于时间 · SHA-1 · 6 位 · 30 秒" },
        ]} />
        <Form layout="vertical" style={{ marginTop: 24 }} onFinish={({ code }) => void confirmEnrollment(code)}>
          <Form.Item name="code" label="验证码" rules={[{ required: true, pattern: /^\d{6}$/, message: "请输入 6 位验证码" }]}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={{ maxWidth: 240 }} /></Form.Item>
          <Space wrap><Button type="primary" htmlType="submit">启用多因素验证</Button><Button onClick={cancelEnrollment}>取消</Button></Space>
        </Form>
      </div>}
    </section>
    <section style={{ borderTop: "1px solid var(--ops-border-default)", paddingTop: 24, marginTop: 32 }}>
      <Typography.Title level={4}>个人 kubectl 访问</Typography.Title>
      <Typography.Paragraph type="secondary">仅显示已完成授权同步的集群。下载文件不包含访问令牌或客户端密钥，需通过企业身份登录获取短期凭据。</Typography.Paragraph>
      {nativeLoading && <Tag>正在加载</Tag>}
      {!nativeLoading && nativeClusters.length === 0 && <Typography.Text type="secondary">当前没有可下载的集群访问配置。</Typography.Text>}
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {nativeClusters.map(cluster => <Space key={cluster.id} style={{ justifyContent: "space-between", width: "100%" }}>
          <Typography.Text>{cluster.name}</Typography.Text>
          <Button icon={<DownloadOutlined />} loading={nativeDownload === cluster.id} disabled={Boolean(nativeDownload)} onClick={() => {
            if (!accessToken) return;
            setNativeDownload(cluster.id); setError("");
            void downloadNativeKubeconfig(cluster.id, accessToken).then(({ blob, filename }) => {
              const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
            }).catch(() => setError("kubeconfig 下载失败，请确认企业身份绑定和集群授权状态。")).finally(() => setNativeDownload(""));
          }}>下载 kubeconfig</Button>
        </Space>)}
      </Space>
    </section>
  </main>;
}
