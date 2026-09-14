import type { ReactNode } from "react";

export function RuntimeContextBar({ children }: { children: ReactNode }) {
  return <div className="runtime-context-bar">{children}</div>;
}
