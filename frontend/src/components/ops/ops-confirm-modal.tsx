"use client";

import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Alert, Input, Modal, Typography } from "antd";
import type { ModalFuncProps } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";

export type OpsConfirmOptions = {
  title: ReactNode;
  description?: ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  impact?: ReactNode;
  error?: ReactNode;
  requiredText?: string;
  onOk?: () => void | Promise<void>;
};

export type OpsConfirmModalProps = OpsConfirmOptions & {
  open: boolean;
  children?: ReactNode;
  className?: string;
  loading?: boolean;
  onCancel: () => void;
};

function OpsConfirmContent({
  danger,
  description,
  error,
  impact,
  requiredText,
  value,
  onValueChange,
}: {
  description?: ReactNode;
  danger?: boolean;
  impact?: ReactNode;
  error?: ReactNode;
  requiredText?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  if (!description && !impact && !error && !requiredText) return null;
  return (
    <div className="ops-confirm-content-stack">
      {description ? (
        <div className={["ops-confirm-content", danger ? "ops-confirm-content--danger" : ""].filter(Boolean).join(" ")}>
          <ExclamationCircleOutlined className="ops-confirm-content__icon" />
          <Typography.Paragraph className="ops-confirm-content__text">{description}</Typography.Paragraph>
        </div>
      ) : null}
      {impact ? <div className="ops-confirm-content__impact">{impact}</div> : null}
      {requiredText ? (
        <div className="ops-confirm-content__required">
          <Typography.Text type="secondary">输入 {requiredText} 以确认操作</Typography.Text>
          <Input
            aria-label={`输入 ${requiredText} 以确认操作`}
            value={value}
            onChange={(event) => onValueChange?.(event.target.value)}
          />
        </div>
      ) : null}
      {error ? <Alert className="ops-confirm-state-alert" type="error" showIcon title={error} /> : null}
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
  error,
  impact,
  requiredText,
  children,
  className,
  loading,
  onCancel,
  onOk,
}: OpsConfirmModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const confirmTextMatched = !requiredText || confirmText === requiredText;

  return (
    <Modal
      className={["ops-confirm-modal", className].filter(Boolean).join(" ")}
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ danger, disabled: !confirmTextMatched }}
      confirmLoading={loading}
      mask={{ closable: false }}
      width={520}
    >
      <OpsConfirmContent
        description={description}
        danger={danger}
        error={error}
        impact={impact}
        requiredText={requiredText}
        value={confirmText}
        onValueChange={setConfirmText}
      />
      {children}
    </Modal>
  );
}

export function openOpsConfirm(options: OpsConfirmOptions) {
  let confirmValue = "";
  let modalRef: ReturnType<typeof Modal.confirm> | null = null;
  const updateConfirmText = (value: string) => {
    confirmValue = value;
    modalRef?.update({
      okButtonProps: {
        danger: options.danger,
        disabled: Boolean(options.requiredText && confirmValue !== options.requiredText),
      },
    });
  };
  const modalOptions: ModalFuncProps = {
    title: options.title,
    content: (
      <OpsConfirmContent
        description={options.description}
        danger={options.danger}
        error={options.error}
        impact={options.impact}
        requiredText={options.requiredText}
        value={confirmValue}
        onValueChange={updateConfirmText}
      />
    ),
    okText: options.okText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    okButtonProps: {
      danger: options.danger,
      disabled: Boolean(options.requiredText),
    },
    onOk: options.onOk,
    className: "ops-confirm-modal",
    width: 520,
  };
  modalRef = Modal.confirm(modalOptions);
}
