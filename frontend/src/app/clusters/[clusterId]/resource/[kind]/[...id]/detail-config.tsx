"use client";

import type { ReactNode } from "react";
import { Typography, Table } from "antd";
import type { ResourceDetailResponse } from "@/lib/api/resources";
import {
  buildOverviewSection,
  buildMetadataSection,
  buildLabelsSection,
  buildAnnotationsSection,
  buildSpecSection,
  buildStatusSection,
  buildEventsSection,
} from "@/components/resource-detail/detail-section-builders";
import { ContainersTab } from "@/components/resource-detail/containers-tab";
import { LogsTab } from "@/components/resource-detail/logs-tab";
import { TerminalTab } from "@/components/resource-detail/terminal-tab";
import { YamlTab } from "@/components/resource-detail/yaml-tab";
import { DataTab } from "@/components/resource-detail/data-tab";

export interface DetailTab {
  key: string;
  label: string;
}

type NavigateFn = ((request: { kind: string; id: string }) => void) | undefined;

const DETAIL_TAB_MAP: Record<string, DetailTab[]> = {
  deployment: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  statefulset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  daemonset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  replicaset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  job: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  cronjob: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  pod: [
    { key: "overview", label: "概览" },
    { key: "containers", label: "容器" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "logs", label: "日志" },
    { key: "terminal", label: "终端" },
    { key: "yaml", label: "YAML" },
  ],
  service: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  ingress: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  endpoints: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  endpointslice: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  networkpolicy: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  gatewayclass: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  gateway: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  httproute: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  ingressroute: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  persistentvolume: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  persistentvolumeclaim: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  storageclass: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  configmap: [
    { key: "overview", label: "概览" },
    { key: "data", label: "Data" },
    { key: "yaml", label: "YAML" },
  ],
  secret: [
    { key: "overview", label: "概览" },
    { key: "data", label: "Data" },
    { key: "yaml", label: "YAML" },
  ],
  serviceaccount: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  limitrange: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  resourcequota: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  horizontalpodautoscaler: [
    { key: "overview", label: "概览" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  verticalpodautoscaler: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  node: [
    { key: "overview", label: "概览" },
    { key: "conditions", label: "Conditions" },
    { key: "events", label: "Events" },
    { key: "yaml", label: "YAML" },
  ],
  namespace: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  cluster: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  helmrelease: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  helmrepository: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  dynamic: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
};

export function getDetailTabs(kind: string, _detail?: ResourceDetailResponse): DetailTab[] {
  const normalized = kind.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return DETAIL_TAB_MAP[normalized] ?? DETAIL_TAB_MAP.dynamic ?? [
    { key: "overview", label: "概览" },
    { key: "yaml", label: "YAML" },
  ];
}

export function renderTabContent(
  tabKey: string,
  ctx: { detail: ResourceDetailResponse; onNavigateRequest?: NavigateFn; clusterMap?: Record<string, string> },
): ReactNode {
  const { detail, onNavigateRequest } = ctx;
  const clusterMap = ctx.clusterMap ?? {};

  switch (tabKey) {
    case "overview":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildOverviewSection({ detail, clusterMap })}
          {buildStatusSection({ detail })}
          {buildMetadataSection({ detail })}
          {buildLabelsSection({ detail })}
          {buildAnnotationsSection({ detail })}
          {buildSpecSection({ detail, specSnapshot: (detail as any).rawSpec })}
        </div>
      );

    case "conditions":
      return <div style={{ padding: "16px 0" }}>{buildStatusSection({ detail })}</div>;

    case "events":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildEventsSection({ detail, clusterMap, onNavigateRequest: onNavigateRequest as any })}
        </div>
      );

    case "yaml":
      return <YamlTab detail={detail} />;

    case "pods":
      return <PodListPlaceholder detail={detail} onNavigate={onNavigateRequest} />;

    case "containers":
      return <ContainersTab detail={detail} />;

    case "logs":
      return <LogsTab detail={detail} />;

    case "terminal":
      return <TerminalTab detail={detail} />;

    case "data":
      return <DataTab detail={detail} />;

    default:
      return (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--kn-text-secondary)", fontSize: 14 }}>
          暂无内容
        </div>
      );
  }
}

/** Pod list tab — renders owned pods from the workload controller */
function PodListPlaceholder({
  detail,
  onNavigate,
}: {
  detail: ResourceDetailResponse;
  onNavigate?: NavigateFn;
}) {
  const clusterId = String(detail.overview?.clusterId ?? "");
  const namespace = String(detail.overview?.namespace ?? "");
  const kind = String(detail.overview?.kind ?? "").toLowerCase();

  // For pods directly (not workloads), show "no owned pods"
  if (kind === "pod") {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--kn-text-secondary)" }}>
        Pod 类型不展示子 Pod 列表
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div
        style={{
          padding: "20px 16px",
          background: "var(--kn-fill-secondary, #f5f5f5)",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <Typography.Text type="secondary">
          Pod 列表查询 API 集成中。当前工作负载：{kind}/{detail.overview?.name ?? "-"} · Namespace: {namespace}
        </Typography.Text>
      </div>
      <Table
        dataSource={[]}
        rowKey="name"
        size="small"
        pagination={false}
        columns={[
          { title: "状态", key: "state", width: 80 },
          { title: "名称", key: "name", width: 200 },
          { title: "就绪", key: "ready", width: 70 },
          { title: "重启", key: "restarts", width: 70 },
          { title: "节点", key: "node", width: 120 },
          { title: "IP", key: "ip", width: 120 },
          { title: "Age", key: "age", width: 80 },
          { title: "操作", key: "actions", width: 100 },
        ]}
        locale={{ emptyText: "Pod 数据加载中..." }}
      />
    </div>
  );
}

// Need Typography
