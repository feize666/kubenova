"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Tabs, Spin, Alert } from "antd";
import { useMemo, useCallback, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { MasterDetailShell } from "@/components/master-detail";
import { getResourceDetail } from "@/lib/api/resources";
import { getDetailTabs, renderTabContent } from "./detail-config";

export default function ResourceDetailPage() {
  const params = useParams<{ clusterId: string; kind: string; id: string[] }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [nestedTarget, setNestedTarget] = useState<{ kind: string; id: string } | null>(null);

  const clusterId = decodeURIComponent(params.clusterId ?? "");
  const kind = params.kind ?? "";
  const idSegments = params.id ?? [];
  const resourceName = idSegments.map((s: string) => decodeURIComponent(s)).join("/");
  const resourceId = decodeURIComponent(idSegments.map((s: string) => decodeURIComponent(s)).join("/"));

  const backPath = `/clusters/${encodeURIComponent(clusterId)}/overview`;

  const detailQuery = useQuery({
    queryKey: ["resource-detail", kind, resourceId, accessToken],
    queryFn: () => getResourceDetail({ kind, id: resourceId }, accessToken || undefined),
    enabled: Boolean(accessToken && kind && resourceId),
    retry: 1,
  });

  const tabs = useMemo(() => getDetailTabs(kind, detailQuery.data ?? undefined), [kind, detailQuery.data]);

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

  const detail = detailQuery.data;
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
      {detailQuery.isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : detailQuery.isError ? (
        <Alert type="error" message="加载失败" description={String(detailQuery.error ?? "未知错误")} style={{ margin: 24 }} />
      ) : detail ? (
        <Tabs
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            children: renderTabContent(tab.key, { detail, onNavigateRequest: handleNavigate }),
          }))}
          className="master-detail-tabs"
          style={{ padding: "0 20px" }}
        />
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
  const detailQuery = useQuery({
    queryKey: ["nested-resource-detail", clusterId, target.kind, target.id, accessToken],
    queryFn: () => getResourceDetail({ kind: target.kind, id: target.id }, accessToken || undefined),
    enabled: Boolean(accessToken && target.kind && target.id),
    retry: 1,
  });
  const detail = detailQuery.data;
  const tabs = useMemo(() => getDetailTabs(target.kind, detail), [target.kind, detail]);
  const title = detail ? `${detail.overview.kind} ${detail.overview.name}` : `${target.kind} ${target.id}`;

  return (
    <MasterDetailShell open onClose={onClose} title={title} subtitle={detail?.overview.namespace} width={960}>
      {detailQuery.isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>
      ) : detailQuery.isError ? (
        <Alert type="error" message="加载失败" description={String(detailQuery.error ?? "未知错误")} style={{ margin: 24 }} />
      ) : detail ? (
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
      ) : null}
    </MasterDetailShell>
  );
}
