"use client";

import type { HTMLAttributes, ReactNode } from "react";

export type OpsHaloFocusTone = "info" | "success" | "warning" | "danger" | "neutral";

export type OpsHaloFocusProps = HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  children: ReactNode;
  tone?: OpsHaloFocusTone;
};

export function OpsHaloFocus({
  active = true,
  children,
  className,
  tone = "info",
  ...props
}: OpsHaloFocusProps) {
  return (
    <div
      {...props}
      className={[
        "ops-halo-focus",
        `ops-halo-focus--${tone}`,
        active ? "is-active" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      data-active={active ? "true" : "false"}
    >
      {children}
    </div>
  );
}
