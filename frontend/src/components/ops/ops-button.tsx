"use client";

import { Button } from "antd";
import type { ButtonProps } from "antd";

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
