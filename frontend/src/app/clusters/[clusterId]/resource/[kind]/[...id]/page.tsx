"use client";

import { useParams } from "next/navigation";
import { hashKey, useQuery } from "@tanstack/react-query";
import { Tabs, Spin, Alert } from "antd";
import { useMemo, useCallback, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { MasterDetailShell } from "@/components/master-detail";
import { getResourceDetail } from "@/lib/api/resources";
import { getDetailTabs, renderTabContent } from "./detail-config";
import { useReadAccess } from "@/lib/query/read-access-state";
import { visibleDetailData } from "@/components/resource-detail/query-state";
import { OpsDegradedState, OpsIconActionButton, OpsPermissionState } from "@/components/ops";

export default function ResourceDetailPage() {
  const params = useParams<{ clusterId: string; kind: string; id: string[] }>();
  const { accessToken } = useAuth();
  const [nestedTarget, setNestedTarget] = useState<{ kind: string; id: string } | null>(null);

  const clusterId = decodeURIComponent(params.clusterId ?? "");
  const kind = params.kind ?? "";
  const idSegments = params.id ?? [];
  const resourceName = idSegments.map((s: string) => decodeURIComponent(s)).join("/");
  const resourceId = decodeURIComponent(idSegments.map((s: string) => decodeURIComponent(s)).join("/"));

  const backPath = `/clusters/${encodeURIComponent(clusterId)}/overview`;

  const detailQueryKey = ["resource-detail", kind, resourceId, accessToken];
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getResourceDetail({ kind, id: resourceId }, accessToken || undefined),
    enabled: Boolean(accessToken && kind && resourceId),
    retry: 1,
  });

  const permissionDenied = useReadAccess(hashKey(detailQueryKey), detailQuery);
  const detail = visibleDetailData(detailQuery, permissionDenied);
  const tabs = useMemo(() => getDetailTabs(kind, detail), [kind, detail]);

  // Close returns to previous page via native history, falls back to cluster overview
  const handleClose = useCallback(() => {
    // Use native history.back() — more reliable than router.back() when
    // the component tree may already be tearing down.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = backPath;
    }
  }, [backPath]);

  const handleNavigate = useCallback((request: { kind: string; id: string }) => {
    if (request.kind?.trim() && request.id?.trim()) setNestedTarget(request);
  }, []);

  const displayKind = detail?.overview?.kind ?? kind;
  const displayName = detail?.overview?.name ?? resourceName;
  const namespace = detail?.overview?.namespace;
  const state = detail?.overview?.state;

  return (
    <>
    <MasterDetailShell
      open
      onClose={handleClose}
      title={
        <span>
          {displayKind}{" "}
          <span style={{ fontWeight: 400, color: "var(--kn-text-secondary)" }}>
            {displayName}
          </span>
        </span>
      }
      subtitle={detail ? `${namespace ? namespace + " · " : ""}${state ?? ""}` : undefined}
      width={960}
      backPath={backPath}
    >
      {permissionDenied ? (
        <OpsPermissionState title="无权查看该资源详情" description="服务端拒绝了当前资源读取请求。请检查集群访问授权后重试。" action={<OpsIconActionButton loading={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>重试</OpsIconActionButton>} />
      ) : detailQuery.isLoading && !detail ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : detailQuery.isError && !detail ? (
        <Alert type="error" message="加载失败" description={String(detailQuery.error ?? "未知错误")} style={{ margin: 24 }} />
      ) : detail ? (
        <>
        {detailQuery.error ? <OpsDegradedState title="详情刷新失败，当前内容可能已过期" description="保留最近一次读取成功的详情，不会清空当前页面。" action={<OpsIconActionButton loading={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>重试</OpsIconActionButton>} /> : null}
        <Tabs
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            children: renderTabContent(tab.key, { detail, onNavigateRequest: handleNavigate }),
          }))}
          className="master-detail-tabs"
          style={{ padding: "0 20px" }}
        />
        </>
      ) : null}
    </MasterDetailShell>
    {nestedTarget ? (
      <NestedResourceDetail
        clusterId={clusterId}
        target={nestedTarget}
        accessToken={accessToken}
        onClose={() => setNestedTarget(null)}
        onNavigate={setNestedTarget}
      />
    ) : null}
    </>
  );
}

function NestedResourceDetail({
  clusterId,
  target,
  accessToken,
  onClose,
  onNavigate,
}: {
  clusterId: string;
  target: { kind: string; id: string };
  accessToken: string | null | undefined;
  onClose: () => void;
  onNavigate: (target: { kind: string; id: string }) => void;
}) {
  const detailQueryKey = ["nested-resource-detail", clusterId, target.kind, target.id, accessToken];
  const detailQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getResourceDetail({ kind: target.kind, id: target.id }, accessToken || undefined),
    enabled: Boolean(accessToken && target.kind && target.id),
    retry: 1,
  });
  const permissionDenied = useReadAccess(hashKey(detailQueryKey), detailQuery);
  const detail = visibleDetailData(detailQuery, permissionDenied);
  const tabs = useMemo(() => getDetailTabs(target.kind, detail), [target.kind, detail]);
  const title = detail ? `${detail.overview.kind} ${detail.overview.name}` : `${target.kind} ${target.id}`;

  return (
    <MasterDetailShell open onClose={onClose} title={title} subtitle={detail?.overview.namespace} width={960}>
      {permissionDenied ? (
        <OpsPermissionState title="无权查看该资源详情" description="服务端拒绝了当前资源读取请求。请检查集群访问授权后重试。" action={<OpsIconActionButton loading={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>重试</OpsIconActionButton>} />
      ) : detailQuery.isLoading && !detail ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>
      ) : detailQuery.isError && !detail ? (
        <Alert type="error" message="加载失败" description={String(detailQuery.error ?? "未知错误")} style={{ margin: 24 }} />
      ) : detail ? (
        <>
        {detailQuery.error ? <OpsDegradedState title="详情刷新失败，当前内容可能已过期" description="保留最近一次读取成功的详情，不会清空当前页面。" action={<OpsIconActionButton loading={detailQuery.isFetching} onClick={() => void detailQuery.refetch()}>重试</OpsIconActionButton>} /> : null}
        <Tabs
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            children: renderTabContent(tab.key, {
              detail,
              onNavigateRequest: onNavigate,
            }),
          }))}
          className="master-detail-tabs"
          style={{ padding: "0 20px" }}
        />
        </>
      ) : null}
    </MasterDetailShell>
  );
}
