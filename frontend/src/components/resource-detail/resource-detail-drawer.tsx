"use client";

import { ArrowLeftOutlined, FileTextOutlined } from "@ant-design/icons";
import { Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { getClusters } from "@/lib/api/clusters";
import { getResourceDetail } from "@/lib/api/resources";
import type { DynamicResourceIdentity, ResourceIdentity, ResourceDetailResponse } from "@/lib/api/resources";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { OpsDegradedState, OpsDrawerShell, OpsEmptyState, OpsErrorState, OpsIconActionButton, OpsLoadingState } from "@/components/ops";
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

function hasSnapshot(snapshot: DetailRequest["snapshot"] | undefined): boolean {
  return Boolean(
    snapshot?.spec ||
      snapshot?.status ||
      (snapshot?.labels && Object.keys(snapshot.labels).length > 0),
  );
}

function SnapshotBlock({
  title,
  value,
}: {
  title: string;
  value: Record<string, unknown> | Record<string, string> | undefined;
}) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid var(--ant-color-border-secondary)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--ant-color-bg-container)",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--ant-color-border-secondary)",
          color: "var(--ant-color-text-secondary)",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: 280,
          overflow: "auto",
          padding: 12,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
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
  if (["cluster", "node", "helmrelease", "helmrepository"].includes(detailKind)) {
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
  const activeRequest = useMemo(
    () => (hasActiveNavigationState ? navigationState?.activeRequest ?? null : request),
    [hasActiveNavigationState, navigationState?.activeRequest, request],
  );
  const navigationStack = useMemo(
    () => (hasActiveNavigationState ? navigationState?.stack ?? [] : []),
    [hasActiveNavigationState, navigationState?.stack],
  );
  const activeRequestKey = getRequestKey(activeRequest);

  const normalizedKind = activeRequest?.kind ? normalizeKind(activeRequest.kind) : "";
  const requestId = activeRequest?.id ?? "";

  const emitNavigateRequest = useCallback((nextRequest: DetailRequest) => {
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
  }, [activeRequest, activeRequestKey, hasActiveNavigationState, onNavigateRequest, requestKey]);

  const handleBack = useCallback(() => {
    const previous = navigationStack.at(-1);
    if (!previous) return;
    setNavigationState((current) => ({
      baseKey: current?.baseKey || requestKey,
      activeRequest: previous,
      stack: current?.stack.slice(0, -1) ?? [],
    }));
    onNavigateRequest?.(previous);
  }, [navigationStack, onNavigateRequest, requestKey]);

  const handleClose = useCallback(() => {
    setNavigationState(null);
    setYamlOpen(false);
    onClose();
  }, [onClose]);

  const query = useQuery({
    queryKey: ["resource-detail", normalizedKind, requestId, token],
    queryFn: ({ signal }) => getResourceDetail({ kind: normalizedKind, id: requestId }, token, { signal }),
    enabled: open && Boolean(normalizedKind && requestId),
  });
  const clusterQuery = useQuery({
    queryKey: ["resource-detail", "clusters", token],
    queryFn: ({ signal }) => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!, { signal }),
    enabled: open && Boolean(token),
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clusterQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clusterQuery.data?.items],
  );
  const hasDetailData = Boolean(query.data);
  const yamlTarget = useMemo(() => buildDetailYamlTarget(query.data, activeRequest), [query.data, activeRequest]);
  const activeSnapshot = activeRequest?.snapshot;
  const canShowSnapshotFallback = hasSnapshot(activeSnapshot);

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
      variant="resource"
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
            <OpsIconActionButton icon={<ArrowLeftOutlined />} onClick={handleBack}>
              返回
            </OpsIconActionButton>
          ) : null}
          <OpsIconActionButton onClick={() => void query.refetch()} loading={query.isFetching} disabled={!activeRequest}>
            刷新
          </OpsIconActionButton>
          {yamlTarget ? (
            <OpsIconActionButton icon={<FileTextOutlined />} onClick={() => setYamlOpen(true)}>
              YAML
            </OpsIconActionButton>
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
          <OpsEmptyState title="未选择资源" description="从资源列表选择一条记录后查看详情。" />
        ) : query.isLoading && !hasDetailData ? (
          <OpsLoadingState title="正在加载资源详情" description="正在读取资源概览、状态与关联信息。" />
        ) : query.error instanceof Error ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {canShowSnapshotFallback ? (
              <OpsDegradedState
                title="资源详情加载失败，显示拓扑快照"
                description={query.error.message}
                action={
                  <OpsIconActionButton size="small" onClick={() => void query.refetch()}>
                    重试
                  </OpsIconActionButton>
                }
              />
            ) : (
              <OpsErrorState
              title={canShowSnapshotFallback ? "资源详情加载失败，显示拓扑快照" : "资源详情加载失败"}
              description={query.error.message}
              action={
                <OpsIconActionButton size="small" onClick={() => void query.refetch()}>
                  重试
                </OpsIconActionButton>
              }
              />
            )}
            {canShowSnapshotFallback ? (
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  快照来自拓扑数据，可能少于 API 详情。
                </Typography.Text>
                <SnapshotBlock title="Labels" value={activeSnapshot?.labels} />
                <SnapshotBlock title="Spec" value={activeSnapshot?.spec} />
                <SnapshotBlock title="Status" value={activeSnapshot?.status} />
              </Space>
            ) : null}
          </Space>
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
              clusterMap={clusterMap}
              onNavigateRequest={emitNavigateRequest}
            />
            {children}
          </Space>
        ) : (
          <OpsEmptyState title="暂无详情数据" description="当前 API 未返回可展示的资源详情。" />
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
