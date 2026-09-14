import type { ReactNode } from "react";

export type RuntimeStatusTone =
  | "neutral"
  | "info"
  | "processing"
  | "success"
  | "warning"
  | "danger";

export function RuntimeStatusStrip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: RuntimeStatusTone;
}) {
  return (
    <div className={`runtime-status-strip runtime-status-strip--${tone}`} role="status">
      {children}
    </div>
  );
}
