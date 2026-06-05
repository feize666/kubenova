"use client";

import { DownOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ButtonProps } from "antd";
import { forwardRef } from "react";
import type { ReactNode } from "react";

export type OpsIconActionButtonTone = "default" | "primary" | "danger";

export function OpsIconActionButton({
  className,
  opsTone = "default",
  ...props
}: ButtonProps & { opsTone?: OpsIconActionButtonTone }) {
  return (
    <Button
      {...props}
      className={["ops-icon-action-button", `ops-icon-action-button--${opsTone}`, className].filter(Boolean).join(" ")}
    />
  );
}

export const OpsFilterTriggerButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, Omit<ButtonProps, "icon" | "value"> & {
  baseClassName?: string;
  icon: ReactNode;
  label: ReactNode;
  labelSuffix?: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  slotClassNames?: {
    lead?: string;
    icon?: string;
    copy?: string;
    label?: string;
    valueWrap?: string;
    value?: string;
    affordance?: string;
    caret?: string;
    meta?: string;
  };
}>(function OpsFilterTriggerButton({
  baseClassName = "resource-scope-filter-button",
  className,
  icon,
  label,
  labelSuffix = " /",
  value,
  meta,
  active,
  slotClassNames,
  ...props
}, ref) {
  const iconNode = (
    <span className={slotClassNames?.icon ?? "resource-scope-filter-icon"} aria-hidden>
      {icon}
    </span>
  );

  return (
    <Button
      {...props}
      ref={ref}
      className={[baseClassName, active ? "is-active" : undefined, className].filter(Boolean).join(" ")}
    >
      {slotClassNames?.lead ? <span className={slotClassNames.lead}>{iconNode}</span> : iconNode}
      <span className={slotClassNames?.copy ?? "resource-scope-filter-copy"}>
        <span className={slotClassNames?.label ?? "resource-scope-filter-field-label"}>{label}{labelSuffix}</span>
        <span className={slotClassNames?.valueWrap ?? "resource-scope-filter-value"}>
          <span className={slotClassNames?.value ?? "resource-scope-filter-summary"}>{value}</span>
        </span>
      </span>
      <span className={slotClassNames?.affordance ?? "resource-scope-filter-affordance"} aria-hidden>
        {meta ? <span className={slotClassNames?.meta ?? "resource-scope-filter-meta"}>{meta}</span> : null}
        {!meta ? <DownOutlined className={slotClassNames?.caret ?? "resource-scope-filter-caret"} aria-hidden /> : null}
      </span>
    </Button>
  );
});
