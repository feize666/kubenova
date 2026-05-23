"use client";

import { DeleteOutlined, EditOutlined, FileTextOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Popconfirm, Space } from "antd";
import type { MenuProps } from "antd";
import { Modal } from "antd";
import type { ReactNode } from "react";

export interface ResourceActionItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  type?: "default" | "primary" | "dashed" | "link" | "text";
  size?: "small" | "middle" | "large";
  danger?: boolean;
  ghost?: boolean;
  disabled?: boolean;
  loading?: boolean;
  availability?: "available" | "unavailable";
  confirm?: {
    title: string;
    description?: string;
    okText?: string;
    cancelText?: string;
    okDanger?: boolean;
  };
}

export type ResourceMenuItem =
  | ResourceActionItem
  | {
      type: "divider";
      key?: string;
      label?: ReactNode;
      icon?: ReactNode;
      onClick?: never;
      danger?: never;
      disabled?: never;
      loading?: never;
      availability?: never;
      confirm?: never;
    };

export interface ParsedResourceSearch {
  keyword: string;
  labelExpressions: string[];
}

export type TopActionBarSlot =
  | "create"
  | "refresh"
  | "edit"
  | "yaml"
  | "scale"
  | "restart"
  | "rollback"
  | "image-update"
  | "enable-disable"
  | "terminal"
  | "logs"
  | "delete";

interface TopActionBarSlotRule {
  key: TopActionBarSlot;
  label: string;
  requiresSelection?: boolean;
  danger?: boolean;
}

export interface TopActionBarSchema {
  id: string;
  slots: TopActionBarSlotRule[];
  includeUnavailable?: boolean;
}

export const RESOURCE_ACTION_TRIGGER_CLASS = "resource-action-trigger";
export const RESOURCE_ACTION_MENU_CLASS = "resource-action-menu";
export const POD_ACTION_TRIGGER_CLASS = "pod-action-trigger";
export const POD_ACTION_MENU_CLASS = "pod-actions-dropdown";

export interface ResourceActionDropdownProps {
  actions: ResourceMenuItem[];
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  trigger?: ReactNode;
  placement?: "bottomLeft" | "bottom" | "bottomRight" | "topLeft" | "top" | "topRight";
}

export function getResourceActionIcon(actionKey: string): ReactNode | null {
  switch (normalizeActionSlot(actionKey)) {
    case "edit":
      return <EditOutlined />;
    case "yaml":
      return <FileTextOutlined />;
    case "delete":
      return <DeleteOutlined />;
    default:
      return null;
  }
}

export function buildResourceActionMenuItems(actions: ResourceMenuItem[]): NonNullable<MenuProps["items"]> {
  return actions.map((action) => {
    if ("type" in action && action.type === "divider") {
      return { type: "divider" };
    }

    return {
      key: action.key,
      icon: action.icon ?? getResourceActionIcon(action.key) ?? undefined,
      label: action.label,
      danger: action.danger,
      disabled: action.disabled,
    };
  });
}

export function openResourceActionConfirm(
  confirm: NonNullable<ResourceActionItem["confirm"]>,
  onConfirm: () => void,
) {
  Modal.confirm({
    title: confirm.title,
    content: confirm.description,
    okText: confirm.okText ?? "确认",
    cancelText: confirm.cancelText ?? "取消",
    okButtonProps: confirm.okDanger ? { danger: true } : undefined,
    onOk: onConfirm,
  });
}

function isResourceActionItem(action: ResourceMenuItem): action is ResourceActionItem {
  return !("type" in action && action.type === "divider");
}

export function renderResourceActionTriggerButton({
  className,
  ariaLabel = "更多操作",
  icon,
  baseClassName = RESOURCE_ACTION_TRIGGER_CLASS,
}: {
  className?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  baseClassName?: string;
}) {
  return (
    <Button
      size="small"
      className={[baseClassName, className].filter(Boolean).join(" ")}
      icon={icon ?? <MoreOutlined />}
      aria-label={ariaLabel}
    />
  );
}

export function renderPodLikeResourceActionStyles({
  triggerClassName = POD_ACTION_TRIGGER_CLASS,
  menuClassName = POD_ACTION_MENU_CLASS,
}: {
  triggerClassName?: string;
  menuClassName?: string;
}) {
  void triggerClassName;
  void menuClassName;
  return null;
}

export function ResourceActionDropdown({
  actions,
  ariaLabel = "更多操作",
  className,
  triggerClassName = POD_ACTION_TRIGGER_CLASS,
  menuClassName = POD_ACTION_MENU_CLASS,
  trigger,
  placement = "bottomRight",
}: ResourceActionDropdownProps) {
  const items = buildResourceActionMenuItems(actions);
  const itemActions = actions.filter(isResourceActionItem);

  return (
    <Dropdown
      trigger={["click"]}
      placement={placement}
      classNames={{ root: [className, menuClassName].filter(Boolean).join(" ") }}
      menu={{
        items,
        onClick: ({ key }) => {
          const action = itemActions.find((item) => item.key === key);
          if (!action || action.disabled) {
            return;
          }
          if (action.confirm) {
            if (!action.onClick) {
              return;
            }
            openResourceActionConfirm(action.confirm, action.onClick);
            return;
          }
          action.onClick?.();
        },
      }}
    >
      {trigger ?? renderResourceActionTriggerButton({ ariaLabel, baseClassName: triggerClassName })}
    </Dropdown>
  );
}

export const RESOURCE_LIST_TOP_ACTION_BAR_SCHEMA: TopActionBarSchema = {
  id: "resource-list-v1",
  includeUnavailable: false,
  slots: [
    { key: "create", label: "+" },
    { key: "refresh", label: "刷新" },
    { key: "edit", label: "编辑", requiresSelection: true },
    { key: "yaml", label: "YAML", requiresSelection: true },
    { key: "scale", label: "扩缩容", requiresSelection: true },
    { key: "restart", label: "重启", requiresSelection: true },
    { key: "rollback", label: "回滚", requiresSelection: true },
    { key: "image-update", label: "更换镜像", requiresSelection: true },
    { key: "enable-disable", label: "启用/禁用", requiresSelection: true },
    { key: "terminal", label: "终端", requiresSelection: true },
    { key: "logs", label: "日志", requiresSelection: true },
    { key: "delete", label: "删除", requiresSelection: true, danger: true },
  ],
};

interface ResourceActionBarProps {
  actions: ResourceActionItem[];
  wrap?: boolean;
  size?: number;
  compact?: boolean;
  primaryCount?: number;
  schema?: TopActionBarSchema;
  selectionCount?: number;
}

const ACTION_SLOT_ALIASES: Record<string, TopActionBarSlot> = {
  create: "create",
  refresh: "refresh",
  edit: "edit",
  yaml: "yaml",
  scale: "scale",
  restart: "restart",
  rollback: "rollback",
  image: "image-update",
  "image-update": "image-update",
  enable: "enable-disable",
  disable: "enable-disable",
  "enable-disable": "enable-disable",
  terminal: "terminal",
  logs: "logs",
  delete: "delete",
  "delete-selected": "delete",
};

export function parseResourceSearchInput(input: string): ParsedResourceSearch {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const labelExpressions = tokens.filter((token) => token.includes("="));
  const keywordTokens = tokens.filter((token) => !token.includes("="));
  return {
    keyword: keywordTokens.join(" "),
    labelExpressions,
  };
}

export function matchLabelExpressions(
  labels: Record<string, string> | null | undefined,
  expressions: string[],
): boolean {
  if (expressions.length === 0) {
    return true;
  }

  // If backend does not provide labels for this resource, keep name search usable.
  if (!labels || typeof labels !== "object") {
    return true;
  }

  return expressions.every((expression) => {
    const [rawKey, ...valueParts] = expression.split("=");
    const key = rawKey.trim();
    const value = valueParts.join("=").trim();
    if (!key) {
      return false;
    }
    return labels[key] === value;
  });
}

function normalizeActionSlot(actionKey: string): TopActionBarSlot | null {
  return ACTION_SLOT_ALIASES[actionKey] ?? null;
}

function resolveActionsBySchema(
  actions: ResourceActionItem[],
  schema: TopActionBarSchema,
  selectionCount: number | undefined,
): ResourceActionItem[] {
  const normalized = new Map<TopActionBarSlot, ResourceActionItem>();
  const extras: ResourceActionItem[] = [];

  for (const action of actions) {
    const slot = normalizeActionSlot(action.key);
    if (!slot) {
      extras.push(action);
      continue;
    }
    if (!normalized.has(slot)) {
      normalized.set(slot, action);
    } else {
      extras.push(action);
    }
  }

  const schemaActions = schema.slots
    .map((slotRule, index) => {
      const matched = normalized.get(slotRule.key);
      const selectionBlocked =
        slotRule.requiresSelection && typeof selectionCount === "number" && selectionCount <= 0;

      if (matched) {
        return {
          ...matched,
          danger: matched.danger ?? slotRule.danger,
          disabled: Boolean(matched.disabled || selectionBlocked),
        } satisfies ResourceActionItem;
      }

      if (schema.includeUnavailable === false) {
        return null;
      }

      return {
        key: `${schema.id}-${slotRule.key}-unavailable-${index}`,
        label: `${slotRule.label}（不可用）`,
        type: "dashed",
        danger: Boolean(slotRule.danger),
        disabled: true,
        availability: "unavailable",
      } satisfies ResourceActionItem;
    })
    .filter(Boolean) as ResourceActionItem[];

  return [...schemaActions, ...extras];
}

function renderActionButton(
  action: ResourceActionItem,
  fallbackType: ResourceActionItem["type"] = "default",
) {
  const unavailable = action.availability === "unavailable";
  const button = (
    <Button
      size={action.size ?? "middle"}
      type={action.type ?? fallbackType}
      danger={action.danger}
      ghost={action.ghost}
      disabled={action.disabled || unavailable}
      loading={action.loading}
      onClick={action.confirm || unavailable ? undefined : action.onClick}
      style={{
        borderRadius: 999,
        minWidth: 74,
        height: 30,
        fontWeight: 600,
        paddingInline: 14,
        opacity: unavailable ? 0.72 : 1,
      }}
    >
      {action.icon ? (
        <span style={{ marginInlineEnd: 6, display: "inline-flex", alignItems: "center" }}>
          {action.icon}
        </span>
      ) : null}
      {action.label}
    </Button>
  );

  if (!action.confirm || unavailable) {
    return <span key={action.key}>{button}</span>;
  }

  return (
    <Popconfirm
      key={action.key}
      title={action.confirm.title}
      description={action.confirm.description}
      okText={action.confirm.okText ?? "确认"}
      cancelText={action.confirm.cancelText ?? "取消"}
      okButtonProps={action.confirm.okDanger ? { danger: true } : undefined}
      onConfirm={action.onClick}
    >
      {button}
    </Popconfirm>
  );
}

export function ResourceActionBar({
  actions,
  wrap = true,
  size = 6,
  compact = true,
  primaryCount = 2,
  schema,
  selectionCount,
}: ResourceActionBarProps) {
  if (actions.length === 0) return null;

  const resolvedActions = schema
    ? resolveActionsBySchema(actions, schema, selectionCount)
    : actions;

  // Keep legacy props for compatibility with existing call sites,
  // but render all actions inline to avoid hidden dropdown actions.
  void compact;
  void primaryCount;

  return (
    <Space size={size} wrap={wrap}>
      {resolvedActions.map((action, index) =>
        renderActionButton(action, index === 0 ? "primary" : "default"),
      )}
    </Space>
  );
}
