"use client";

import { LinkOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { buildResourceRefDetailRequest } from "@/lib/resource-navigation";
import type { ResourceDetailDrawerProps } from "./types";

type NavigateRequest = NonNullable<ResourceDetailDrawerProps["onNavigateRequest"]> extends (
  request: infer T,
) => void ? T : never;

export interface ResourceLinkProps {
  kind: string;
  name?: string | null;
  id?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterMap?: Record<string, string>;
  onNavigateRequest?: (request: NavigateRequest) => void;
  children?: ReactNode;
  strong?: boolean;
  title?: string;
}

/** Consistent, keyboard-accessible resource link used throughout detail views. */
export function ResourceLink({
  kind,
  name,
  namespace,
  clusterId,
  clusterMap,
  onNavigateRequest,
  children,
  strong = false,
  title,
}: ResourceLinkProps) {
  const label = children ?? name ?? "-";
  const request = name && clusterId
    ? buildResourceRefDetailRequest({ resourceKind: kind, resourceName: name, clusterId, namespace, clusterMap })
    : null;
  // `buildResourceRefDetailRequest` encodes the stable navigation identity as
  // cluster/namespace/name. The detail API's opaque record id is not suitable
  // for routing and must not replace that identity here.
  const target = request;
  if (!target || !onNavigateRequest) {
    return <Typography.Text strong={strong} type="secondary">{label}</Typography.Text>;
  }
  return (
    <Tooltip title={title ?? `打开 ${kind} 资源`}>
      <Typography.Link
        strong={strong}
        onClick={() => onNavigateRequest(target)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onNavigateRequest(target);
          }
        }}
        role="link"
        tabIndex={0}
      >
        {label} <LinkOutlined aria-hidden="true" />
      </Typography.Link>
    </Tooltip>
  );
}
