"use client";

import { Alert, Button, Checkbox, Typography } from "antd";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export function MfaRecovery() {
  const { recoveryCodes, finishRecovery } = useAuth();
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  return <main style={{ maxWidth: 640, margin: "48px auto", padding: 24, color: "var(--ops-text-primary)" }}>
    <Typography.Title level={2}>保存恢复码</Typography.Title>
    <Alert type="success" showIcon title="多因素验证已启用，所有会话已退出。" />
    <Typography.Paragraph style={{ marginTop: 24 }}>恢复码仅显示这一次。请保存在安全的位置；每个恢复码只能使用一次。刷新或关闭页面后无法再次查看。</Typography.Paragraph>
    <ul style={{ paddingLeft: 24, fontFamily: "monospace", overflowWrap: "anywhere", lineHeight: 2.2 }}>
      {recoveryCodes?.map(code => <li key={code}>{code}</li>)}
    </ul>
    <Checkbox checked={saved} onChange={event => setSaved(event.target.checked)}>我已安全保存恢复码</Checkbox>
    <div style={{ marginTop: 24 }}><Button type="primary" disabled={!saved} onClick={() => { finishRecovery(); router.replace("/login"); }}>完成并重新登录</Button></div>
  </main>;
}
