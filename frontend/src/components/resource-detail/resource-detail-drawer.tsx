"use client";

import { Alert, Button, Drawer, Empty, Skeleton, Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { getClusters } from "@/lib/api/clusters";
import { getResourceDetail } from "@/lib/api/resources";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { ResourceDetailContent } from "./renderers";
import type { ResourceDetailDrawerProps } from "./types";
import { getKindTitle, getRenderProfile, normalizeKind } from "./utils";

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
  const normalizedKind = request?.kind ? normalizeKind(request.kind) : "";
  const requestId = request?.id ?? "";

  const emitNavigateRequest = (nextRequest: { kind: string; id: string }) => {
    if (!onNavigateRequest) return;
    const kind = String(nextRequest.kind ?? "").trim();
    const id = String(nextRequest.id ?? "").trim();
    if (!kind || !id) return;
    onNavigateRequest({ kind, id });
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

  const title = (() => {
    if (!request) {
      return "资源详情";
    }
    if (query.data) {
      return `${getRenderProfile(query.data).title} · ${query.data.overview.name}`;
    }
    const requestLabel = (request as { label?: string } | null)?.label;
    if (requestLabel) {
      return `${getKindTitle(normalizedKind || request.kind)} · ${requestLabel}`;
    }
    return getKindTitle(normalizedKind || request.kind);
  })();

  return (
    <Drawer
      title={title}
      size="large"
      open={open}
      destroyOnHidden
      onClose={onClose}
      classNames={{
        wrapper: "resource-detail-drawer-wrapper",
      }}
      styles={{
        wrapper: {
          width: width ? `min(50vw, ${width}px)` : "min(50vw, 960px)",
          minWidth: width ?? 720,
          maxWidth: "none",
        },
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
          <Button onClick={() => void query.refetch()} loading={query.isFetching} disabled={!request}>
            刷新
          </Button>
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
        {!request ? (
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
            message="资源详情加载失败"
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
            <ResourceDetailContent detail={query.data} onNavigateRequest={emitNavigateRequest} />
            {children}
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情数据" />
        )}
      </div>
    </Drawer>
  );
}
