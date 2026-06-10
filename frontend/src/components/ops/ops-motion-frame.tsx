"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type OpsMotionKind = "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale";
export type OpsMotionDuration = "fast" | "base" | "slow";

export type OpsMotionFrameProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside" | "li";
  active?: boolean;
  children: ReactNode;
  delayMs?: number;
  duration?: OpsMotionDuration;
  kind?: OpsMotionKind;
  stable?: boolean;
  style?: CSSProperties;
};

type OpsMotionStyle = CSSProperties & {
  "--ops-motion-frame-delay"?: string;
};

export function OpsMotionFrame({
  active = true,
  as: Component = "div",
  children,
  className,
  delayMs,
  duration = "base",
  kind = "fade",
  stable = false,
  style,
  ...props
}: OpsMotionFrameProps) {
  const motionStyle: OpsMotionStyle = { ...style };
  if (typeof delayMs === "number") {
    motionStyle["--ops-motion-frame-delay"] = `${Math.max(0, delayMs)}ms`;
  }

  return (
    <Component
      {...props}
      className={[
        "ops-motion-frame",
        `ops-motion-frame--${kind}`,
        `ops-motion-frame--duration-${duration}`,
        stable ? "ops-motion-frame--stable" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      data-ops-motion-frame=""
      data-state={active ? "active" : "inactive"}
      style={motionStyle}
    >
      {children}
    </Component>
  );
}
