"use client";

import { ArrowLeftOutlined, FileTextOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Skeleton, Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getClusters } from "@/lib/api/clusters";
import { getResourceDetail } from "@/lib/api/resources";
import type { DynamicResourceIdentity, ResourceIdentity, ResourceDetailResponse } from "@/lib/api/resources";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { OpsDrawerShell } from "@/components/ops";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceDetailContent } from "./renderers";
import type { ResourceDetailDrawerProps } from "./types";
import { getKindTitle, getRenderProfile, normalizeKind } from "./utils";

type DetailRequest = NonNullable<ResourceDetailDrawerProps["request"]>;

interface NavigationState {
  baseKey: string;
  activeRequest: DetailRequest;
  stack: DetailRequest[];
}

interface DetailYamlTarget {
  identity: ResourceIdentity;
  dynamicIdentity?: DynamicResourceIdentity;
}

function getRequestKey(request: { kind: string; id: string } | null | undefined) {
  if (!request) return "";
  const kind = normalizeKind(String(request.kind ?? ""));
  const id = String(request.id ?? "").trim();
  return kind && id ? `${kind}:${id}` : "";
}

function parseDynamicYamlTarget(id: string): DetailYamlTarget | null {
  const parts = id.split(":");
  if (parts.length < 7 || parts[0] !== "dynamic") {
    return null;
  }
  const dynamicIdentity: DynamicResourceIdentity = {
    clusterId: parts[1] ?? "",
    group: parts[2] ?? "",
    version: parts[3] ?? "",
    resource: parts[4] ?? "",
    namespace: parts[5] || undefined,
    name: parts.slice(6).join(":"),
  };
  if (!dynamicIdentity.clusterId || !dynamicIdentity.version || !dynamicIdentity.resource || !dynamicIdentity.name) {
    return null;
  }
  return {
    identity: {
      clusterId: dynamicIdentity.clusterId,
      namespace: dynamicIdentity.namespace ?? "",
      kind: dynamicIdentity.resource,
      name: dynamicIdentity.name,
    },
    dynamicIdentity,
  };
}

function buildDetailYamlTarget(
  detail: ResourceDetailResponse | undefined,
  activeRequest: DetailRequest | null,
): DetailYamlTarget | null {
  if (!detail || !activeRequest) {
    return null;
  }
  if (normalizeKind(activeRequest.kind) === "dynamic") {
    return parseDynamicYamlTarget(activeRequest.id);
  }
  const detailKind = normalizeKind(detail.overview.kind || detail.descriptor.resourceKind || activeRequest.kind);
  if (["node", "helmrelease", "helmrepository"].includes(detailKind)) {
    return null;
  }
  if (!detail.overview.clusterId || !detail.overview.kind || !detail.overview.name) {
    return null;
  }
  return {
    identity: {
      clusterId: detail.overview.clusterId,
      namespace: detailKind === "namespace" ? detail.overview.name : detail.overview.namespace || "default",
      kind: detail.overview.kind,
      name: detail.overview.name,
    },
  };
}

export function ResourceDetailDrawer({
  open,
  onClose,
  token,
  request,
  width,
  extra,
  children,
  onNavigateRequest,
}: ResourceDetailDrawerProps) {
  const requestKey = getRequestKey(request);
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [yamlOpen, setYamlOpen] = useState(false);
  const navigationStateActiveKey = getRequestKey(navigationState?.activeRequest);
  const hasActiveNavigationState = Boolean(
    navigationState &&
      (navigationState.baseKey === requestKey || navigationStateActiveKey === requestKey),
  );
  const activeRequest = hasActiveNavigationState
    ? navigationState?.activeRequest ?? null
    : request;
  const navigationStack = hasActiveNavigationState ? navigationState?.stack ?? [] : [];
  const activeRequestKey = getRequestKey(activeRequest);

  const normalizedKind = activeRequest?.kind ? normalizeKind(activeRequest.kind) : "";
  const requestId = activeRequest?.id ?? "";

  const emitNavigateRequest = (nextRequest: DetailRequest) => {
    const kind = String(nextRequest.kind ?? "").trim();
    const id = String(nextRequest.id ?? "").trim();
    if (!kind || !id) return;
    const next = { ...nextRequest, kind, id };
    const nextKey = getRequestKey(next);
    if (!nextKey || nextKey === activeRequestKey) return;

    setNavigationState((current) => ({
      baseKey: hasActiveNavigationState
        ? current?.baseKey || requestKey
        : requestKey,
      activeRequest: next,
      stack: [
        ...(hasActiveNavigationState ? current?.stack ?? [] : []),
        ...(activeRequest ? [activeRequest] : []),
      ],
    }));
    onNavigateRequest?.(next);
  };

  const handleBack = () => {
    const previous = navigationStack.at(-1);
    if (!previous) return;
    setNavigationState((current) => ({
      baseKey: current?.baseKey || requestKey,
      activeRequest: previous,
      stack: current?.stack.slice(0, -1) ?? [],
    }));
    onNavigateRequest?.(previous);
  };

  const handleClose = () => {
    setNavigationState(null);
    setYamlOpen(false);
    onClose();
  };

  const query = useQuery({
    queryKey: ["resource-detail", normalizedKind, requestId, token],
    queryFn: () => getResourceDetail({ kind: normalizedKind, id: requestId }, token),
    enabled: open && Boolean(normalizedKind && requestId),
  });
  const clusterQuery = useQuery({
    queryKey: ["resource-detail", "clusters", token],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!),
    enabled: open && Boolean(token),
  });
  const clusterMap = Object.fromEntries((clusterQuery.data?.items ?? []).map((item) => [item.id, item.name]));
  const hasDetailData = Boolean(query.data);
  const yamlTarget = buildDetailYamlTarget(query.data, activeRequest);

  const title = (() => {
    if (!activeRequest) {
      return "资源详情";
    }
    if (query.data) {
      return `${getRenderProfile(query.data).title} · ${query.data.overview.name}`;
    }
    const requestLabel =
      (activeRequest as { label?: string; name?: string } | null)?.label ??
      (activeRequest as { label?: string; name?: string } | null)?.name;
    if (requestLabel) {
      return `${getKindTitle(normalizedKind || activeRequest.kind)} · ${requestLabel}`;
    }
    return getKindTitle(normalizedKind || activeRequest.kind);
  })();

  return (
    <OpsDrawerShell
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      onClose={handleClose}
      variant="detail"
      widthPx={width}
      classNames={{
        wrapper: "resource-detail-drawer-wrapper",
      }}
      styles={{
        body: {
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
        },
      }}
      extra={
        <Space>
          {navigationStack.length > 0 ? (
            <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
              返回
            </Button>
          ) : null}
          <Button onClick={() => void query.refetch()} loading={query.isFetching} disabled={!activeRequest}>
            刷新
          </Button>
          {yamlTarget ? (
            <Button icon={<FileTextOutlined />} onClick={() => setYamlOpen(true)}>
              YAML
            </Button>
          ) : null}
          {extra}
        </Space>
      }
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 24,
        }}
      >
        {!activeRequest ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择资源" />
        ) : query.isLoading && !hasDetailData ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Skeleton active paragraph={{ rows: 4 }} />
            <Skeleton active paragraph={{ rows: 6 }} />
          </Space>
        ) : query.error instanceof Error ? (
          <Alert
            type="error"
            showIcon
            title="资源详情加载失败"
            description={query.error.message}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : query.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              集群 {getClusterDisplayName(clusterMap, query.data.overview.clusterId)}
              {query.data.overview.namespace ? ` · 名称空间 ${query.data.overview.namespace}` : ""}
              {` · 资源 ${query.data.overview.kind}/${query.data.overview.name}`}
            </Typography.Text>
            <ResourceDetailContent
              key={activeRequestKey}
              detail={query.data}
              snapshot={activeRequest?.snapshot}
              onNavigateRequest={emitNavigateRequest}
            />
            {children}
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情数据" />
        )}
      </div>
      <ResourceYamlDrawer
        open={yamlOpen}
        onClose={() => setYamlOpen(false)}
        token={token}
        identity={yamlTarget?.identity ?? null}
        dynamicIdentity={yamlTarget?.dynamicIdentity ?? null}
        onUpdated={() => void query.refetch()}
      />
    </OpsDrawerShell>
  );
}
