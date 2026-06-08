"use client";

import { Drawer } from "antd";
import type { DrawerProps } from "antd";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { OpsState, type OpsStateKind } from "./ops-state";

export type OpsDrawerShellProps = Omit<DrawerProps, "children"> & {
  children: ReactNode;
  bodyClassName?: string;
  state?: OpsStateKind | "idle";
  stateDescription?: ReactNode;
  stateTitle?: ReactNode;
  variant?: "resource" | "detail" | "editor" | "workbench" | "business";
  widthPx?: number;
  footerActions?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const VARIANT_WIDTH: Record<NonNullable<OpsDrawerShellProps["variant"]>, number> = {
  resource: 960,
  detail: 960,
  business: 840,
  editor: 1040,
  workbench: 1180,
};

export function OpsDrawerShell({
  children,
  className,
  classNames,
  styles,
  bodyClassName,
  state = "idle",
  stateDescription,
  stateTitle,
  variant = "detail",
  widthPx,
  footerActions,
  returnFocusRef,
  afterOpenChange,
  ...props
}: OpsDrawerShellProps) {
  const semanticClassNames =
    typeof classNames === "function" ? {} : (classNames as Record<string, string | undefined> | undefined);
  const semanticStyles =
    typeof styles === "function" ? {} : (styles as Record<string, CSSProperties | undefined> | undefined);

  const resolvedWidth = widthPx ?? VARIANT_WIDTH[variant];

  return (
    <Drawer
      {...props}
      className={["ops-drawer-shell", `ops-drawer-shell--${variant}`, `ops-drawer-shell--state-${state}`, footerActions ? "ops-drawer-shell--has-footer" : undefined, className].filter(Boolean).join(" ")}
      classNames={{
        ...semanticClassNames,
        wrapper: ["ops-drawer-shell__wrapper", semanticClassNames?.wrapper].filter(Boolean).join(" "),
        header: ["ops-drawer-shell__header", semanticClassNames?.header].filter(Boolean).join(" "),
        body: [bodyClassName, semanticClassNames?.body].filter(Boolean).join(" "),
        footer: ["ops-drawer-shell__footer", semanticClassNames?.footer].filter(Boolean).join(" "),
      }}
      styles={{
        ...semanticStyles,
        wrapper: {
          width: `min(100vw, ${resolvedWidth}px, max(50vw, 720px))`,
          maxWidth: "none",
          ...semanticStyles?.wrapper,
        },
        body: {
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
          ...semanticStyles?.body,
        },
      }}
      footer={footerActions ? <div className="ops-drawer-shell__footer-actions">{footerActions}</div> : props.footer}
      afterOpenChange={(nextOpen) => {
        afterOpenChange?.(nextOpen);
        if (!nextOpen) {
          returnFocusRef?.current?.focus?.();
        }
      }}
    >
      {state !== "idle" && (stateTitle || stateDescription) ? (
        <OpsState
          className="ops-drawer-shell__state"
          compact
          kind={state}
          title={stateTitle ?? "状态更新"}
          description={stateDescription}
        />
      ) : null}
      {children}
    </Drawer>
  );
}
