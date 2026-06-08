"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";
import { OpsIconActionButton } from "@/components/ops";

type ResourceAddButtonProps = Omit<ButtonProps, "children" | "type" | "icon"> & {
  label?: ReactNode;
  compact?: boolean;
};

function normalizeAddTooltip(text: string): string {
  const value = text.trim();
  if (!value) return "创建资源";
  if (value.startsWith("新增")) {
    return `创建${value.slice(2).trim()}`;
  }
  return value;
}

export function ResourceAddButton({
  label = "+",
  compact = true,
  style,
  ...props
}: ResourceAddButtonProps) {
  const rawTooltipTitle =
    typeof props.title === "string" && props.title.trim().length > 0
      ? props.title
      : typeof props["aria-label"] === "string" && props["aria-label"].trim().length > 0
        ? props["aria-label"]
        : `创建${compact ? "" : "资源"}`;
  const tooltipTitle = normalizeAddTooltip(rawTooltipTitle);

  const button = (
    <OpsIconActionButton
      {...props}
      opsVariant="primary"
      opsTone="primary"
      icon={<PlusOutlined />}
      style={style}
      className={["resource-add-button", compact ? "resource-add-button--compact" : "", props.className]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      {compact ? null : label}
    </OpsIconActionButton>
  );

  return <Tooltip title={tooltipTitle}>{button}</Tooltip>;
}
