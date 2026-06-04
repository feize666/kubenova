"use client";

import { Button, Divider, Space, Typography } from "antd";
import type { ReactNode } from "react";

export function OpsPopoverPanel({
  title,
  subtitle,
  children,
  onReset,
  onApply,
  resetText = "重置",
  applyText = "应用",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onReset?: () => void;
  onApply?: () => void;
  resetText?: string;
  applyText?: string;
  className?: string;
}) {
  return (
    <div className={["ops-popover-panel", className].filter(Boolean).join(" ")}>
      <div className="ops-popover-panel__header">
        <Typography.Text strong>{title}</Typography.Text>
        {subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : null}
      </div>
      <div className="ops-popover-panel__body">{children}</div>
      {(onReset || onApply) ? (
        <>
          <Divider className="ops-popover-panel__divider" />
          <Space className="ops-popover-panel__footer">
            {onReset ? <Button onClick={onReset}>{resetText}</Button> : null}
            {onApply ? (
              <Button type="primary" onClick={onApply}>
                {applyText}
              </Button>
            ) : null}
          </Space>
        </>
      ) : null}
    </div>
  );
}
