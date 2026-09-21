"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Result } from "antd";
import { useAuth, MFA_OIDC_PURPOSE_KEY } from "@/components/auth-context";
import { BootstrapScreen } from "@/components/bootstrap-screen";
import { MfaResetPage, RESET_OIDC_TARGET_KEY } from "@/components/mfa-reset-page";

export default function OidcCallbackPage() {
  const { completeOidc, completeEnrollmentOidc, isInitializing, isAuthenticated } = useAuth();
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const [reset, setReset] = useState<{ targetId: string; callbackUrl: string } | null>(null);
  const [enrollmentFlow, setEnrollmentFlow] = useState(false);
  useEffect(() => {
    if (isInitializing || started.current) return;
    started.current = true;
    const callbackUrl = window.location.href;
    window.history.replaceState(window.history.state, "", "/login/oidc");
    const purpose = sessionStorage.getItem(MFA_OIDC_PURPOSE_KEY);
    const resetTarget = sessionStorage.getItem(RESET_OIDC_TARGET_KEY);
    sessionStorage.removeItem(RESET_OIDC_TARGET_KEY);
    sessionStorage.removeItem(MFA_OIDC_PURPOSE_KEY);
    if (resetTarget !== null) {
      if (purpose !== null || !isAuthenticated || !resetTarget || resetTarget.length > 256) { setFailed(true); return; }
      setReset({ targetId: resetTarget, callbackUrl });
      return;
    }
    if (purpose !== null) {
      setEnrollmentFlow(true);
      if (purpose !== "enrollment" || !isAuthenticated) { setFailed(true); return; }
      void completeEnrollmentOidc(callbackUrl).then(() => router.replace("/profile")).catch(() => setFailed(true));
      return;
    }
    // An authenticated callback without a purpose must not replace its principal.
    if (isAuthenticated) { setEnrollmentFlow(true); setFailed(true); return; }
    void completeOidc(callbackUrl).then(authenticated => router.replace(authenticated ? "/" : "/login")).catch(() => setFailed(true));
  }, [completeOidc, completeEnrollmentOidc, isInitializing, isAuthenticated, router]);

  if (failed) return <Result status="error" title={enrollmentFlow ? "身份验证失败" : "单点登录失败"} subTitle={enrollmentFlow ? "验证请求已失效、已使用或身份不匹配，请重新发起验证。" : "登录请求已失效或账号尚未绑定，请重新登录或联系管理员。"} extra={<Button type="primary" onClick={() => router.replace(enrollmentFlow && isAuthenticated ? "/profile" : "/login")}>{enrollmentFlow && isAuthenticated ? "返回个人中心" : "返回登录"}</Button>} />;
  if (reset) return <MfaResetPage targetId={reset.targetId} callbackUrl={reset.callbackUrl} />;
  return <BootstrapScreen description="正在验证登录身份..." />;
}
