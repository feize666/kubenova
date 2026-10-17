"use client";

import { FileTextOutlined, FullscreenOutlined, FullscreenExitOutlined } from "@ant-design/icons";
import { Space, Tabs, Typography } from "antd";
import { hashKey, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { getClusters } from "@/lib/api/clusters";
import { getResourceDetail } from "@/lib/api/resources";
import type { DynamicResourceIdentity, ResourceIdentity, ResourceDetailResponse } from "@/lib/api/resources";
import { OpsCommandPreview, OpsDegradedState, OpsDrawerShell, OpsEmptyState, OpsErrorState, OpsIconActionButton, OpsLoadingState, OpsPermissionState } from "@/components/ops";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceDetailContent } from "./renderers";
import type { ResourceDetailDrawerProps } from "./types";
import { getKindTitle, getRenderProfile, normalizeKind } from "./utils";
import { getDetailTabs, renderTabContent } from "@/app/clusters/[clusterId]/resource/[kind]/[...id]/detail-config";
import { ResourceEditBoundaryContext, useResourceEditBoundary } from '@/components/resource-editor/resource-edit-boundary';
import { useReadAccess } from '@/lib/query/read-access-state';
import { visibleDetailData } from './query-state';

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
    <OpsCommandPreview
      allowCopy
      content={JSON.stringify(value, null, 2)}
      kind="code"
      language="JSON"
      title={title}
      tone="neutral"
      wrap
    />
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
      namespace: detail.overview.namespace || "",
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
  const editBoundary=useResourceEditBoundary();
  const [fullscreen,setFullscreen]=useState(false);
  const requestKey = getRequestKey(request);
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
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
  const rawRequestId = activeRequest?.id ?? "";

  // Workload details use the same tabbed experience as the standalone detail
  // route while remaining mounted over the originating resource list.
  const tabbedKinds = new Set(["deployment", "statefulset", "daemonset", "replicaset", "job", "cronjob", "pod"]);
  const useTabbedDetail = tabbedKinds.has(normalizedKind);

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
    setFullscreen(false);
    setActiveTab("overview");
    onClose();
  }, [onClose]);

  const handleTabChange = useCallback((key: string) => {if(key!==activeTab)editBoundary.request(()=>setActiveTab(key));}, [activeTab,editBoundary]);

  // Reset the tab when drilling into a different resource in the same drawer.
  const [previousRequestKey, setPreviousRequestKey] = useState(activeRequestKey);
  if (previousRequestKey !== activeRequestKey) {
    setPreviousRequestKey(activeRequestKey);
    setActiveTab("overview");
  }

  const clusterQuery = useQuery({
    queryKey: ["resource-detail", "clusters", token],
    queryFn: ({ signal }) => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, token!, { signal }),
    enabled: open && Boolean(token),
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clusterQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clusterQuery.data?.items],
  );
  const requestId = useMemo(() => {
    if (normalizedKind !== "cluster") return rawRequestId;
    const id = String(rawRequestId).trim();
    if (!id || clusterMap[id] !== undefined) return id;
    const matched = Object.entries(clusterMap).find(([, name]) => name === id);
    return matched?.[0] ?? id;
  }, [clusterMap, normalizedKind, rawRequestId]);
  const detailQueryKey = ["resource-detail", normalizedKind, requestId, token];
  const query = useQuery({
    queryKey: detailQueryKey,
    queryFn: ({ signal }) => getResourceDetail({ kind: normalizedKind, id: requestId }, token, { signal }),
    enabled: open && Boolean(normalizedKind && requestId),
  });
  const emitNavigateRequest = useCallback((nextRequest: DetailRequest) => {
    const kind = String(nextRequest.kind ?? "").trim();
    const id = String(nextRequest.id ?? "").trim();
    if (!kind || !id) return;
    const nextNormalizedKind = normalizeKind(kind);
    const nextId =
      nextNormalizedKind === "cluster" && clusterMap[id] === undefined
        ? Object.entries(clusterMap).find(([, name]) => name === id)?.[0] ?? id
        : id;
    const next = { ...nextRequest, kind, id: nextId };
    const nextKey = getRequestKey(next);
    if (!nextKey) return;
    // The title is also a navigation link. Avoid stacking the same detail,
    // but let its owner navigate to the resource's management page.
    if (nextKey === activeRequestKey) {
      onNavigateRequest?.(next);
      return;
    }

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
  }, [activeRequest, activeRequestKey, clusterMap, hasActiveNavigationState, onNavigateRequest, requestKey]);
  const permissionDenied = useReadAccess(hashKey(detailQueryKey), query);
  const visibleDetail = visibleDetailData(query, permissionDenied);
  const hasDetailData = Boolean(visibleDetail);
  const yamlTarget = useMemo(() => buildDetailYamlTarget(visibleDetail, activeRequest), [visibleDetail, activeRequest]);
  const activeSnapshot = activeRequest?.snapshot;
  const canShowSnapshotFallback = !permissionDenied && hasSnapshot(activeSnapshot);
  const drawerState = query.isFetching && hasDetailData ? "loading" : "idle";

  const title = (() => {
    if (!activeRequest) {
      return "资源详情";
    }
    if (visibleDetail) {
      return `${getRenderProfile(visibleDetail).title} · ${visibleDetail.overview.name}`;
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
    <ResourceEditBoundaryContext.Provider value={editBoundary}>
    <OpsDrawerShell
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      onClose={()=>editBoundary.request(handleClose)}
      variant="resource"
      widthPx={width}
      fullscreen={fullscreen}
      state={drawerState}
      stateTitle={drawerState === "loading" ? "正在刷新资源详情" : undefined}
      stateDescription={drawerState === "loading" ? "当前内容保持可读，刷新完成后自动更新。" : undefined}
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
          <OpsIconActionButton icon={fullscreen?<FullscreenExitOutlined/>:<FullscreenOutlined/>} aria-label={fullscreen?'退出详情全屏':'全屏资源详情'} aria-pressed={fullscreen} onClick={()=>setFullscreen(value=>!value)}>
            {fullscreen?'退出全屏':'全屏'}
          </OpsIconActionButton>
          {navigationStack.length > 0 ? (
            <OpsIconActionButton onClick={()=>editBoundary.request(handleBack)}>
              返回
            </OpsIconActionButton>
          ) : null}
          <OpsIconActionButton onClick={() => void query.refetch()} loading={query.isFetching} disabled={!activeRequest}>
            刷新
          </OpsIconActionButton>
          {yamlTarget && !useTabbedDetail ? (
            <OpsIconActionButton icon={<FileTextOutlined />} onClick={() => setYamlOpen(true)}>
              YAML
            </OpsIconActionButton>
          ) : null}
          {!permissionDenied && extra}
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
        ) : permissionDenied ? (
          <OpsPermissionState
            title="无权查看该资源详情"
            description="服务端拒绝了当前资源读取请求。请检查集群访问授权后重试。"
            action={<OpsIconActionButton size="small" loading={query.isFetching} onClick={() => void query.refetch()}>重试</OpsIconActionButton>}
          />
        ) : query.isLoading && !hasDetailData ? (
          <OpsLoadingState title="正在加载资源详情" description="正在读取资源概览、状态与关联信息。" />
        ) : query.error instanceof Error && !hasDetailData ? (
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
        ) : visibleDetail ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {query.error instanceof Error ? (
              <OpsDegradedState
                title="详情刷新失败，当前内容可能已过期"
                description={`${query.error.message}。保留最近一次读取成功的详情，不会清空当前页面。`}
                action={<OpsIconActionButton size="small" loading={query.isFetching} onClick={() => void query.refetch()}>重试</OpsIconActionButton>}
              />
            ) : null}
            {useTabbedDetail ? (
              <Tabs
                key={activeRequestKey}
                destroyOnHidden
                activeKey={activeTab}
                onChange={handleTabChange}
                items={getDetailTabs(normalizedKind, visibleDetail).map((tab) => ({
                  key: tab.key,
                  label: tab.label,
                  children: renderTabContent(tab.key, {
                    detail: visibleDetail,
                    clusterMap,
                    onNavigateRequest: emitNavigateRequest,
                  }),
                }))}
                className="master-detail-tabs"
              />
            ) : (
              <ResourceDetailContent
                key={activeRequestKey}
                detail={visibleDetail}
                snapshot={activeRequest?.snapshot}
                clusterMap={clusterMap}
                onNavigateRequest={emitNavigateRequest}
              />
            )}
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
    </ResourceEditBoundaryContext.Provider>
  );
}
