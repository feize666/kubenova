"use client";

import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";

import { OpsStatusTag, type OpsStatusTone } from "./ops-status";

export type OpsMobileResourceCardMeta = {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
};

export type OpsMobileResourceCardProps = Omit<HTMLAttributes<HTMLElement>, "onSelect" | "title"> & {
  actions?: ReactNode;
  cluster?: ReactNode;
  disabled?: boolean;
  footer?: ReactNode;
  meta?: OpsMobileResourceCardMeta[];
  namespace?: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  status?: ReactNode;
  statusState?: string;
  statusTone?: OpsStatusTone;
  subtitle?: ReactNode;
  title: ReactNode;
};

function stopNavigation(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function OpsMobileResourceCard({
  actions,
  children,
  className,
  cluster,
  disabled = false,
  footer,
  meta,
  namespace,
  onClick,
  onKeyDown,
  onMouseDown,
  onSelect,
  selected = false,
  status,
  statusState,
  statusTone,
  subtitle,
  title,
  ...props
}: OpsMobileResourceCardProps) {
  const interactive = Boolean(onSelect);
  const metadata: OpsMobileResourceCardMeta[] = [
    ...(namespace ? [{ label: "命名空间", value: namespace }] : []),
    ...(cluster ? [{ label: "集群", value: cluster }] : []),
    ...(meta ?? []),
  ];

  function handleClick(event: MouseEvent<HTMLElement>) {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;
    onSelect?.();
  }

  function handleMouseDown(event: MouseEvent<HTMLElement>) {
    onMouseDown?.(event);
    if (disabled) event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || !onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <article
      {...props}
      aria-disabled={disabled || undefined}
      aria-pressed={interactive ? selected : undefined}
      className={[
        "ops-mobile-resource-card",
        selected ? "is-selected" : undefined,
        disabled ? "is-disabled" : undefined,
        interactive ? "is-interactive" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      data-ops-mobile-resource-card=""
      data-selected={selected ? "true" : "false"}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
    >
      <div className="ops-mobile-resource-card__header">
        <div className="ops-mobile-resource-card__identity">
          <div className="ops-mobile-resource-card__title">{title}</div>
          {subtitle ? <div className="ops-mobile-resource-card__subtitle">{subtitle}</div> : null}
        </div>
        <div className="ops-mobile-resource-card__status">
          {status ?? (statusState || statusTone ? <OpsStatusTag state={statusState} tone={statusTone} /> : null)}
        </div>
        {actions ? (
          <div
            className="ops-mobile-resource-card__actions"
            data-resource-table-stop-navigation="true"
            onClick={stopNavigation}
            onMouseDown={stopNavigation}
          >
            {actions}
          </div>
        ) : null}
      </div>

      {metadata.length > 0 ? (
        <dl className="ops-mobile-resource-card__meta" aria-label="资源元数据">
          {metadata.map((item, index) => (
            <div className="ops-mobile-resource-card__meta-item" key={index}>
              {item.icon ? (
                <span className="ops-mobile-resource-card__meta-icon" aria-hidden>
                  {item.icon}
                </span>
              ) : null}
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children ? <div className="ops-mobile-resource-card__body">{children}</div> : null}
      {footer ? <div className="ops-mobile-resource-card__footer">{footer}</div> : null}
    </article>
  );
}
