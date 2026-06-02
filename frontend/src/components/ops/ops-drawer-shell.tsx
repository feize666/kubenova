"use client";

import { Drawer } from "antd";
import type { DrawerProps } from "antd";
import type { CSSProperties, ReactNode } from "react";

export type OpsDrawerShellProps = Omit<DrawerProps, "children"> & {
  children: ReactNode;
  bodyClassName?: string;
  variant?: "detail" | "editor" | "workbench" | "business";
  widthPx?: number;
};

export function OpsDrawerShell({
  children,
  className,
  classNames,
  styles,
  bodyClassName,
  variant = "detail",
  widthPx = 960,
  ...props
}: OpsDrawerShellProps) {
  const semanticClassNames =
    typeof classNames === "function" ? {} : (classNames as Record<string, string | undefined> | undefined);
  const semanticStyles =
    typeof styles === "function" ? {} : (styles as Record<string, CSSProperties | undefined> | undefined);

  return (
    <Drawer
      {...props}
      className={["ops-drawer-shell", `ops-drawer-shell--${variant}`, className].filter(Boolean).join(" ")}
      classNames={{
        ...semanticClassNames,
        wrapper: ["ops-drawer-shell__wrapper", semanticClassNames?.wrapper].filter(Boolean).join(" "),
        body: [bodyClassName, semanticClassNames?.body].filter(Boolean).join(" "),
      }}
      styles={{
        ...semanticStyles,
        wrapper: {
          width: `min(100vw, ${widthPx}px, max(50vw, 720px))`,
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
    >
      {children}
    </Drawer>
  );
}
