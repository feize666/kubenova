"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Result, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { MfaResetForm } from "./mfa-reset-form";
import { apiRequest } from "@/lib/api/client";
import { getMfaStatus, prepareMfaResetOidc, type MfaStatus } from "@/lib/api/mfa-reset";

export const RESET_OIDC_TARGET_KEY = "kubenova_oidc_reset_target";

export function MfaResetPage({ targetId, callbackUrl }: { targetId: string; callbackUrl?: string }) {
  const { accessToken, isInitializing, username, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<{ status: MfaStatus; target: { id: string; username: string; mfaEnabled: boolean }; oidc: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    if (!accessToken || !targetId || targetId.length > 256) return;
    void (async () => {
      const status = await getMfaStatus(accessToken);
      if (!status.canManageMfa) throw new Error("Forbidden");
      const target = await apiRequest<{ id: string; username: string; mfaEnabled: boolean }>(`/api/users/${encodeURIComponent(targetId)}`, { token: accessToken });
      if (target.id !== targetId) throw new Error("Target mismatch");
      const oidc = await apiRequest<{ enabled: boolean }>("/api/v1/auth/oidc/status").catch(() => ({ enabled: false }));
      if (active) setData({ status, target, oidc: oidc.enabled });
    })().catch(() => { if (active) setError("无法读取目标账号或没有 MFA 管理权限，请返回用户管理检查。"); });
    return () => { active = false; };
  }, [accessToken, targetId]);
  if (isInitializing) return <Spin />;
  if (!accessToken || !targetId || targetId.length > 256) return <Result status="403" title="无法验证当前会话或目标账号" />;
  return <main style={{ padding: 24, maxWidth: 720 }}>
    <Button onClick={() => router.replace("/users")} style={{ marginBottom: 24 }}>返回用户管理</Button>
    {error && <Alert type="error" showIcon title={error} />}
    {!data && !error && <Spin />}
    {data && !data.target.mfaEnabled && <Alert type="info" showIcon title="该账号尚未启用 MFA，无需重置。" />}
    {data?.target.mfaEnabled && <>
      <MfaResetForm key={`${accessToken}:${targetId}`} accessToken={accessToken} target={data.target} status={data.status} callbackUrl={callbackUrl}
        onCancel={() => router.replace("/users")}
        onDone={() => {
          if (data.target.username === username) void logout().finally(() => router.replace("/login"));
          else router.replace("/users");
        }} />
      {!callbackUrl && data.oidc && <Button loading={busy} style={{ marginTop: 20 }} onClick={async () => {
        setBusy(true); setError("");
        try {
          const result = await prepareMfaResetOidc(accessToken, targetId);
          const url = new URL(result.url);
          if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Invalid provider");
          // Routing metadata only. The server binds the target and session.
          sessionStorage.setItem(RESET_OIDC_TARGET_KEY, targetId);
          window.location.assign(url.href);
        } catch { sessionStorage.removeItem(RESET_OIDC_TARGET_KEY); setError("企业身份验证暂不可用，请重新发起。"); setBusy(false); }
      }}>通过企业账号验证身份</Button>}
    </>}
  </main>;
}
