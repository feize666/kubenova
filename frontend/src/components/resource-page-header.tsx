"use client";

import { Card, Typography } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { getNavItemByPath } from "@/config/navigation";
import { OpsFilterChip, type OpsFilterChipTone } from "@/components/ops";

type ResourcePageHeaderProps = {
  path: string;
  titleEn?: string;
  titleZh?: string;
  description?: string;
  extra?: ReactNode;
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
  titleEn,
  titleZh,
  description,
  extra,
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
    resolvedTitleEn && resolvedTitleZh
      ? `${resolvedTitleEn}（${resolvedTitleZh}）`
      : resolvedTitleEn ?? navItem?.label ?? "资源";

  const content = (
    <div style={style}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <Typography.Title level={4} style={{ marginBottom: 2, marginTop: 0 }}>
              {title}
            </Typography.Title>
            {titleSuffix ? <div style={{ paddingBottom: 0 }}>{titleSuffix}</div> : null}
          </div>
          {resolvedDescription ? (
            <Typography.Text type="secondary">{resolvedDescription}</Typography.Text>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {freshness ? (
            <OpsFilterChip tone={mapFreshnessColor(freshness.color)} style={{ margin: 0 }}>
              {freshness.label}：{freshness.value ?? "-"}
            </OpsFilterChip>
          ) : null}
          {extra ? <div>{extra}</div> : null}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return <Card>{content}</Card>;
}
