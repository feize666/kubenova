"use client";

import { CloseOutlined } from "@ant-design/icons";
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";

export type OpsFilterChipTone = "info" | "neutral" | "success" | "warning" | "danger";

const TONE_CLASS: Record<OpsFilterChipTone, string> = {
  info: "ops-filter-chip--info",
  neutral: "ops-filter-chip--neutral",
  success: "ops-filter-chip--success",
  warning: "ops-filter-chip--warning",
  danger: "ops-filter-chip--danger",
};

export type OpsFilterChipProps = Omit<ComponentPropsWithoutRef<"span">, "color" | "onClose"> & {
  tone?: OpsFilterChipTone;
  children: ReactNode;
  icon?: ReactNode;
  closable?: boolean;
  onClose?: (event: MouseEvent<HTMLButtonElement>) => void;
  closeLabel?: string;
  bordered?: boolean;
  disabled?: boolean;
};

export function OpsFilterChip({
  tone = "info",
  className,
  children,
  icon,
  closable,
  closeLabel = "移除",
  disabled,
  onClose,
  bordered = true,
  ...props
}: OpsFilterChipProps) {
  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose?.(event);
  };

  return (
    <span
      {...props}
      className={[
        "ops-filter-chip",
        TONE_CLASS[tone],
        bordered === false ? "ops-filter-chip--borderless" : undefined,
        disabled ? "ops-filter-chip--disabled" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      aria-disabled={disabled || undefined}
    >
      {icon ? <span className="ops-filter-chip__icon">{icon}</span> : null}
      {children}
      {closable ? (
        <button
          type="button"
          className="ops-filter-chip__close"
          aria-label={closeLabel}
          disabled={disabled}
          onClick={handleClose}
        >
          <CloseOutlined />
        </button>
      ) : null}
    </span>
  );
}
