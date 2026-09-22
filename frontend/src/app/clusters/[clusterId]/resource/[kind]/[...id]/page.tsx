"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Tabs, Spin, Alert } from "antd";
import { useMemo, useCallback } from "react";
import { useAuth } from "@/components/auth-context";
import { MasterDetailShell } from "@/components/master-detail";
import { getResourceDetail } from "@/lib/api/resources";
import { getDetailTabs, renderTabContent } from "./detail-config";

export default function ResourceDetailPage() {
  const params = useParams<{ clusterId: string; kind: string; id: string[] }>();
  const router = useRouter();
  const { accessToken } = useAuth();

  const clusterId = decodeURIComponent(params.clusterId ?? "");
  const kind = params.kind ?? "";
  const idSegments = params.id ?? [];
  const resourceId = idSegments.map((s: string) => decodeURIComponent(s)).join("/");

  const backPath = `/clusters/${encodeURIComponent(clusterId)}/overview`;

  const detailQuery = useQuery({
    queryKey: ["resource-detail", kind, resourceId, accessToken],
    queryFn: () => getResourceDetail({ kind, id: resourceId }, accessToken || undefined),
    enabled: Boolean(accessToken && kind && resourceId),
    retry: 1,
  });

  const tabs = useMemo(() => getDetailTabs(kind, detailQuery.data ?? undefined), [kind, detailQuery.data]);

  const handleClose = useCallback(() => {
    router.push(backPath);
  }, [router, backPath]);

  const handleNavigate = useCallback((request: { kind: string; id: string }) => {
    const navKind = (request.kind ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    const navId = request.id ?? "";
    if (navKind && navId) {
      router.push(
        `/clusters/${encodeURIComponent(clusterId)}/resource/${encodeURIComponent(navKind)}/${encodeURIComponent(navId)}`,
      );
    }
  }, [router, clusterId]);

  const detail = detailQuery.data;
  const displayKind = detail?.overview?.kind ?? kind;
  const displayName = detail?.overview?.name ?? resourceId;
  const namespace = detail?.overview?.namespace;
  const state = detail?.overview?.state;

  return (
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
      backPath={backPath}
      width={720}
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
  );
}
