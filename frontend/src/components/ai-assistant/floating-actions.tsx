"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Collapse, Space } from "antd";
import { OpsConfirmModal } from "@/components/ops/ops-confirm-modal";
import {
  executeAction, normalizeAiAssistantActionOperation, previewAction,
  type AiActionDescriptor, type AiActionExecuteRequest, type AiActionExecutionResult,
} from "@/lib/api/ai-assistant";

/** Actions remain explicit user gestures; model output never dispatches writes. */
export function FloatingActions({ descriptors, token, sessionId, clusterId, namespace }: {
  descriptors: AiActionDescriptor[];
  token: string;
  sessionId?: string;
  clusterId?: string;
  namespace?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; details?: string }>();
  const [pending, setPending] = useState<{
    label: string; action: AiActionExecuteRequest; approvalId: string; expiresAt?: string;
    rollback?: string; previewResult?: AiActionExecutionResult["result"];
  }>();
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    generation.current += 1;
    setPending(undefined);
    setNotice(undefined);
    return () => { generation.current += 1; };
  }, [token, sessionId, clusterId, namespace]);

  async function run(action: AiActionExecuteRequest, approvalId?: string) {
    const result = await executeAction(action, token, approvalId);
    return {
      error: result.status !== "success",
      text: `${result.status === "success" ? "操作执行成功" : "操作执行失败"}：${result.error?.message ?? result.operation} · 请求 ID：${result.requestId}`,
      details: result.result?.length ? JSON.stringify(result.result, null, 2) : undefined,
    };
  }

  async function start(descriptor: AiActionDescriptor) {
    if (locked.current || pending || !token) return;
    const operation = normalizeAiAssistantActionOperation(descriptor.operation);
    if (!operation) return;
    const action: AiActionExecuteRequest = {
      operation, sessionId, options: descriptor.options,
      target: { ...descriptor.target,
        clusterId: descriptor.target?.clusterId ?? clusterId,
        namespace: descriptor.target?.namespace ?? descriptor.options?.namespace ?? namespace },
    };
    const version = generation.current;
    locked.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      if (operation.startsWith("query-")) {
        const result = await run(action);
        if (version === generation.current) setNotice(result);
      } else {
        const preview = await previewAction(action, token);
        if (preview.status !== "ok" || !preview.approvalId) throw new Error(preview.error?.message ?? "无法生成操作预览，请重试");
        if (version === generation.current) setPending({ label: descriptor.label, action,
          approvalId: preview.approvalId, expiresAt: preview.expiresAt, rollback: preview.rollbackSuggestion,
          previewResult: preview.result });
      }
    } catch (error) {
      if (version === generation.current) setNotice({ error: true, text: error instanceof Error ? error.message : "操作失败" });
    } finally { locked.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!pending || locked.current) return;
    const confirmed = pending;
    const version = generation.current;
    if (confirmed.expiresAt && (!Number.isFinite(Date.parse(confirmed.expiresAt)) || Date.parse(confirmed.expiresAt) <= Date.now())) {
      setPending(undefined);
      setNotice({ error: true, text: "操作确认已过期，请重新预览" });
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      const result = await run(confirmed.action, confirmed.approvalId);
      if (version === generation.current) setNotice(result);
    } catch (error) {
      if (version === generation.current) setNotice({ error: true, text: error instanceof Error ? error.message : "操作失败" });
    } finally {
      if (version === generation.current) setPending(undefined);
      locked.current = false; setBusy(false);
    }
  }

  const actions = descriptors.filter(item => item.kind === "resource-operation" && normalizeAiAssistantActionOperation(item.operation));
  if (!actions.length) return null;
  return <Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
    <Space wrap>{actions.map(item => <Button key={item.id} disabled={busy || Boolean(pending) || !token}
      onClick={() => void start(item)}>{item.label}</Button>)}</Space>
    {notice ? <Alert showIcon type={notice.error ? "error" : "success"} message={notice.text} /> : null}
    {notice?.details ? <Collapse size="small" items={[{ key: "result", label: "查看操作结果",
      children: <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{notice.details}</pre> }]} /> : null}
    {pending ? <OpsConfirmModal open title="确认 AI 操作" okText="确认执行" loading={busy}
      description={pending?.label} danger onCancel={() => { if (!busy) setPending(undefined); }} onOk={() => confirm()}>
      <p>请核对操作目标和参数。取消不会执行，确认仅适用于本次操作。</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "40vh", overflow: "auto" }}>
        {pending ? JSON.stringify(pending.action, null, 2) : ""}
      </pre>
      {pending?.previewResult?.length ? <Collapse size="small" items={[{ key: "preview", label: "查看服务端预览结果",
        children: <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify(pending.previewResult, null, 2)}</pre> }]} /> : null}
      {pending?.rollback ? <p>恢复建议：{pending.rollback}</p> : null}
    </OpsConfirmModal> : null}
  </Space>;
}
