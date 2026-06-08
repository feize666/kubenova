"use client";

import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";

type OpsActionDropdownItem = NonNullable<MenuProps["items"]>[number];

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

function withDisabledReason(
  item: OpsActionDropdownItem,
  disabledReasonByKey?: Record<string, ReactNode>,
): OpsActionDropdownItem {
  if (!item || !disabledReasonByKey || typeof item !== "object") {
    return item;
  }

  const record = item as unknown as Record<string, unknown>;
  const children = Array.isArray(record.children)
    ? (record.children as OpsActionDropdownItem[]).map((child) => withDisabledReason(child, disabledReasonByKey))
    : undefined;
  const key = record.key === null || record.key === undefined ? "" : String(record.key);
  const reason = key ? disabledReasonByKey[key] : undefined;
  const label = record.label as ReactNode;

  return {
    ...item,
    ...(children ? { children } : {}),
    ...(reason
      ? {
          title: typeof reason === "string" ? reason : undefined,
          label: (
            <span className="ops-action-dropdown__item-copy">
              <span className="ops-action-dropdown__item-label">{label}</span>
              <span className="ops-action-dropdown__item-reason">{reason}</span>
            </span>
          ),
        }
      : {}),
  } as OpsActionDropdownItem;
}

export function OpsActionDropdown({
  items,
  onClick,
  ariaLabel = "更多操作",
  className,
  trigger,
  placement = "bottomRight",
  disabledReasonByKey,
}: {
  items: NonNullable<MenuProps["items"]>;
  onClick?: NonNullable<MenuProps["onClick"]>;
  ariaLabel?: string;
  className?: string;
  trigger?: ReactNode;
  placement?: "bottomLeft" | "bottom" | "bottomRight" | "topLeft" | "top" | "topRight";
  disabledReasonByKey?: Record<string, ReactNode>;
}) {
  const menuItems = disabledReasonByKey
    ? items.map((item) => withDisabledReason(item, disabledReasonByKey))
    : items;

  return (
    <Dropdown
      trigger={["click"]}
      placement={placement}
      classNames={{ root: ["ops-action-dropdown", className].filter(Boolean).join(" ") }}
      menu={{ items: menuItems, onClick, selectable: false }}
    >
      {trigger ?? renderOpsActionTriggerButton({ ariaLabel })}
    </Dropdown>
  );
}
