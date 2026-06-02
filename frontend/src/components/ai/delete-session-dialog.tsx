"use client";

import { Space, Typography } from "antd";
import { OpsConfirmModal, OpsStatusTag } from "@/components/ops";

export interface AiDeleteSessionTarget {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export function AiDeleteSessionDialog({
  open,
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  target: AiDeleteSessionTarget | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <OpsConfirmModal
      title="删除会话"
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText="删除会话"
      cancelText="取消"
      danger
      loading={loading}
      description="此操作会永久删除该会话的对话记录。删除后无法恢复，建议仅删除已结束或无价值的会话。"
    >
      {target ? (
        <Space orientation="vertical" size={6} style={{ width: "100%", marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <Typography.Text strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {target.title || target.id}
            </Typography.Text>
            <OpsStatusTag tone="info">{target.messageCount} 条消息</OpsStatusTag>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最近更新：{new Date(target.updatedAt).toLocaleString("zh-CN", { hour12: false })}
          </Typography.Text>
        </Space>
      ) : (
        <Typography.Text type="secondary">未选择会话</Typography.Text>
      )}
    </OpsConfirmModal>
  );
}
