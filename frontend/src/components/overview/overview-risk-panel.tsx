import type { ReactNode } from "react";

type OverviewCardState = "ready" | "loading" | "empty" | "degraded";

export function OverviewRiskPanel({
  title,
  scope,
  children,
  action,
  className,
  state = "ready",
}: {
  title: string;
  scope?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  state?: OverviewCardState;
}) {
  const classes = [
    "ops-overview-card",
    "ops-surface",
    "ops-surface--panel",
    "ops-surface--pad-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} data-state={state} data-ops-overview-card>
      <div className="ops-overview-card__header">
        <div className="ops-overview-card__heading">
          <div className="ops-overview-card__title">{title}</div>
          {scope ? <span className="ops-overview-card__scope">{scope}</span> : null}
        </div>
        {action}
      </div>
      <div className="ops-overview-card__body">{children}</div>
    </section>
  );
}
