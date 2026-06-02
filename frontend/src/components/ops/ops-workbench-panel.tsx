"use client";

import type { CSSProperties, ReactNode } from "react";

export function OpsWorkbenchPanel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={["ops-workbench-panel", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}
