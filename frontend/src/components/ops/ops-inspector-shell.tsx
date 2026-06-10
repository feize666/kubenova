"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { OpsMotionFrame } from "./ops-motion-frame";
import { OpsState, type OpsStateKind } from "./ops-state";

export type OpsInspectorShellVariant = "side" | "embedded" | "floating";
export type OpsInspectorFact = {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export type OpsInspectorShellProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  facts?: OpsInspectorFact[];
  footer?: ReactNode;
  motion?: boolean;
  state?: OpsStateKind | "idle";
  stateAction?: ReactNode;
  stateDescription?: ReactNode;
  stateTitle?: ReactNode;
  tabs?: ReactNode;
  title: ReactNode;
  variant?: OpsInspectorShellVariant;
};

export function OpsInspectorShell({
  actions,
  children,
  className,
  description,
  facts,
  footer,
  motion = true,
  state = "idle",
  stateAction,
  stateDescription,
  stateTitle,
  tabs,
  title,
  variant = "side",
  ...props
}: OpsInspectorShellProps) {
  const content = (
    <aside
      {...props}
      className={[
        "ops-inspector-shell",
        `ops-inspector-shell--${variant}`,
        `ops-inspector-shell--state-${state}`,
        className,
      ].filter(Boolean).join(" ")}
      data-ops-inspector-shell=""
    >
      <header className="ops-inspector-shell__header">
        <div className="ops-inspector-shell__heading">
          <div className="ops-inspector-shell__title">{title}</div>
          {description ? <div className="ops-inspector-shell__description">{description}</div> : null}
        </div>
        {actions ? <div className="ops-inspector-shell__actions">{actions}</div> : null}
      </header>
      {tabs ? <div className="ops-inspector-shell__tabs">{tabs}</div> : null}
      {facts?.length ? (
        <dl className="ops-inspector-shell__facts" aria-label="详情事实">
          {facts.map((fact, index) => (
            <div
              // Fact values often come from dynamic Kubernetes fields and may repeat.
              key={index}
              className={[
                "ops-inspector-shell__fact",
                `ops-inspector-shell__fact--${fact.tone ?? "neutral"}`,
              ].join(" ")}
            >
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {state !== "idle" ? (
        <OpsState
          className="ops-inspector-shell__state"
          compact
          kind={state}
          title={stateTitle ?? "暂无详情"}
          description={stateDescription}
          action={stateAction}
        />
      ) : null}
      {children ? <div className="ops-inspector-shell__body">{children}</div> : null}
      {footer ? <footer className="ops-inspector-shell__footer">{footer}</footer> : null}
    </aside>
  );

  if (!motion) {
    return content;
  }

  return (
    <OpsMotionFrame kind="slide-left" duration="base" stable className="ops-inspector-shell__motion">
      {content}
    </OpsMotionFrame>
  );
}
