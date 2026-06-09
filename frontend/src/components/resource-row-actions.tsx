"use client";

import {
  type ResourceActionItem,
  ResourceActionDropdown,
} from "@/components/resource-action-bar";

type ResourceRowActionsProps = {
  deleteLabel: string;
  deleteTitle: string;
  deleteContent: string;
  onYaml: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  leadingActions?: ResourceActionItem[];
  extraActions?: ResourceActionItem[];
  className?: string;
  ariaLabel?: string;
};

export function ResourceRowActions({
  deleteLabel,
  deleteTitle,
  deleteContent,
  onYaml,
  onEdit,
  onDelete,
  leadingActions = [],
  extraActions = [],
  className,
  ariaLabel = "更多操作",
}: ResourceRowActionsProps) {
  const actions: ResourceActionItem[] = [
    ...leadingActions,
    { key: "yaml", label: "YAML", onClick: onYaml },
    ...(onEdit ? [{ key: "edit", label: "编辑", onClick: onEdit }] : []),
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
  return (
    <span
      data-resource-table-stop-navigation="true"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <ResourceActionDropdown actions={actions} ariaLabel={ariaLabel} className={className} />
    </span>
  );
}
