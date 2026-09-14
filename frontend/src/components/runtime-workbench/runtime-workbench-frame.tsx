import type { ReactNode } from "react";

export type RuntimeWorkbenchFrameProps = {
  context?: ReactNode;
  controls?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Shared, viewport-filling frame for log and terminal workbenches. */
export function RuntimeWorkbenchFrame({
  context,
  controls,
  status,
  children,
  className = "",
}: RuntimeWorkbenchFrameProps) {
  return (
    <section className={`runtime-workbench-frame ${className}`.trim()}>
      {context ? <div className="runtime-workbench-frame__context">{context}</div> : null}
      {controls ? <div className="runtime-workbench-frame__controls">{controls}</div> : null}
      {status ? <div className="runtime-workbench-frame__status">{status}</div> : null}
      <div className="runtime-workbench-frame__stage">{children}</div>
    </section>
  );
}
