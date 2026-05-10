"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ButtonProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

type ResourceAddButtonProps = Omit<ButtonProps, "children" | "type" | "icon"> & {
  label?: ReactNode;
  compact?: boolean;
};

const buttonStyle: CSSProperties = {
  height: 28,
  borderRadius: 999,
  paddingInline: 10,
  fontWeight: 700,
  letterSpacing: 0.2,
  borderColor: "var(--topology-jump-button-border)",
  background: "var(--topology-jump-button-bg)",
  color: "var(--topology-jump-button-text)",
  boxShadow: "var(--topology-jump-button-shadow)",
};

const iconStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--topology-jump-button-icon)",
};

export function ResourceAddButton({
  label = "+",
  compact = true,
  style,
  ...props
}: ResourceAddButtonProps) {
  return (
    <Button
      {...props}
      type="default"
      icon={<PlusOutlined style={iconStyle} />}
      style={{
        ...buttonStyle,
        minWidth: compact ? 28 : undefined,
        paddingInline: compact ? 0 : 12,
        ...(style ?? {}),
      }}
      className={["resource-add-button", props.className].filter(Boolean).join(" ") || undefined}
    >
      {compact ? null : label}
    </Button>
  );
}
