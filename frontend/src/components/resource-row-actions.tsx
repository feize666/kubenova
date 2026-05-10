"use client";

import { Dropdown } from "antd";
import {
  buildResourceActionMenuItems,
  type ResourceActionItem,
  openResourceActionConfirm,
  renderResourceActionTriggerButton,
  renderPodLikeResourceActionStyles,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
} from "@/components/resource-action-bar";

type ResourceRowActionsProps = {
  deleteLabel: string;
  deleteTitle: string;
  deleteContent: string;
  onYaml: () => void;
  onDelete: () => void;
  extraActions?: ResourceActionItem[];
  className?: string;
};

export function ResourceRowActions({
  deleteLabel,
  deleteTitle,
  deleteContent,
  onYaml,
  onDelete,
  extraActions = [],
  className,
}: ResourceRowActionsProps) {
  const actions: ResourceActionItem[] = [
    { key: "yaml", label: "YAML", onClick: onYaml },
    ...extraActions,
    {
      key: "delete",
      label: deleteLabel,
      danger: true,
      onClick: onDelete,
      confirm: {
        title: deleteTitle,
        description: deleteContent,
        okText: "确认删除",
        cancelText: "取消",
        okDanger: true,
      },
    },
  ];
  const items = buildResourceActionMenuItems(actions);

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        classNames={{ root: [className, POD_ACTION_MENU_CLASS].filter(Boolean).join(" ") }}
        menu={{
          items,
          onClick: ({ key }) => {
            const action = actions.find((item) => item.key === key);
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
        {renderResourceActionTriggerButton({ ariaLabel: "更多操作", baseClassName: POD_ACTION_TRIGGER_CLASS })}
      </Dropdown>

      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </>
  );
}
