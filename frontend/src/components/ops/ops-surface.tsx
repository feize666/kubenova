"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type OpsSurfaceVariant = "panel" | "raised" | "flat" | "toolbar" | "workbench" | "code" | "danger";
export type OpsSurfacePadding = "none" | "xs" | "sm" | "md" | "lg";

export type OpsSurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside" | "header";
  variant?: OpsSurfaceVariant;
  padding?: OpsSurfacePadding;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  signal?: boolean;
  style?: CSSProperties;
};

export function OpsSurface({
  as: Component = "div",
  actions,
  children,
  className,
  footer,
  padding = "md",
  signal = false,
  subtitle,
  title,
  variant = "panel",
  ...props
}: OpsSurfaceProps) {
  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <Component
      {...props}
      className={[
        "ops-surface",
        `ops-surface--${variant}`,
        `ops-surface--pad-${padding}`,
        signal ? "kn-signal-line" : undefined,
        className,
      ].filter(Boolean).join(" ")}
    >
      {hasHeader ? (
        <div className="ops-surface__header">
          <div className="ops-surface__title-group">
            {title ? <div className="ops-surface__title">{title}</div> : null}
            {subtitle ? <div className="ops-surface__subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="ops-surface__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ops-surface__body">{children}</div>
      {footer ? <div className="ops-surface__footer">{footer}</div> : null}
    </Component>
  );
}

export function OpsPanel(props: Omit<OpsSurfaceProps, "variant">) {
  return <OpsSurface {...props} variant="panel" />;
}

export function OpsRaisedPanel(props: Omit<OpsSurfaceProps, "variant">) {
  return <OpsSurface {...props} variant="raised" />;
}

export function OpsWorkbenchSurface(props: Omit<OpsSurfaceProps, "variant">) {
  return <OpsSurface {...props} variant="workbench" />;
}
