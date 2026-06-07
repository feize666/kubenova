"use client";

import type { CSSProperties, ReactNode } from "react";

export type OpsFrameShellState =
  | "idle"
  | "loading"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "streaming"
  | "paused"
  | "disconnected"
  | "expired"
  | "error";

export type OpsFrameShellProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  toolbar?: ReactNode;
  chips?: ReactNode;
  warning?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  state?: OpsFrameShellState;
};

export function OpsFrameShell({
  title,
  subtitle,
  status,
  toolbar,
  chips,
  warning,
  error,
  children,
  className,
  bodyClassName,
  style,
  state = "idle",
}: OpsFrameShellProps) {
  return (
    <section
      className={["ops-frame-shell", `ops-frame-shell--${state}`, className].filter(Boolean).join(" ")}
      style={style}
    >
      {(title || subtitle || status || toolbar) ? (
        <header className="ops-frame-shell__header">
          <div className="ops-frame-shell__title-group">
            {title ? <div className="ops-frame-shell__title">{title}</div> : null}
            {subtitle ? <div className="ops-frame-shell__subtitle">{subtitle}</div> : null}
          </div>
          {(status || toolbar) ? (
            <div className="ops-frame-shell__actions">
              {status ? <div className="ops-frame-shell__status">{status}</div> : null}
              {toolbar ? <div className="ops-frame-shell__toolbar">{toolbar}</div> : null}
            </div>
          ) : null}
        </header>
      ) : null}
      {chips ? <div className="ops-frame-shell__chips">{chips}</div> : null}
      {warning ? <div className="ops-frame-shell__notice ops-frame-shell__notice--warning">{warning}</div> : null}
      {error ? <div className="ops-frame-shell__notice ops-frame-shell__notice--error">{error}</div> : null}
      <div className={["ops-frame-shell__body", bodyClassName].filter(Boolean).join(" ")}>
        {children}
      </div>
    </section>
  );
}
