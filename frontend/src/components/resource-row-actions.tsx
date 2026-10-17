"use client";

import {
  type ResourceActionItem,
  ResourceActionDropdown,
} from "@/components/resource-action-bar";
import { useResourceEditorNavigation } from "@/hooks/use-resource-editor-navigation";
import { useAuth } from "@/components/auth-context";

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
  editorIdentity?: {clusterId:string;kind:string;name:string;namespace?:string;apiVersion?:string;resource?:string};
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
  editorIdentity,
}: ResourceRowActionsProps) {
  const openEditor = useResourceEditorNavigation();
  const { role } = useAuth();
  const canWrite = ['admin', 'platform-admin', 'operator', 'cluster-operator'].includes(role.trim().toLowerCase());
  const edit = editorIdentity ? () => openEditor(editorIdentity) : onEdit;
  // YAML is an in-place detail drawer action on resource lists. Keep the
  // dedicated callback even when the form editor identity is available;
  // using the identity here would unexpectedly navigate away from the list.
  const yaml = onYaml;
  const actions: ResourceActionItem[] = [
    ...leadingActions,
    ...(edit ? [{ key: "edit", label: "编辑", onClick: edit }] : []),
    { key: "yaml", label: "YAML", onClick: yaml },
    ...extraActions.filter(action => !editorIdentity || action.key !== 'edit'),
    {
      key: "delete",
      label: deleteLabel,
      danger: true,
      disabled: !canWrite,
      disabledReason: !canWrite ? '当前权限仅允许查看资源' : undefined,
      onClick: () => { if (canWrite) onDelete(); },
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
