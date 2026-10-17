"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { ButtonProps } from "antd";
import type { ReactNode } from "react";
import { OpsIconActionButton } from "@/components/ops";
import { usePathname, useSearchParams } from "next/navigation";
import { useResourceEditorNavigation } from "@/hooks/use-resource-editor-navigation";
import { resourceTypeForPath } from "@/lib/resource-editor";
import { useAuth } from "@/components/auth-context";

type ResourceAddButtonProps = Omit<ButtonProps, "children" | "type" | "icon"> & {
  label?: ReactNode;
  compact?: boolean;
  editorKind?: string;
  editorApiVersion?: string;
  editorResource?: string;
  legacyCreate?: boolean;
  editorMode?: 'form' | 'yaml';
};

function normalizeAddTooltip(text: string): string {
  const value = text.trim();
  if (!value) return "创建资源";
  if (value.startsWith("新增")) {
    return `创建${value.slice(2).trim()}`;
  }
  return value;
}

export function ResourceAddButton({
  label = "+",
  compact = true,
  style,
  editorKind,
  editorApiVersion,
  editorResource,
  legacyCreate = false,
  editorMode = 'form',
  ...props
}: ResourceAddButtonProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const openEditor = useResourceEditorNavigation();
  const { role } = useAuth();
  const resourceType = resourceTypeForPath(pathname);
  const canUseEditor = !legacyCreate && !pathname.startsWith('/users/') && (editorKind || resourceType);
  const canWrite = ['admin', 'platform-admin', 'operator', 'cluster-operator'].includes(role.trim().toLowerCase());
  const rawTooltipTitle =
    typeof props.title === "string" && props.title.trim().length > 0
      ? props.title
      : typeof props["aria-label"] === "string" && props["aria-label"].trim().length > 0
        ? props["aria-label"]
        : `创建${compact ? "" : "资源"}`;
  const tooltipTitle = normalizeAddTooltip(rawTooltipTitle);

  const button = (
    <OpsIconActionButton
      {...props}
      disabled={props.disabled || Boolean(canUseEditor && !canWrite)}
      type={editorMode === 'yaml' ? 'default' : 'primary'}
      onClick={canUseEditor ? () => openEditor({ kind: editorKind || params.get('kind') || resourceType!.kind, apiVersion:editorApiVersion, resource:editorResource }, editorMode) : props.onClick}
      opsVariant={editorMode === 'yaml' ? 'secondary' : 'primary'}
      opsTone="primary"
      icon={<PlusOutlined />}
      style={style}
      className={["resource-add-button", compact ? "resource-add-button--compact" : "", props.className]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      {compact ? null : label}
    </OpsIconActionButton>
  );

  return <Tooltip title={tooltipTitle}>{button}</Tooltip>;
}
