"use client";

import { LockOutlined, LoginOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Checkbox, Divider, Form, Input, Space, Tag, Typography } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useThemeMode } from "@/components/theme-context";
import { sanitizeInternalReturnTo } from "@/lib/login-return";

type LoginForm = {
  username: string;
  password: string;
  remember: boolean;
};

// KubeNova SVG Logo — 双主题自适应
function KubeNovaLogo({ size = 48, isDark }: { size?: number; isDark: boolean }) {
  const hexFill = isDark ? "url(#hex-gradient-dark)" : "url(#hex-gradient-light)";
  const strokeColor = isDark ? "rgba(100,200,255,0.6)" : "rgba(37,99,235,0.5)";
  const lineColor = isDark ? "rgba(150,220,255,0.7)" : "rgba(59,130,246,0.8)";
  const lineFaint = isDark ? "rgba(100,180,255,0.5)" : "rgba(37,99,235,0.5)";
  const dotColor = isDark ? "#60c8ff" : "#2563eb";
  const dotFaint = isDark ? "rgba(150,220,255,0.7)" : "rgba(59,130,246,0.6)";
  const orbitColor = isDark ? "rgba(100,200,255,0.3)" : "rgba(37,99,235,0.25)";

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="24,2 43,13 43,35 24,46 5,35 5,13"
        fill={hexFill}
        stroke={strokeColor}
        strokeWidth="1"
      />
      <line x1="24" y1="10" x2="24" y2="24" stroke={lineColor} strokeWidth="1.5" />
      <line x1="24" y1="24" x2="36" y2="18" stroke={lineColor} strokeWidth="1.5" />
      <line x1="24" y1="24" x2="12" y2="18" stroke={lineColor} strokeWidth="1.5" />
      <line x1="24" y1="24" x2="36" y2="30" stroke={lineFaint} strokeWidth="1" />
      <line x1="24" y1="24" x2="12" y2="30" stroke={lineFaint} strokeWidth="1" />
      <line x1="24" y1="24" x2="24" y2="38" stroke={lineFaint} strokeWidth="1" />
      <circle cx="24" cy="10" r="2.5" fill={dotColor} />
      <circle cx="36" cy="18" r="2.5" fill={dotColor} />
      <circle cx="12" cy="18" r="2.5" fill={dotColor} />
      <circle cx="36" cy="30" r="2" fill={dotFaint} />
      <circle cx="12" cy="30" r="2" fill={dotFaint} />
      <circle cx="24" cy="38" r="2" fill={dotFaint} />
      <circle cx="24" cy="24" r="4" fill="url(#core-gradient)" />
      <circle cx="24" cy="24" r="2" fill="#ffffff" opacity="0.9" />
      <circle cx="24" cy="24" r="8" fill="none" stroke={orbitColor} strokeWidth="1" strokeDasharray="2 3" />
      <defs>
        <linearGradient id="hex-gradient-dark" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#0a1628" />
          <stop offset="100%" stopColor="#0d2d4a" />
        </linearGradient>
        <linearGradient id="hex-gradient-light" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#dbeafe" />
          <stop offset="100%" stopColor="#bfdbfe" />
        </linearGradient>
        <radialGradient id="core-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60c8ff" />
          <stop offset="100%" stopColor="#1677ff" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, login, lastRequestId } = useAuth();
  const { mode } = useThemeMode();
  const { message } = App.useApp();
  const isDark = mode === "dark";
  const [submitting, setSubmitting] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [apiProbeFailures, setApiProbeFailures] = useState(0);
  const [isCompact, setIsCompact] = useState(false);
  const apiProbeStartedAtRef = useRef<number>(Date.now());
  const apiProbeGraceMs = 30_000;
  const returnTo = useMemo(
    () => sanitizeInternalReturnTo(searchParams.get("returnTo")),
    [searchParams],
  );

  useEffect(() => {
    if (isAuthenticated && returnTo) {
      router.replace(returnTo || "/dashboard");
    }
  }, [isAuthenticated, returnTo, router]);

  useEffect(() => {
    let cancelled = false;

    const checkApi = async () => {
      try {
        const resp = await fetch("/api/capabilities", { method: "GET" });
        if (!cancelled) {
          setApiReachable(resp.ok);
          setApiProbeFailures((count) => (resp.ok ? 0 : Math.min(count + 1, 5)));
        }
      } catch {
        if (!cancelled) {
          setApiReachable(false);
          setApiProbeFailures((count) => Math.min(count + 1, 5));
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateViewport = () => {
      setIsCompact(window.innerWidth < 992);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  if (isAuthenticated) return null;

  const onFinish = async (values: LoginForm) => {
    setSubmitting(true);
    const result = await login(values);
    if (!result.ok) {
      const hasRequestId = result.message.includes("请求ID:");
      const errorMessage = !hasRequestId && lastRequestId ? `${result.message}（请求ID: ${lastRequestId}）` : result.message;
      message.error(errorMessage);
      setSubmitting(false);
      return;
    }

    message.success("登录成功，正在进入控制台");
    router.replace(returnTo || "/dashboard");
    setSubmitting(false);
  };

  // ── 主题相关样式变量 ──────────────────────────────────────
  const pageBackground = isDark
    ? "radial-gradient(ellipse at 20% 20%, rgba(22,119,255,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(0,180,120,0.1) 0%, transparent 50%), linear-gradient(135deg, #060e1f 0%, #091422 50%, #060e1f 100%)"
    : "radial-gradient(ellipse at 20% 15%, rgba(37,99,235,0.08) 0%, transparent 55%), radial-gradient(ellipse at 80% 85%, rgba(14,165,233,0.06) 0%, transparent 55%), linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 50%, #f0f4ff 100%)";

  const gridColor = isDark
    ? "rgba(22,119,255,0.06)"
    : "rgba(37,99,235,0.05)";

  const cardBackground = isDark
    ? "rgba(8,20,40,0.85)"
    : "rgba(255,255,255,0.92)";

  const cardBorder = isDark
    ? "1px solid rgba(22,119,255,0.2)"
    : "1px solid rgba(37,99,235,0.18)";

  const cardShadow = isDark
    ? "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)"
    : "0 8px 32px rgba(37,99,235,0.1), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)";

  const subtitleColor = isDark
    ? "rgba(180,210,255,0.7)"
    : "#64748b";

  const labelColor = isDark
    ? "rgba(200,220,255,0.8)"
    : "#374151";

  const inputStyle = isDark
    ? {
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(22,119,255,0.25)",
        borderRadius: 8,
        color: "#e8f0ff",
      }
    : {
        background: "#ffffff",
        border: "1px solid rgba(37,99,235,0.2)",
        borderRadius: 8,
        color: "#1e293b",
      };

  const prefixIconColor = isDark ? "rgba(100,160,255,0.6)" : "#6b9cf4";

  const checkboxColor = isDark ? "rgba(150,190,255,0.6)" : "#64748b";

  const dividerColor = isDark ? "rgba(22,119,255,0.15)" : "rgba(37,99,235,0.12)";
  const dividerTextColor = isDark ? "rgba(150,190,255,0.4)" : "#94a3b8";

  const secondaryBtnStyle = isDark
    ? {
        borderRadius: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(22,119,255,0.2)",
        color: "rgba(150,190,255,0.6)",
        fontSize: 13,
      }
    : {
        borderRadius: 8,
        background: "#f8faff",
        border: "1px solid rgba(37,99,235,0.18)",
        color: "#64748b",
        fontSize: 13,
      };

  const footerColor = isDark ? "rgba(100,140,200,0.35)" : "#94a3b8";

  const orb1Background = isDark
    ? "radial-gradient(circle, rgba(22,119,255,0.12) 0%, transparent 70%)"
    : "radial-gradient(circle, rgba(37,99,235,0.07) 0%, transparent 70%)";

  const orb2Background = isDark
    ? "radial-gradient(circle, rgba(0,180,120,0.08) 0%, transparent 70%)"
    : "radial-gradient(circle, rgba(14,165,233,0.06) 0%, transparent 70%)";

  const brandSubtitleColor = isDark
    ? "rgba(150,200,255,0.6)"
    : "#94a3b8";

  const taglineColor = isDark
    ? "rgba(200,220,255,0.45)"
    : "#94a3b8";
  const surfaceBackground = isDark ? "rgba(8,20,40,0.4)" : "rgba(255,255,255,0.66)";
  const surfaceBorder = isDark ? "1px solid rgba(59,130,246,0.2)" : "1px solid rgba(37,99,235,0.15)";
  const shouldShowApiWarning =
    apiReachable === false &&
    apiProbeFailures >= 3 &&
    Date.now() - apiProbeStartedAtRef.current >= apiProbeGraceMs &&
    !submitting;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: pageBackground,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          pointerEvents: "none",
        }}
      />
      {/* Glow orbs */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "10%",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: orb1Background,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "10%",
          right: "8%",
          width: 250,
          height: 250,
          borderRadius: "50%",
          background: orb2Background,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "min(1120px, calc(100vw - 40px))",
          display: "flex",
          gap: 24,
          alignItems: "stretch",
          flexDirection: isCompact ? "column" : "row",
        }}
      >
        {!isCompact ? (
          <div
            style={{
              flex: "1 1 0",
              borderRadius: 24,
              border: surfaceBorder,
              background: surfaceBackground,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: isDark ? "0 14px 38px rgba(2,6,23,0.42)" : "0 14px 38px rgba(15,23,42,0.1)",
              padding: "38px 34px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <KubeNovaLogo size={56} isDark={isDark} />
                <div style={{ textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 30,
                      fontWeight: 800,
                      letterSpacing: 1,
                      background: isDark
                        ? "linear-gradient(135deg, #60c8ff 0%, #1677ff 50%, #00b4d8 100%)"
                        : "linear-gradient(135deg, #1677ff 0%, #2563eb 50%, #0ea5e9 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      lineHeight: 1.2,
                    }}
                  >
                    KubeNova
                  </div>
                  <div style={{ fontSize: 12, color: brandSubtitleColor, letterSpacing: 2, marginTop: 2 }}>
                    CLOUD NATIVE AIOps
                  </div>
                </div>
              </div>
              <Typography.Title level={2} style={{ color: isDark ? "#e2e8f0" : "#0f172a", marginBottom: 14 }}>
                运维控制台统一入口
              </Typography.Title>
              <Typography.Paragraph
                style={{ color: subtitleColor, marginBottom: 18, maxWidth: 520, fontSize: 14, lineHeight: 1.75 }}
              >
                统一进入集群、工作负载、网络、存储与 AI 运维能力，登录后可直接继续当前上下文。
              </Typography.Paragraph>
              <Space orientation="vertical" size={12}>
                <Tag color="blue">统一状态视图</Tag>
                <Tag color="cyan">终端与 AI 协同</Tag>
                <Tag color="geekblue">集群级操作审计</Tag>
              </Space>
            </div>
            <Typography.Text style={{ color: taglineColor, fontSize: 13 }}>
              仅显示与运维相关的生产信息
            </Typography.Text>
          </div>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 6 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <KubeNovaLogo size={42} isDark={isDark} />
              <div style={{ textAlign: "left" }}>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: 0.8,
                    background: isDark
                      ? "linear-gradient(135deg, #60c8ff 0%, #1677ff 50%, #00b4d8 100%)"
                      : "linear-gradient(135deg, #1677ff 0%, #2563eb 50%, #0ea5e9 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    lineHeight: 1.2,
                  }}
                >
                  KubeNova
                </div>
                <div style={{ fontSize: 11, color: brandSubtitleColor, letterSpacing: 1.4, marginTop: 2 }}>
                  CLOUD NATIVE AIOps
                </div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: taglineColor, letterSpacing: 0.4 }}>
              企业级 Kubernetes 智能运维平台
            </div>
          </div>
        )}

        <div style={{ width: isCompact ? "100%" : 430, flexShrink: 0 }}>
          <Card
            style={{
              borderRadius: 16,
              border: cardBorder,
              background: cardBackground,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: cardShadow,
            }}
            styles={{ body: { padding: "30px 28px" } }}
          >
            <Space orientation="vertical" size={0} style={{ width: "100%" }}>
              <Typography.Title
                level={4}
                style={{ color: isDark ? "#e2e8f0" : "#0f172a", marginBottom: 6 }}
              >
                登录控制台
              </Typography.Title>
              <Typography.Text style={{ color: subtitleColor, fontSize: 13, marginBottom: 20, display: "block" }}>
                输入平台账号以继续操作
              </Typography.Text>
              {shouldShowApiWarning ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="控制面 API 暂不可达"
                  description="后端或同源 /api 代理短暂不可用时会显示此提示，若持续存在请检查后端服务。"
                />
              ) : null}

              <Form<LoginForm>
                layout="vertical"
                onFinish={onFinish}
              >
                <Form.Item
                  label={<span style={{ color: labelColor, fontSize: 13 }}>账号</span>}
                  name="username"
                  rules={[{ required: true, message: "请输入账号" }]}
                >
                  <Input
                    prefix={<UserOutlined style={{ color: prefixIconColor }} />}
                    placeholder="输入邮箱账号"
                    size="large"
                    style={inputStyle}
                  />
                </Form.Item>

                <Form.Item
                  label={<span style={{ color: labelColor, fontSize: 13 }}>密码</span>}
                  name="password"
                  rules={[{ required: true, message: "请输入密码" }]}
                >
                  <Input.Password
                    prefix={<LockOutlined style={{ color: prefixIconColor }} />}
                    placeholder="输入登录密码"
                    size="large"
                    style={inputStyle}
                  />
                </Form.Item>

                <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 20 }}>
                  <Checkbox style={{ color: checkboxColor, fontSize: 13 }}>保持登录</Checkbox>
                </Form.Item>

                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<LoginOutlined />}
                    loading={submitting}
                    block
                    size="large"
                    style={{
                      borderRadius: 8,
                      height: 44,
                      fontSize: 15,
                      fontWeight: 600,
                      background: "linear-gradient(135deg, #1677ff, #0ea5e9)",
                      border: "none",
                      boxShadow: isDark
                        ? "0 4px 16px rgba(22,119,255,0.4)"
                        : "0 4px 16px rgba(22,119,255,0.25)",
                    }}
                  >
                    登录控制台
                  </Button>
                </Form.Item>
              </Form>

              <Divider style={{ borderColor: dividerColor, margin: "20px 0", color: dividerTextColor, fontSize: 12 }}>
                或使用其他方式
              </Divider>

              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                <Button
                  icon={<SafetyCertificateOutlined />}
                  block
                  size="large"
                  style={secondaryBtnStyle}
                >
                  OIDC 单点登录
                </Button>
                <Button
                  block
                  size="large"
                  style={secondaryBtnStyle}
                >
                  企业 SSO 登录
                </Button>
              </Space>
            </Space>
          </Card>

          <div style={{ textAlign: "center", marginTop: 18, color: footerColor, fontSize: 12 }}>
            KubeNova v1.0 · 企业级容器云管理平台
          </div>
        </div>
      </div>
    </div>
  );
}
