"use client";

import { useMemo } from "react";
import { Table, Tag, Typography, Badge, Space } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { getWorkloadsByKind } from "@/lib/api/workloads";
import type { WorkloadListItem } from "@/lib/api/workloads";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import type { ResourceDetailResponse } from "@/lib/api/resources";

interface PodListTabProps {
  detail: ResourceDetailResponse;
  onNavigate?: (request: { kind: string; id: string }) => void;
}

function getPodStateBadge(pod: WorkloadListItem) {
  const phase = pod.podPhase ?? pod.state ?? "";
  const normalized = String(phase).toLowerCase();

  if (normalized === "running" || normalized === "active") {
    return <Badge status="success" text="Running" />;
  }
  if (normalized === "pending" || normalized === "waiting") {
    return <Badge status="warning" text="Pending" />;
  }
  if (normalized === "failed" || normalized === "error") {
    return <Badge status="error" text="Failed" />;
  }
  if (normalized === "succeeded" || normalized === "completed") {
    return <Badge status="default" text="Succeeded" />;
  }
  if (normalized === "terminating") {
    return <Badge status="processing" text="Terminating" />;
  }
  return <Badge status="default" text={pod.state ?? phase ?? "Unknown"} />;
}

export function PodListTab({ detail, onNavigate }: PodListTabProps) {
  const { accessToken } = useAuth();
  const now = useNowTicker();
  const clusterId = String(detail.overview?.clusterId ?? "");
  const namespace = String(detail.overview?.namespace ?? "");
  const workloadKind = String(detail.overview?.kind ?? "").toLowerCase();
  const workloadName = String(detail.overview?.name ?? "");

  const podQuery = useQuery({
    queryKey: ["owned-pods", clusterId, namespace, workloadKind, workloadName, accessToken],
    queryFn: () =>
      getWorkloadsByKind("Pod", { clusterId, namespace, pageSize: 500 }, accessToken || undefined),
    enabled: Boolean(accessToken && clusterId && namespace),
    refetchInterval: 15000,
  });

  const pods = useMemo(() => {
    if (!podQuery.data?.items) return [];
    const items = podQuery.data.items;
    
    // For workload controllers, filter pods owned by this controller
    if (["deployment", "statefulset", "daemonset", "replicaset", "job"].includes(workloadKind)) {
      return items.filter((pod) => {
        if (!pod.ownerRefs || !Array.isArray(pod.ownerRefs)) return false;
        return pod.ownerRefs.some(
          (ref: any) =>
            String(ref?.kind ?? "").toLowerCase() === workloadKind &&
            String(ref?.name ?? "") === workloadName,
        );
      });
    }
    
    return items;
  }, [podQuery.data, workloadKind, workloadName]);

  if (podQuery.isLoading) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--kn-text-secondary)" }}>
        加载 Pod 列表...
      </div>
    );
  }

  if (podQuery.isError) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--kn-text-error, #ff4d4f)" }}>
        加载失败: {String(podQuery.error ?? "未知错误")}
      </div>
    );
  }

  if (pods.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--kn-text-secondary)" }}>
        未找到关联的 Pod
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
        共 {pods.length} 个 Pod
      </Typography.Text>
      <Table
        dataSource={pods}
        rowKey="id"
        size="small"
        pagination={pods.length > 20 ? { pageSize: 20, showSizeChanger: true } : false}
        columns={[
          {
            title: "状态",
            key: "state",
            width: 110,
            render: (_: unknown, row: WorkloadListItem) => getPodStateBadge(row),
          },
          {
            title: "名称",
            dataIndex: "name",
            key: "name",
            width: 220,
            ellipsis: true,
            render: (name: string, row: WorkloadListItem) =>
              onNavigate ? (
                <Typography.Link
                  onClick={() =>
                    onNavigate({ kind: "Pod", id: row.id })
                  }
                  style={{ fontWeight: 500 }}
                >
                  {name}
                </Typography.Link>
              ) : (
                <span style={{ fontWeight: 500 }}>{name}</span>
              ),
          },
          {
            title: "就绪",
            key: "ready",
            width: 70,
            render: (_: unknown, row: WorkloadListItem) => {
              const ready = row.readyReplicas ?? 0;
              const total = row.replicas ?? 1;
              return (
                <span style={{ color: ready === total ? "var(--kn-success, #52c41a)" : "var(--kn-warning, #faad14)" }}>
                  {ready}/{total}
                </span>
              );
            },
          },
          {
            title: "重启",
            key: "restarts",
            width: 70,
            render: (_: unknown, row: WorkloadListItem) => {
              const r = row.restarts ?? 0;
              return (
                <span style={{ color: r > 5 ? "var(--kn-error, #ff4d4f)" : undefined }}>
                  {r}
                </span>
              );
            },
          },
          {
            title: "节点",
            dataIndex: "nodeName",
            key: "node",
            width: 130,
            ellipsis: true,
            render: (nodeName: string | null) =>
              nodeName ? (
                <Typography.Text code style={{ fontSize: 12 }}>{nodeName}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              ),
          },
          {
            title: "IP",
            key: "ip",
            width: 120,
            render: (_: unknown, row: WorkloadListItem) => {
              const ip = (row as any).podIP ?? (row as any).ip ?? "";
              return ip ? (
                <Typography.Text code style={{ fontSize: 12 }}>{ip}</Typography.Text>
              ) : (
                <Typography.Text type="secondary">-</Typography.Text>
              );
            },
          },
          {
            title: "Age",
            key: "age",
            width: 90,
            render: (_: unknown, row: WorkloadListItem) => (
              <ResourceTimeCell
                value={row.createdAt || row.creationTimestamp || undefined}
                now={now}
                mode="relative"
              />
            ),
          },
        ]}
      />
    </div>
  );
}
