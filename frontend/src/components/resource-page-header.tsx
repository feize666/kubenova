"use client";

import type { CSSProperties, ReactNode } from "react";
import { getNavItemByPath } from "@/config/navigation";
import { OpsFilterChip, OpsPageHeader, type OpsFilterChipTone } from "@/components/ops";

type ResourcePageHeaderProps = {
  path: string;
  className?: string;
  title?: ReactNode;
  titleEn?: string;
  titleZh?: string;
  description?: string;
  extra?: ReactNode;
  actions?: ReactNode;
  titleSuffix?: ReactNode;
  freshness?: {
    label: string;
    value?: string | null;
    color?: string;
  };
  embedded?: boolean;
  style?: CSSProperties;
};

function mapFreshnessColor(color?: string): OpsFilterChipTone {
  if (color === "green" || color === "success") return "success";
  if (color === "gold" || color === "orange" || color === "warning") return "warning";
  if (color === "red" || color === "volcano" || color === "error" || color === "danger") return "danger";
  if (color === "default") return "neutral";
  return "info";
}

export function ResourcePageHeader({
  path,
  className,
  title: titleOverride,
  titleEn,
  titleZh,
  description,
  extra,
  actions,
  titleSuffix,
  freshness,
  embedded = false,
  style,
}: ResourcePageHeaderProps) {
  const navItem = getNavItemByPath(path);
  const resolvedTitleEn = titleEn ?? navItem?.canonicalNameEn;
  const resolvedTitleZh = titleZh ?? navItem?.canonicalNameZh;
  const resolvedDescription = description ?? navItem?.description ?? "";
  const title =
    titleOverride ??
    (resolvedTitleEn && resolvedTitleZh
      ? `${resolvedTitleEn}（${resolvedTitleZh}）`
      : resolvedTitleEn ?? navItem?.label ?? "资源");
  const freshnessAction = freshness ? (
    <OpsFilterChip tone={mapFreshnessColor(freshness.color)} style={{ margin: 0 }}>
      {freshness.label}：{freshness.value ?? "-"}
    </OpsFilterChip>
  ) : null;
  const secondaryActions =
    actions || freshnessAction ? (
      <>
        {actions}
        {freshnessAction}
      </>
    ) : null;

  return (
    <OpsPageHeader
      title={(
        <>
          {title}
          {titleSuffix ? <span className="resource-page-header__title-suffix">{titleSuffix}</span> : null}
        </>
      )}
      subtitle={resolvedDescription}
      actions={secondaryActions}
      primaryAction={extra}
      surface={!embedded}
      className={["resource-page-header", className].filter(Boolean).join(" ")}
      style={style}
    />
  );
}
