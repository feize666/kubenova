"use client";

import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";

export function renderOpsActionTriggerButton({
  className,
  ariaLabel = "更多操作",
  icon,
}: {
  className?: string;
  ariaLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Button
      size="small"
      className={["ops-action-trigger", className].filter(Boolean).join(" ")}
      icon={icon ?? <MoreOutlined />}
      aria-label={ariaLabel}
    />
  );
}

export function OpsActionDropdown({
  items,
  onClick,
  ariaLabel = "更多操作",
  className,
  trigger,
  placement = "bottomRight",
}: {
  items: NonNullable<MenuProps["items"]>;
  onClick?: NonNullable<MenuProps["onClick"]>;
  ariaLabel?: string;
  className?: string;
  trigger?: ReactNode;
  placement?: "bottomLeft" | "bottom" | "bottomRight" | "topLeft" | "top" | "topRight";
}) {
  return (
    <Dropdown
      trigger={["click"]}
      placement={placement}
      classNames={{ root: ["ops-action-dropdown", className].filter(Boolean).join(" ") }}
      menu={{ items, onClick }}
    >
      {trigger ?? renderOpsActionTriggerButton({ ariaLabel })}
    </Dropdown>
  );
}
