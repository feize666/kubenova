"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Skeleton, Space } from "antd";
import { getClusterDetail } from "@/lib/api/clusters";
import type { ClusterTableRecord } from "@/app/clusters/page";
import { DetailDescriptions, DetailSection } from "./resource-detail/section-primitives";
import { StatusTag } from "./status-tag";

type ClusterDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  token?: string;
  cluster: ClusterTableRecord | null;
  onRefreshRequest?: () => void;
};

function buildNodeRoleLabel(role: string) {
  if (role === "control-plane") return "控制平面";
  if (role === "worker") return "工作节点";
  return role || "-";
}

export function ClusterDetailDrawer({
  open,
  onClose,
  token,
  cluster,
  onRefreshRequest,
}: ClusterDetailDrawerProps) {
  const clusterId = cluster?.id ?? "";
  const query = useQuery({
    queryKey: ["clusters", "detail", clusterId, token],
    queryFn: () => getClusterDetail(clusterId, token),
    enabled: open && Boolean(clusterId),
  });

  const nodeItems = query.data?.nodeSummary.items ?? [];

  return (
    <Drawer
      title={query.data ? `集群详情 · ${query.data.displayName}` : "集群详情"}
      width={840}
      open={open}
      destroyOnHidden
      onClose={onClose}
      extra={
        <Space>
          <Button onClick={() => void query.refetch()} loading={query.isFetching} disabled={!clusterId}>
            刷新
          </Button>
          {onRefreshRequest ? <Button onClick={onRefreshRequest}>同步列表</Button> : null}
        </Space>
      }
      styles={{
        body: {
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
        },
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24 }}>
        {!cluster ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择集群" />
        ) : query.isLoading && !query.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Skeleton active paragraph={{ rows: 3 }} />
            <Skeleton active paragraph={{ rows: 5 }} />
          </Space>
        ) : query.error instanceof Error ? (
          <Alert
            type="error"
            showIcon
            message="集群详情加载失败"
            description={query.error.message}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : query.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <DetailSection title="基础信息" subtitle="集群身份与同步时间">
              <DetailDescriptions
                items={[
                  { key: "name", label: "集群名称", value: query.data.name },
                  { key: "displayName", label: "展示名称", value: query.data.displayName },
                  { key: "status", label: "运行状态", value: <StatusTag state={query.data.runtimeStatus} /> },
                  { key: "lastSyncTime", label: "最后同步时间", value: query.data.lastSyncTime ?? "—" },
                ]}
              />
            </DetailSection>

            <DetailSection
              title="节点概览"
              subtitle={`总计 ${query.data.nodeSummary.total} 个节点 · 就绪 ${query.data.nodeSummary.ready} 个`}
            >
              {nodeItems.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点数据" />
              ) : (
                <DetailDescriptions
                  items={nodeItems.map((item) => ({
                    key: item.name,
                    label: item.name,
                    value: `${buildNodeRoleLabel(item.role)} · ${item.ready ? "就绪" : "未就绪"}${
                      item.kubeletVersion ? ` · ${item.kubeletVersion}` : ""
                    }`,
                  }))}
                />
              )}
            </DetailSection>

            <DetailSection title="平台信息" subtitle="实时平台字段与基础元数据">
              <DetailDescriptions
                items={[
                  { key: "cniPlugin", label: "CNI 网络插件", value: query.data.platform.cniPlugin ?? "—" },
                  { key: "criRuntime", label: "CRI 运行时", value: query.data.platform.criRuntime ?? "—" },
                  { key: "kubernetesVersion", label: "K8s 版本", value: query.data.platform.kubernetesVersion ?? "—" },
                  { key: "environment", label: "环境", value: query.data.metadata.environment },
                  { key: "provider", label: "供应商", value: query.data.metadata.provider },
                  { key: "region", label: "地域", value: query.data.metadata.region ?? "—" },
                  {
                    key: "environmentType",
                    label: "环境类型",
                    value: query.data.metadata.environmentType ?? "—",
                  },
                ]}
              />
            </DetailSection>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情数据" />
        )}
      </div>
    </Drawer>
  );
}
