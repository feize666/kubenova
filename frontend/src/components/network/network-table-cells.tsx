"use client";

import { Typography } from "antd";
import { OpsFilterChip, OpsStatusTag } from "@/components/ops";

type NetworkPreviewListCellProps = {
  values: string[];
  limit?: number;
  empty?: string;
};

type NetworkEndpointHealthCellProps = {
  ready: number;
  total?: number;
  secondaryLabel: string;
  secondaryValue: number;
  secondaryTone?: "neutral" | "warning" | "danger";
};

type NetworkServiceLinkCellProps = {
  name: string;
  port?: number | string | null;
  extraCount?: number;
  onClick: () => void;
};

function compactList(values: string[], limit: number) {
  const visible = values.slice(0, limit);
  const hidden = Math.max(0, values.length - visible.length);
  return { visible, hidden };
}

export function NetworkKindChip({ kind }: { kind: string }) {
  return <OpsFilterChip tone="info">{kind}</OpsFilterChip>;
}

export function NetworkEndpointHealthCell({
  ready,
  total,
  secondaryLabel,
  secondaryValue,
  secondaryTone = "neutral",
}: NetworkEndpointHealthCellProps) {
  const readyLabel = typeof total === "number" ? `${ready}/${total}` : String(ready);
  return (
    <span className="network-health-cell">
      <OpsStatusTag tone="success">就绪 {readyLabel}</OpsStatusTag>
      <OpsStatusTag tone={secondaryValue > 0 ? secondaryTone : "neutral"}>
        {secondaryLabel} {secondaryValue}
      </OpsStatusTag>
    </span>
  );
}

export function NetworkPreviewListCell({
  values,
  limit = 3,
  empty = "-",
}: NetworkPreviewListCellProps) {
  if (values.length === 0) {
    return <span className="network-preview-list is-empty">{empty}</span>;
  }

  const { visible, hidden } = compactList(values, limit);
  return (
    <span className="network-preview-list">
      {visible.map((value) => (
        <span key={value} className="network-preview-list__item">
          {value}
        </span>
      ))}
      {hidden > 0 ? <span className="network-preview-list__more">+{hidden}</span> : null}
    </span>
  );
}

export function NetworkServiceLinkCell({
  name,
  port,
  extraCount = 0,
  onClick,
}: NetworkServiceLinkCellProps) {
  return (
    <span className="network-service-link-cell">
      <Typography.Link onClick={onClick}>{name}</Typography.Link>
      {port !== undefined && port !== null ? (
        <span className="network-service-link-cell__port">:{port}</span>
      ) : null}
      {extraCount > 0 ? <span className="network-preview-list__more">+{extraCount}</span> : null}
    </span>
  );
}
