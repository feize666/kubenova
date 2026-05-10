"use client";

import { WarningOutlined } from "@ant-design/icons";
import { Modal, Space, Tag, Typography } from "antd";

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
    <Modal
      title="删除会话"
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText="删除会话"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      confirmLoading={loading}
      maskClosable={false}
      width={520}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(250, 173, 20, 0.08)",
          border: "1px solid rgba(250, 173, 20, 0.25)",
          marginBottom: 12,
        }}
      >
        <WarningOutlined style={{ color: "#faad14", fontSize: 18, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <Typography.Text strong>此操作会永久删除该会话的对话记录。</Typography.Text>
          <Typography.Paragraph style={{ margin: "6px 0 0", color: "rgba(0,0,0,0.65)" }}>
            删除后无法恢复。建议仅删除已结束或无价值的会话。
          </Typography.Paragraph>
        </div>
      </div>

      {target ? (
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <Typography.Text strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {target.title || target.id}
            </Typography.Text>
            <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
              {target.messageCount} 条消息
            </Tag>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最近更新：{new Date(target.updatedAt).toLocaleString("zh-CN", { hour12: false })}
          </Typography.Text>
        </Space>
      ) : (
        <Typography.Text type="secondary">未选择会话</Typography.Text>
      )}
    </Modal>
  );
}

