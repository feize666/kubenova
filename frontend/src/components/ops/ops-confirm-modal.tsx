"use client";

import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Modal, Typography } from "antd";
import type { ModalFuncProps } from "antd";
import type { ReactNode } from "react";

export type OpsConfirmOptions = {
  title: ReactNode;
  description?: ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onOk?: () => void | Promise<void>;
};

export type OpsConfirmModalProps = OpsConfirmOptions & {
  open: boolean;
  children?: ReactNode;
  loading?: boolean;
  onCancel: () => void;
};

function OpsConfirmContent({ description, danger }: { description?: ReactNode; danger?: boolean }) {
  if (!description) return null;
  return (
    <div className={["ops-confirm-content", danger ? "ops-confirm-content--danger" : ""].filter(Boolean).join(" ")}>
      <ExclamationCircleOutlined className="ops-confirm-content__icon" />
      <Typography.Paragraph className="ops-confirm-content__text">{description}</Typography.Paragraph>
    </div>
  );
}

export function OpsConfirmModal({
  open,
  title,
  description,
  okText = "确认",
  cancelText = "取消",
  danger = false,
  children,
  loading,
  onCancel,
  onOk,
}: OpsConfirmModalProps) {
  return (
    <Modal
      className="ops-confirm-modal"
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ danger }}
      confirmLoading={loading}
      mask={{ closable: false }}
      width={520}
    >
      <OpsConfirmContent description={description} danger={danger} />
      {children}
    </Modal>
  );
}

export function openOpsConfirm(options: OpsConfirmOptions) {
  const modalOptions: ModalFuncProps = {
    title: options.title,
    content: <OpsConfirmContent description={options.description} danger={options.danger} />,
    okText: options.okText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    okButtonProps: options.danger ? { danger: true } : undefined,
    onOk: options.onOk,
    className: "ops-confirm-modal",
    width: 520,
  };
  Modal.confirm(modalOptions);
}
