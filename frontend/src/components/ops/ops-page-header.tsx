"use client";

import type { CSSProperties, ReactNode } from "react";

export type OpsPageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  scope?: ReactNode;
  freshness?: ReactNode;
  primaryAction?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  compact?: boolean;
  surface?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function OpsPageHeader({
  actions,
  className,
  compact = false,
  freshness,
  primaryAction,
  scope,
  style,
  subtitle,
  surface = true,
  tabs,
  title,
}: OpsPageHeaderProps) {
  const hasMeta = Boolean(scope || freshness);
  const hasActions = Boolean(primaryAction || actions);

  return (
    <section
      data-component="ops-page-header"
      data-density={compact ? "compact" : "default"}
      data-surface={surface ? "surface" : "embedded"}
      className={[
        "ops-page-header",
        surface ? "ops-page-header--surface" : "ops-page-header--embedded",
        compact ? "ops-page-header--compact" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <div className="ops-page-header__main">
        <div className="ops-page-header__copy">
          <h1 className="ops-page-header__title">{title}</h1>
          {subtitle ? <div className="ops-page-header__subtitle">{subtitle}</div> : null}
        </div>
        {hasActions ? (
          <div className="ops-page-header__actions">
            {actions ? <div className="ops-page-header__secondary-actions">{actions}</div> : null}
            {primaryAction ? <div className="ops-page-header__primary-action">{primaryAction}</div> : null}
          </div>
        ) : null}
      </div>
      {hasMeta ? (
        <div className="ops-page-header__meta">
          {scope ? <div className="ops-page-header__scope">{scope}</div> : null}
          {freshness ? <div className="ops-page-header__freshness">{freshness}</div> : null}
        </div>
      ) : null}
      {tabs ? <div className="ops-page-header__tabs">{tabs}</div> : null}
    </section>
  );
}
