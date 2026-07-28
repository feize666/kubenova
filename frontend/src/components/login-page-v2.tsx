"use client";

import {
  LockOutlined,
  LoginOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Checkbox, Form, Input, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useThemeMode } from "@/components/theme-context";
import { sanitizeInternalReturnTo } from "@/lib/login-return";

type LoginForm = {
  username: string;
  password: string;
  remember: boolean;
};

function KubeNovaMark({ isDark }: { isDark: boolean }) {
  const primary = isDark ? "#7dd3fc" : "#235cff";
  const secondary = isDark ? "#18354b" : "#e7efff";

  return (
    <svg aria-hidden="true" className="login-v2__mark" viewBox="0 0 48 48">
      <path d="M24 3 42 13v22L24 45 6 35V13L24 3Z" fill={secondary} stroke={primary} />
      <path d="M24 12v24M13 18l22 12M35 18 13 30" fill="none" stroke={primary} strokeWidth="1.5" />
      <circle cx="24" cy="24" r="4" fill={primary} />
      <circle cx="24" cy="12" r="2.5" fill={primary} />
      <circle cx="35" cy="18" r="2.5" fill={primary} />
      <circle cx="35" cy="30" r="2.5" fill={primary} />
      <circle cx="24" cy="36" r="2.5" fill={primary} />
      <circle cx="13" cy="30" r="2.5" fill={primary} />
      <circle cx="13" cy="18" r="2.5" fill={primary} />
    </svg>
  );
}

function LoginPageV2Content() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isInitializing, lastRequestId, login } = useAuth();
  const { mode } = useThemeMode();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [apiProbeFailures, setApiProbeFailures] = useState(0);
  const returnTo = useMemo(
    () => sanitizeInternalReturnTo(searchParams.get("returnTo")),
    [searchParams],
  );

  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      router.replace(returnTo || "/dashboard");
    }
  }, [isAuthenticated, isInitializing, returnTo, router]);

  useEffect(() => {
    let cancelled = false;
    const checkApi = async () => {
      try {
        const response = await fetch("/api/capabilities", { method: "GET" });
        if (!cancelled) {
          setApiReachable(response.ok);
          setApiProbeFailures((count) => (response.ok ? 0 : Math.min(count + 1, 3)));
        }
      } catch {
        if (!cancelled) {
          setApiReachable(false);
          setApiProbeFailures((count) => Math.min(count + 1, 3));
        }
      }
    };

    void checkApi();
    const timer = window.setInterval(() => void checkApi(), 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!isInitializing && isAuthenticated) {
    return null;
  }

  const onFinish = async (values: LoginForm) => {
    setSubmitting(true);
    const result = await login(values);
    if (!result.ok) {
      const errorMessage = lastRequestId && !result.message.includes("请求ID:")
        ? `${result.message}（请求ID: ${lastRequestId}）`
        : result.message;
      message.error(errorMessage);
      setSubmitting(false);
      return;
    }

    message.success("登录成功，正在进入控制台");
    router.replace(returnTo || "/dashboard");
  };

  const isDark = mode === "dark";
  const showApiWarning = apiReachable === false && apiProbeFailures >= 3 && !submitting;

  return (
    <main className="login-v2">
      <section className="login-v2__panel" aria-label="KubeNova 登录">
        <aside className="login-v2__context" aria-label="平台概览">
          <div className="login-v2__brand">
            <KubeNovaMark isDark={isDark} />
            <div>
              <div className="login-v2__brand-name">KubeNova</div>
              <div className="login-v2__brand-meta">CLOUD NATIVE OPS</div>
            </div>
          </div>
          <div className="login-v2__copy">
            <span className="login-v2__eyebrow">OPERATIONS CONSOLE</span>
            <Typography.Title level={1} className="login-v2__headline">
              企业级云原生运维控制台
            </Typography.Title>
            <Typography.Paragraph className="login-v2__description">
              集群、工作负载、网络和可观测性统一在同一操作上下文中。
            </Typography.Paragraph>
          </div>
          <div className="login-v2__signals" aria-label="平台能力">
            <span>集群状态</span>
            <span>资源交付</span>
            <span>运行审计</span>
          </div>
        </aside>

        <section className="login-v2__form-area" aria-label="登录表单">
          <div className="login-v2__form-header">
            <Typography.Title level={3} className="login-v2__title">登录控制台</Typography.Title>
            <Typography.Text className="login-v2__subtitle">使用平台账号继续操作</Typography.Text>
          </div>

          {showApiWarning ? (
            <Alert
              className="login-v2__alert"
              type="warning"
              showIcon
              title="控制面服务暂不可达"
              description="当前无法连接控制面服务，请稍后重试。"
            />
          ) : null}

          <Form<LoginForm> className="login-v2__form" layout="vertical" onFinish={onFinish} autoComplete="on">
            <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
              <Input
                prefix={<UserOutlined />}
                placeholder="输入邮箱账号"
                size="large"
                autoComplete="username"
                autoCorrect="off"
                spellCheck={false}
              />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="输入登录密码"
                size="large"
                autoComplete="current-password"
                autoCorrect="off"
                spellCheck={false}
              />
            </Form.Item>
            <div className="login-v2__form-options">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>保持登录</Checkbox>
              </Form.Item>
            </div>
            <Button
              className="login-v2__submit"
              type="primary"
              htmlType="submit"
              icon={<LoginOutlined />}
              loading={submitting}
              block
              size="large"
            >
              登录控制台
            </Button>
          </Form>

          <div className="login-v2__separator">其他登录方式</div>
          <div className="login-v2__alternatives">
            <Button icon={<SafetyCertificateOutlined />} block size="large">OIDC 单点登录</Button>
            <Button block size="large">企业 SSO 登录</Button>
          </div>
          <div className="login-v2__footer">KubeNova v1.0 · 企业级容器云管理平台</div>
        </section>
      </section>
    </main>
  );
}

export default function LoginPageV2() {
  return (
    <Suspense fallback={null}>
      <LoginPageV2Content />
    </Suspense>
  );
}
