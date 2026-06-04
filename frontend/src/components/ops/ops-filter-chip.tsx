"use client";

import { Tag } from "antd";
import type { TagProps } from "antd";
import type { ReactNode } from "react";

export type OpsFilterChipTone = "info" | "neutral" | "success" | "warning" | "danger";

const TONE_CLASS: Record<OpsFilterChipTone, string> = {
  info: "ops-filter-chip--info",
  neutral: "ops-filter-chip--neutral",
  success: "ops-filter-chip--success",
  warning: "ops-filter-chip--warning",
  danger: "ops-filter-chip--danger",
};

export function OpsFilterChip({
  tone = "info",
  className,
  children,
  ...props
}: Omit<TagProps, "color"> & {
  tone?: OpsFilterChipTone;
  children: ReactNode;
}) {
  return (
    <Tag {...props} className={["ops-filter-chip", TONE_CLASS[tone], className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}
