"use client";

import { Modal } from "antd";
import type { ModalProps } from "antd";
import type { ReactNode } from "react";
import { OpsFilterChip } from "./ops-filter-chip";

export type OpsModalShellProps = Omit<ModalProps, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  identity?: ReactNode;
  impact?: ReactNode;
  footerActions?: ReactNode;
};

export type OpsFormSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function OpsModalShell({
  children,
  className,
  description,
  footerActions,
  identity,
  impact,
  title,
  ...props
}: OpsModalShellProps) {
  return (
    <Modal
      {...props}
      className={["ops-modal-shell", className].filter(Boolean).join(" ")}
      title={(
        <div className="ops-modal-shell__heading">
          <div className="ops-modal-shell__title-row">
            <span className="ops-modal-shell__title">{title}</span>
            {identity ? <OpsFilterChip tone="neutral">{identity}</OpsFilterChip> : null}
          </div>
          {description ? <div className="ops-modal-shell__description">{description}</div> : null}
        </div>
      )}
      footer={footerActions ? <div className="ops-modal-shell__footer-actions">{footerActions}</div> : props.footer}
    >
      {impact ? <div className="ops-modal-shell__impact">{impact}</div> : null}
      <div className="ops-modal-shell__body">{children}</div>
    </Modal>
  );
}

export function OpsFormSection({
  children,
  className,
  description,
  title,
}: OpsFormSectionProps) {
  return (
    <section className={["ops-form-section", className].filter(Boolean).join(" ")}>
      <div className="ops-form-section__header">
        <div className="ops-form-section__title">{title}</div>
        {description ? <div className="ops-form-section__description">{description}</div> : null}
      </div>
      <div className="ops-form-section__body">{children}</div>
    </section>
  );
}
