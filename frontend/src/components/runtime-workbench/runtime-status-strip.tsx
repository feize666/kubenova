import type { ReactNode } from "react";
import type { OpsStatusTone } from "@/components/ops";

export type RuntimeStatusTone = OpsStatusTone;

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
