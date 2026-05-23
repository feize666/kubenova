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
  return (
    <ResourceActionDropdown actions={actions} ariaLabel="更多操作" className={className} />
  );
}
