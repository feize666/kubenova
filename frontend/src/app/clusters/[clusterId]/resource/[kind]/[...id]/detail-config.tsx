"use client";

import { useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Input, Modal, Space, Spin, Table, Tag, Typography } from "antd";
import {
  CodeOutlined,
  ContainerOutlined,
  CopyOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import dynamic from "next/dynamic";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";

const LogsWorkbench = dynamic(() => import("@/components/runtime-workbench/logs-workbench"), { ssr: false });
const TerminalWorkbench = dynamic(() => import("@/components/runtime-workbench/terminal-workbench"), { ssr: false });
import { getResourceYaml } from "@/lib/api/resources";
import { getWorkloadsByKind, type WorkloadListItem } from "@/lib/api/workloads";
import { buildLogsRoute } from "@/lib/api/logs";
import { buildTerminalRoute } from "@/lib/workloads/terminal";
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

export interface DetailTab {
  key: string;
  label: string;
}

type NavigateFn = ((request: { kind: string; id: string }) => void) | undefined;

const DETAIL_TAB_MAP: Record<string, DetailTab[]> = {
  deployment: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "yaml", label: "YAML" },
  ],
  statefulset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "yaml", label: "YAML" },
  ],
  daemonset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "yaml", label: "YAML" },
  ],
  replicaset: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "yaml", label: "YAML" },
  ],
  job: [
    { key: "overview", label: "概览" },
    { key: "pods", label: "Pod 列表" },
    { key: "yaml", label: "YAML" },
  ],
  cronjob: [
    { key: "overview", label: "概览" },
    { key: "yaml", label: "YAML" },
  ],
  pod: [
    { key: "overview", label: "概览" },
    { key: "logs", label: "日志" },
    { key: "terminal", label: "终端" },
    { key: "yaml", label: "YAML" },
  ],
  service: [
    { key: "overview", label: "概览" },
    { key: "yaml", label: "YAML" },
  ],
  ingress: [
    { key: "overview", label: "概览" },
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
    { key: "yaml", label: "YAML" },
  ],
  persistentvolumeclaim: [
    { key: "overview", label: "概览" },
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
    { key: "yaml", label: "YAML" },
  ],
  verticalpodautoscaler: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  node: [
    { key: "overview", label: "概览" },
    { key: "yaml", label: "YAML" },
  ],
  clusterrole: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  clusterrolebinding: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  role: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
  rolebinding: [{ key: "overview", label: "概览" }, { key: "yaml", label: "YAML" }],
};

export function getDetailTabs(kind: string, detail?: ResourceDetailResponse): DetailTab[] {
  const key = (kind ?? "").trim().toLowerCase();
  return DETAIL_TAB_MAP[key] ?? [
    { key: "overview", label: "概览" },
    { key: "yaml", label: "YAML" },
  ];
}

export function renderTabContent(
  tabKey: string,
  ctx: { detail: ResourceDetailResponse; onNavigateRequest?: NavigateFn; clusterMap?: Record<string, string> },
): ReactNode {
  const { detail, onNavigateRequest } = ctx;
  const clusterId = (detail.overview as any)?.clusterId ?? "";
  const kind = (detail.overview as any)?.kind ?? "";
  const name = (detail.overview as any)?.name ?? "";
  const namespace = (detail.overview as any)?.namespace ?? "";
  const clusterMap = ctx.clusterMap;

  switch (tabKey) {
    case "overview":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildOverviewSection({ detail, clusterMap, onNavigateRequest })}
          {buildMetadataSection({ detail })}
          {buildLabelsSection({ detail })}
          {buildAnnotationsSection({ detail })}
          {buildSpecSection({ detail })}
          {buildStatusSection({ detail })}
          {kind.toLowerCase() === "pod" ? <ContainersTabContent detail={detail} /> : null}
          {buildEventsSection({ detail, clusterMap, onNavigateRequest })}
        </div>
      );
    case "metadata":
      return buildMetadataSection({ detail });
    case "labels":
      return buildLabelsSection({ detail });
    case "annotations":
      return buildAnnotationsSection({ detail });
    case "conditions":
      return buildStatusSection({ detail });
    case "events":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildEventsSection({ detail, clusterMap, onNavigateRequest })}
        </div>
      );
    case "pods":
      return (
        <PodListTabContent
          clusterId={clusterId}
          namespace={namespace || ""}
          ownerKind={kind}
          ownerName={name}
          ownerSelector={readSelector(detail.rawSpec)}
          onNavigate={(podId: string, _podNs: string, _podName: string) => {
            if (onNavigateRequest && podId) {
              // Use pod cuid (same format as workloads list page)
              onNavigateRequest({ kind: "Pod", id: podId });
            }
          }}
        />
      );

    case "containers":
      return <ContainersTabContent detail={detail} />;
    case "logs":
      return (
        <LogsTabContent
          clusterId={clusterId}
          namespace={namespace}
          podName={name}
          containers={detail.runtime.containerDetails ?? []}
        />
      );
    case "terminal":
      return (
        <TerminalTabContent
          clusterId={clusterId}
          namespace={namespace}
          podName={name}
          containers={detail.runtime.containerDetails ?? []}
        />
      );
    case "data":
      return <DataTabContent detail={detail} />;
    case "yaml":
      return <YamlTabContent clusterId={clusterId} kind={kind} resourceId={name} namespace={namespace} />;
    default:
      return null;
  }
}

// YAML Tab
function YamlTabContent({ clusterId, kind, resourceId, namespace }: { clusterId: string; kind: string; resourceId: string; namespace: string }) {
  const { accessToken } = useAuth();
  return <ResourceYamlDrawer embedded open onClose={() => {}} token={accessToken || undefined} identity={{ clusterId, kind, name: resourceId, namespace }} />;
}

// --- Pod helper functions ---

function formatAge(createdAt?: string): string {
  if (!createdAt) return "-";
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return "-";
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 365) return `${diffDays}d`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y`;
}

function getPodPhase(pod: WorkloadListItem): string {
  const statusJson = (pod as any).statusJson ?? {};
  const podPhase = (pod as any).podPhase;
  if (podPhase && typeof podPhase === "string" && podPhase !== "Unknown") return podPhase;
  if (statusJson.phase && typeof statusJson.phase === "string") return statusJson.phase;
  const containerStatuses = statusJson.containerStatuses ?? [];
  if (containerStatuses.length > 0) {
    const hasWaiting = containerStatuses.some((c: any) => c.state?.waiting);
    const allTerminated = containerStatuses.every((c: any) => c.state?.terminated);
    const waitingReason = containerStatuses.find((c: any) => c.state?.waiting)?.state?.waiting?.reason;
    if (allTerminated) {
      const succeeded = containerStatuses.every((c: any) => c.state?.terminated?.exitCode === 0);
      return succeeded ? "Succeeded" : "Failed";
    }
    if (waitingReason) return waitingReason;
    if (hasWaiting) return "Pending";
    const allRunning = containerStatuses.every((c: any) => c.ready !== false);
    return allRunning ? "Running" : "Pending";
  }
  return pod.status || "Unknown";
}

function getPodReady(pod: WorkloadListItem): string {
  const statusJson = (pod as any).statusJson ?? {};
  const containerStatuses = statusJson.containerStatuses ?? [];
  if (containerStatuses.length > 0) {
    const ready = containerStatuses.filter((c: any) => c.ready).length;
    return `${ready}/${containerStatuses.length}`;
  }
  if (pod.readyReplicas !== undefined && pod.readyReplicas !== null) return String(pod.readyReplicas);
  return "-";
}

function getPodRestarts(pod: WorkloadListItem): number {
  const statusJson = (pod as any).statusJson ?? {};
  const containerStatuses = statusJson.containerStatuses ?? [];
  if (containerStatuses.length > 0) {
    return containerStatuses.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0);
  }
  return (pod as any).restarts ?? 0;
}

function getPodNode(pod: WorkloadListItem): string {
  const spec = (pod as any).spec ?? {};
  if (spec.nodeName && typeof spec.nodeName === "string") return spec.nodeName;
  return (pod as any).nodeName ?? "-";
}

function getPodIP(pod: WorkloadListItem): string {
  const statusJson = (pod as any).statusJson ?? {};
  if (statusJson.podIP && typeof statusJson.podIP === "string") return statusJson.podIP;
  return (pod as any).podIP ?? "-";
}

const POD_PHASE_COLORS: Record<string, string> = {
  Running: "#22c55e", Pending: "#f59e0b", Failed: "#ef4444", Succeeded: "#3b82f6",
  Unknown: "#94a3b8", Terminating: "#f59e0b", Terminated: "#94a3b8",
  ContainerCreating: "#3b82f6", CrashLoopBackOff: "#ef4444", ImagePullBackOff: "#ef4444",
  ErrImagePull: "#ef4444", Error: "#ef4444", Completed: "#22c55e",
  OOMKilled: "#ef4444", Evicted: "#f59e0b", InitError: "#ef4444", NodeShutdown: "#f59e0b",
};

// --- PodListTabContent ---

function readSelector(rawSpec: Record<string, unknown> | undefined): Record<string, string> {
  const selector = rawSpec?.selector;
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) return {};
  const matchLabels = (selector as Record<string, unknown>).matchLabels;
  if (!matchLabels || typeof matchLabels !== "object" || Array.isArray(matchLabels)) return {};
  return Object.fromEntries(Object.entries(matchLabels).filter(([, value]) => typeof value === "string")) as Record<string, string>;
}

function PodListTabContent({
  clusterId, namespace, ownerKind, ownerName, ownerSelector, onNavigate,
}: { clusterId: string; namespace: string; ownerKind: string; ownerName: string; ownerSelector: Record<string, string>; onNavigate: (podId: string, podNs: string, podName: string) => void }) {
  const { accessToken } = useAuth();
  const [keyword, setKeyword] = useState("");
  const podsQuery = useQuery({
    queryKey: ["detail-pod-list", clusterId, namespace, ownerKind, ownerName, keyword, accessToken],
    queryFn: () => getWorkloadsByKind("Pod", { clusterId, namespace, keyword: keyword || undefined, pageSize: 200 }, accessToken || undefined),
    enabled: Boolean(accessToken && clusterId),
    retry: 1,
  });
  const allPods = podsQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    const keywordLower = keyword?.trim().toLowerCase() || "";
    const kindLower = ownerKind.toLowerCase();
    return allPods.filter((pod: WorkloadListItem) => {
      const statusJson = (pod as any).statusJson && typeof (pod as any).statusJson === "object"
        ? (pod as any).statusJson : {};
      // The list endpoint stores Kubernetes ownerReferences in statusJson.
      const ownerRefs: any[] = (pod as any).ownerRefs ?? statusJson.ownerRefs ?? statusJson.ownerReferences ?? statusJson.metadata?.ownerReferences ?? [];

      let matchesOwner = false;
      if (ownerRefs.length > 0) {
        matchesOwner = ownerRefs.some(
          (ref: any) => ref.name === ownerName && (ref.kind || "").toLowerCase() === kindLower
        );
      }
      if (!matchesOwner && Object.keys(ownerSelector).length > 0) {
        const labels: Record<string, string> = (pod as any).labels ?? {};
        matchesOwner = Object.entries(ownerSelector).every(([key, value]) => labels[key] === value);
      }
      if (!matchesOwner) {
        const labels: Record<string, string> = (pod as any).labels ?? {};
        const app = labels["app"] || labels["app.kubernetes.io/name"] || labels["name"] || "";
        matchesOwner = app === ownerName;
      }
      if (!matchesOwner) return false;
      if (keywordLower) {
        return (pod.name || "").toLowerCase().includes(keywordLower);
      }
      return true;
    });
  }, [allPods, ownerKind, ownerName, ownerSelector, keyword]);

  if (podsQuery.isLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>;
  if (podsQuery.isError) return <Alert type="error" message="加载 Pod 列表失败" description={String(podsQuery.error ?? "未知错误")} style={{ margin: 24 }} />;

  const columns = [
    {
      title: "名称", dataIndex: "name", key: "name",
      render: (text: string, record: WorkloadListItem) => (
        <a onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNavigate((record as any).id || record.id || "", record.namespace || namespace, text); }}
           style={{ cursor: "pointer", fontWeight: 500, fontSize: 13 }}>{text}</a>
      ),
    },
    {
      title: "状态", key: "status", width: 130,
      render: (_: unknown, record: WorkloadListItem) => {
        const phase = getPodPhase(record);
        return <Typography.Text style={{ color: POD_PHASE_COLORS[phase] || POD_PHASE_COLORS.Unknown, fontWeight: 500, fontSize: 13 }}>{phase}</Typography.Text>;
      },
    },
    {
      title: "就绪", key: "ready", width: 70,
      render: (_: unknown, record: WorkloadListItem) => <Typography.Text style={{ fontSize: 13 }}>{getPodReady(record)}</Typography.Text>,
    },
    {
      title: "重启", key: "restarts", width: 70,
      render: (_: unknown, record: WorkloadListItem) => {
        const count = getPodRestarts(record);
        return <Typography.Text style={{ fontSize: 13, color: count > 5 ? "#ef4444" : undefined }}>{count}</Typography.Text>;
      },
    },
    {
      title: "节点", key: "node", width: 160, ellipsis: true,
      render: (_: unknown, record: WorkloadListItem) => <Typography.Text style={{ fontSize: 12 }} type="secondary">{getPodNode(record)}</Typography.Text>,
    },
    {
      title: "IP", key: "podIP", width: 130,
      render: (_: unknown, record: WorkloadListItem) => <Typography.Text code style={{ fontSize: 12 }}>{getPodIP(record)}</Typography.Text>,
    },
    {
      title: "创建时间", key: "age", width: 90,
      render: (_: unknown, record: WorkloadListItem) => <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{formatAge(record.createdAt)}</Typography.Text>,
    },
  ];

  const dataSource = filtered.map((pod: WorkloadListItem) => ({ ...pod, key: pod.id || pod.name || Math.random().toString() }));

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Input prefix={<SearchOutlined />} placeholder="搜索 Pod 名称..." size="small" style={{ width: 260 }} value={keyword}
            onChange={(e) => setKeyword(e.target.value)} allowClear />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>{filtered.length} 个 Pod</Typography.Text>
        </div>
      </div>
      <Table columns={columns} dataSource={dataSource} rowKey="key" size="small" pagination={false} scroll={{ x: 800 }}
        onRow={(record) => ({ onClick: () => onNavigate((record as any).id || record.id || "", record.namespace || namespace, record.name), style: { cursor: "pointer" } })}
        locale={{ emptyText: "暂无关联 Pod" }} />
    </div>
  );
}

// Containers Tab
function ContainersTabContent({ detail }: { detail: ResourceDetailResponse }) {
  const containers = detail.runtime.containerDetails ?? [];
  if (containers.length === 0) return <div style={{ padding: 24 }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无容器信息" /></div>;
  return (
    <div style={{ padding: "8px 0" }}>
      {containers.map((container: any, index: number) => (
        <div key={container.name ?? index} style={{ marginBottom: 16, border: "1px solid var(--kn-border, #e8e8e8)", borderRadius: 8, padding: 16 }}>
          <Space align="center" style={{ marginBottom: 12 }}>
            <ContainerOutlined style={{ color: "var(--kn-primary, #1677ff)", fontSize: 18 }} />
            <Typography.Title level={5} style={{ margin: 0 }}>{container.name ?? "容器 " + (index + 1)}</Typography.Title>
            {container.image && <Typography.Text code style={{ fontSize: 12 }}>{container.image}</Typography.Text>}
          </Space>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {(container.ports ?? []).length > 0 && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>端口</Typography.Text><div style={{ marginTop: 4 }}>{(container.ports ?? []).map((p: any, i: number) => <Typography.Text key={i} code style={{ fontSize: 12, marginRight: 8 }}>{p.containerPort}{p.protocol ? "/" + p.protocol : ""}{p.name ? " (" + p.name + ")" : ""}</Typography.Text>)}</div></div>}
            {Object.keys(container.resources ?? {}).length > 0 && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>资源限制</Typography.Text><div style={{ marginTop: 4 }}>{Object.entries(container.resources).map(([key, value]: [string, any]) => <Typography.Text key={key} code style={{ fontSize: 12, marginRight: 8 }}>{key}: {typeof value === "object" ? JSON.stringify(value) : String(value)}</Typography.Text>)}</div></div>}
          </div>
          {(container.env ?? []).length > 0 && <div style={{ marginTop: 12 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>环境变量 ({(container.env ?? []).length})</Typography.Text><div style={{ marginTop: 4, background: "var(--kn-fill-secondary, #f7f8fa)", borderRadius: 4, padding: "4px 8px", maxHeight: 160, overflow: "auto" }}>{(container.env ?? []).map((e: any, i: number) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace", lineHeight: 1.8 }}><Typography.Text>{e.name ?? "-"}</Typography.Text>{e.value !== undefined ? <Typography.Text code style={{ marginLeft: 8 }}>{e.value}</Typography.Text> : e.valueFrom ? <Typography.Text type="secondary" style={{ marginLeft: 8 }}>(from: {Object.keys(e.valueFrom).join(", ")})</Typography.Text> : null}</div>)}</div></div>}
          {(container.volumeMounts ?? []).length > 0 && <div style={{ marginTop: 12 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>挂载卷 ({(container.volumeMounts ?? []).length})</Typography.Text><div style={{ marginTop: 4 }}>{(container.volumeMounts ?? []).map((vm: any, i: number) => <Typography.Text key={i} code style={{ fontSize: 12, marginRight: 12 }}>{vm.name}: {vm.mountPath}{vm.readOnly ? " (ro)" : ""}</Typography.Text>)}</div></div>}
        </div>
      ))}
    </div>
  );
}

function RuntimeTabContent({ mode, clusterId, namespace, podName, containers }: { mode: "logs" | "terminal"; clusterId: string; namespace: string; podName: string; containers?: any[] }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  const query = useMemo(() => {
    const target = { clusterId, namespace, pod: podName, containerNames: containers?.map(c => c.name).filter(Boolean) ?? [] };
    const url = mode === "logs" ? buildLogsRoute(target) : buildTerminalRoute(target);
    return new URLSearchParams(url.split("?")[1]);
  }, [mode, clusterId, namespace, podName, containers]);
  const label = mode === "logs" ? "日志" : "终端";
  return <>
    <Button onClick={() => setOpen(true)}>打开{label}</Button>
    <Modal open={open} title={podName + " · " + label} onCancel={close} footer={null}
      width="100vw" style={{ top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 }}
      styles={{ container: { height: "100dvh", borderRadius: 0, display: "flex", flexDirection: "column" }, body: { flex: 1, minHeight: 0, overflow: "auto" } }}
      destroyOnHidden>
      {open ? mode === "logs" ? <LogsWorkbench query={query} onClose={close} /> : <TerminalWorkbench query={query} onClose={close} /> : null}
    </Modal>
  </>;
}

function LogsTabContent(props: Omit<Parameters<typeof RuntimeTabContent>[0], "mode">) {
  return <RuntimeTabContent {...props} mode="logs" />;
}

function TerminalTabContent(props: Omit<Parameters<typeof RuntimeTabContent>[0], "mode">) {
  return <RuntimeTabContent {...props} mode="terminal" />;
}

// Data Tab
function DataTabContent({ detail }: { detail: ResourceDetailResponse }) {
  const data = (detail as any).rawSpec?.data ?? (detail as any).data ?? {};
  const stringData = (detail as any).rawSpec?.stringData ?? {};
  const allData = { ...data, ...stringData };
  const entries = Object.entries(allData);
  if (entries.length === 0) return <div style={{ padding: 24 }}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /></div>;
  return (
    <div style={{ padding: "8px 0" }}>
      {entries.map(([key, value]: [string, any], index: number) => {
        const displayValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        const isBinary = typeof value === "string" && value.length > 256;
        const truncated = isBinary && displayValue.length > 512 ? displayValue.slice(0, 512) + "\n..." : displayValue;
        return (
          <div key={key ?? index} style={{ marginBottom: 12, border: "1px solid var(--kn-border, #e8e8e8)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "8px 16px", background: "var(--kn-fill-secondary, #f7f8fa)", borderBottom: "1px solid var(--kn-border, #e8e8e8)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography.Text strong style={{ fontSize: 13 }}>{key}</Typography.Text>
              <Space size={4}><Typography.Text type="secondary" style={{ fontSize: 11 }}>{displayValue.length} 字符</Typography.Text>
                <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(displayValue).catch(() => {})} /></Space>
            </div>
            <pre style={{ margin: 0, padding: "12px 16px", fontSize: 12, lineHeight: 1.6, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isBinary ? 256 : undefined, overflow: "auto", color: "var(--kn-text-primary, #1a1a1a)" }}>{truncated}</pre>
          </div>
        );
      })}
    </div>
  );
}
