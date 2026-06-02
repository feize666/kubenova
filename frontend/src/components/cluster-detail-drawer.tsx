"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Button, Empty, Skeleton, Space, message } from "antd";
import { useAuth } from "@/components/auth-context";
import { downloadClusterKubeconfig, getClusterDetail } from "@/lib/api/clusters";
import type { ClusterTableRecord } from "@/app/clusters/page";
import { DetailDescriptions, DetailSection } from "./resource-detail/section-primitives";
import { StatusTag } from "./status-tag";
import { OpsDrawerShell, openOpsConfirm } from "@/components/ops";

type ClusterDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  token?: string;
  cluster: ClusterTableRecord | null;
  runtimeStatus?: string;
  onRefreshRequest?: () => void;
};

const DETAIL_LOAD_TIMEOUT_MS = 12_000;

function buildNodeRoleLabel(role: string) {
  if (role === "control-plane") return "控制平面";
  if (role === "worker") return "工作节点";
  return role || "-";
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function lifecycleText(state: ClusterTableRecord["state"]) {
  if (state === "active") return "启用";
  if (state === "disabled") return "已停用";
  if (state === "deleted") return "已删除";
  return "未记录";
}

function isOfflineRuntimeStatus(status?: string | null) {
  return status === "offline" || status === "offline-mode";
}

function isOfflineClusterSnapshot(cluster: ClusterTableRecord | null, runtimeStatus?: string | null) {
  if (!cluster) return false;
  if (cluster.hasKubeconfig === false) return true;
  return isOfflineRuntimeStatus(runtimeStatus) || isOfflineRuntimeStatus(cluster.status);
}

function renderOfflineClusterNotice(mode: "offline" | "offline-mode") {
  const isOfflineMode = mode === "offline-mode";
  return (
    <Alert
      type="warning"
      showIcon
      title={isOfflineMode ? "集群处于离线模式" : "集群当前离线"}
      description={
        isOfflineMode
          ? "当前集群未接入 kubeconfig，仅展示登记信息；实时资源、节点和健康探测能力不可用。"
          : "当前集群连接异常，实时资源、节点和健康探测数据可能不可用。请检查 kubeconfig、网络连通性或重新触发健康探测。"
      }
    />
  );
}

export function ClusterDetailDrawer({
  open,
  onClose,
  token,
  cluster,
  runtimeStatus,
  onRefreshRequest,
}: ClusterDetailDrawerProps) {
  const { role } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [detailTimedOut, setDetailTimedOut] = useState(false);
  const clusterId = cluster?.id ?? "";
  const fallbackRuntimeStatus = runtimeStatus ?? cluster?.status;
  const isOfflineView = isOfflineClusterSnapshot(cluster, fallbackRuntimeStatus);
  const fallbackOfflineMode = fallbackRuntimeStatus === "offline-mode" || cluster?.hasKubeconfig === false;
  const query = useQuery({
    queryKey: ["clusters", "detail", clusterId, token],
    queryFn: () => getClusterDetail(clusterId, token),
    enabled: open && Boolean(clusterId) && !isOfflineView,
  });

  const nodeItems = query.data?.nodeSummary.items ?? [];
  const nodeSummaryDegraded = Boolean(query.data?.nodeSummary.degraded);
  const nodeSummaryDegradationReason = query.data?.nodeSummary.degradationReason;
  const canExportKubeconfig = cluster?.hasKubeconfig && role !== "read-only";
  const showFallbackSnapshot = Boolean(cluster) && !query.data;
  const detailOfflineMode = query.data?.runtimeStatus === "offline-mode" || cluster?.hasKubeconfig === false;
  const shouldShowDetailOfflineNotice = isOfflineRuntimeStatus(query.data?.runtimeStatus) || detailOfflineMode;

  useEffect(() => {
    setDetailTimedOut(false);
    if (!open || !clusterId || isOfflineView || query.data || query.error) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDetailTimedOut(true);
    }, DETAIL_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [clusterId, isOfflineView, open, query.data, query.error]);

  const handleRefreshDetail = () => {
    setDetailTimedOut(false);
    void query.refetch();
  };

  const handleExportKubeconfig = () => {
    if (!clusterId || !token || exporting) return;
    const displayName = query.data?.displayName || cluster?.name || "当前集群";

    openOpsConfirm({
      title: "导出 kubeconfig",
      description:
        `将下载集群「${displayName}」当前接入凭据文件。该文件可能包含敏感令牌或证书，请仅在受控只读排查场景使用；系统不会自动降权源凭据权限。确认继续导出吗？`,
      okText: "确认导出",
      cancelText: "取消",
      danger: true,
      onOk: async () => {
        setExporting(true);
        try {
          const exported = await downloadClusterKubeconfig(clusterId, token);
          triggerBrowserDownload(exported.blob, exported.filename);
          void message.success("kubeconfig 已开始下载");
        } catch (error) {
          const detail = error instanceof Error ? error.message : "kubeconfig 导出失败";
          void message.error(detail);
          throw error;
        } finally {
          setExporting(false);
        }
      },
    });
  };

  return (
    <OpsDrawerShell
      title={query.data ? `集群详情 · ${query.data.displayName}` : "集群详情"}
      size="large"
      open={open}
      destroyOnHidden
      onClose={onClose}
      variant="detail"
      classNames={{
        wrapper: "cluster-detail-drawer-wrapper",
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
        isOfflineView ? null : (
          <Space>
            {canExportKubeconfig ? (
              <Button onClick={handleExportKubeconfig} loading={exporting} disabled={!clusterId || !token}>
                导出 kubeconfig
              </Button>
            ) : null}
            <Button onClick={handleRefreshDetail} loading={query.isFetching} disabled={!clusterId}>
              刷新
            </Button>
            {onRefreshRequest ? <Button onClick={onRefreshRequest}>同步列表</Button> : null}
          </Space>
        )
      }
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24 }}>
        {!cluster ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择集群" />
        ) : isOfflineView ? (
          renderOfflineClusterNotice(fallbackOfflineMode ? "offline-mode" : "offline")
        ) : query.isLoading && !query.data && !detailTimedOut ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Skeleton active paragraph={{ rows: 3 }} />
            <Skeleton active paragraph={{ rows: 5 }} />
          </Space>
        ) : query.error instanceof Error ? (
          <Alert
            type="error"
            showIcon
            title="集群详情加载失败"
            description={query.error.message}
            action={
              <Button size="small" onClick={handleRefreshDetail}>
                重试
              </Button>
            }
          />
        ) : query.data ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {shouldShowDetailOfflineNotice
              ? renderOfflineClusterNotice(detailOfflineMode ? "offline-mode" : "offline")
              : null}
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
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                {nodeSummaryDegraded ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="节点清单暂不可用"
                    description={nodeSummaryDegradationReason ?? "当前集群节点清单读取失败"}
                    action={
                      <Button size="small" onClick={() => void query.refetch()}>
                        重试
                      </Button>
                    }
                  />
                ) : null}
                {nodeItems.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={nodeSummaryDegraded ? "节点数据降级为空" : "暂无节点数据"}
                  />
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
              </Space>
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
        ) : showFallbackSnapshot ? (
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {detailTimedOut ? (
              <Alert
                type="error"
                showIcon
                title="集群详情加载超时"
                description="实时详情读取时间过长，当前展示列表快照。可重试刷新，或先用列表信息继续排查。"
                action={
                  <Button size="small" onClick={handleRefreshDetail} loading={query.isFetching}>
                    重试
                  </Button>
                }
              />
            ) : null}
            <DetailSection title="列表快照" subtitle="来自集群列表的兜底信息">
              <DetailDescriptions
                items={[
                  { key: "name", label: "集群名称", value: cluster.name },
                  { key: "status", label: "状态", value: <StatusTag state={cluster.status} /> },
                  { key: "lifecycle", label: "生命周期", value: lifecycleText(cluster.state) },
                  { key: "environment", label: "环境", value: cluster.environment },
                  { key: "provider", label: "供应商", value: cluster.provider },
                  { key: "kubernetesVersion", label: "K8s 版本", value: cluster.kubernetesVersion || "—" },
                  { key: "nodeCount", label: "节点数量", value: cluster.nodeCount ?? "—" },
                  { key: "accessMode", label: "接入模式", value: cluster.hasKubeconfig ? "真实集群" : "离线模式" },
                  { key: "updatedAt", label: "更新时间", value: cluster.updatedAt ?? "—" },
                ]}
              />
            </DetailSection>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情数据" />
        )}
      </div>
    </OpsDrawerShell>
  );
}
