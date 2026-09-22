"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Input, Space, Spin, Table, Typography } from "antd";
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
  const clusterId = detail.overview.clusterId;
  const namespace = detail.overview.namespace;
  const name = detail.overview.name;
  const kind = detail.overview.kind;

  switch (tabKey) {
    case "overview":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildOverviewSection({ detail, clusterMap })}
          {buildMetadataSection({ detail })}
          {buildLabelsSection({ detail })}
          {buildAnnotationsSection({ detail })}
          {buildStatusSection({ detail })}
          {buildSpecSection({ detail, specSnapshot: (detail as any).rawSpec })}
        </div>
      );

    case "conditions":
      return <div style={{ padding: "16px 0" }}>{buildStatusSection({ detail })}</div>;

    case "events":
      return (
        <div style={{ padding: "16px 0" }}>
          {buildEventsSection({ detail, clusterMap, onNavigateRequest })}
        </div>
      );

    case "yaml":
      return <YamlTabContent clusterId={clusterId} namespace={namespace || ""} kind={kind} name={name} />;

    case "pods":
      return (
        <PodListTabContent
          clusterId={clusterId}
          namespace={namespace || ""}
          ownerKind={kind}
          ownerName={name}
          onNavigate={(podNs: string, podName: string) => {
            if (onNavigateRequest) {
              onNavigateRequest({ kind: "pod", id: podNs + "/" + podName });
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
          namespace={namespace || ""}
          podName={name}
          containers={detail.runtime.containerDetails}
        />
      );

    case "terminal":
      return (
        <TerminalTabContent
          clusterId={clusterId}
          namespace={namespace || ""}
          podName={name}
          containers={detail.runtime.containerDetails}
        />
      );

    case "data":
      return <DataTabContent detail={detail} />;

    default:
      return <PlaceholderTab title={tabKey} />;
  }
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--kn-text-secondary)", fontSize: 14 }}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={title} />
    </div>
  );
}

// YAML Tab
function YamlTabContent({
  clusterId, namespace, kind, name,
}: { clusterId: string; namespace: string; kind: string; name: string }) {
  const { accessToken } = useAuth();
  const yamlQuery = useQuery({
    queryKey: ["resource-yaml", clusterId, namespace, kind, name, accessToken],
    queryFn: () => getResourceYaml({ clusterId, namespace, kind, name }, accessToken || undefined),
    enabled: Boolean(accessToken && clusterId && kind && name),
    retry: 1,
  });
  const yaml = yamlQuery.data?.yaml ?? "";

  if (yamlQuery.isLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>;
  if (yamlQuery.isError) return <Alert type="error" message="加载 YAML 失败" description={String(yamlQuery.error ?? "未知错误")} style={{ margin: 24 }} />;

  return (
    <div style={{ padding: "0 0 16px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "8px 0", position: "sticky", top: 0, background: "var(--kn-bg-elevated, #fff)", zIndex: 1 }}>
        <Button size="small" icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(yaml).catch(() => {})}>复制</Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => {
          const blob = new Blob([yaml], { type: "application/x-yaml;charset=utf-8" });
          const a = document.createElement("a");
          a.href = window.URL.createObjectURL(blob);
          a.download = (namespace || "cluster") + "-" + kind + "-" + name + ".yaml";
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }}>下载</Button>
      </div>
      <pre style={{ background: "var(--kn-fill-secondary, #f7f8fa)", padding: 16, borderRadius: 8, fontSize: 12, lineHeight: 1.6, overflow: "auto", maxHeight: "calc(100vh - 280px)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "var(--kn-text-primary, #1a1a1a)" }}>{yaml || "(空)"}</pre>
    </div>
  );
}

// Pod List Tab
function PodListTabContent({
  clusterId, namespace, ownerKind, ownerName, onNavigate,
}: { clusterId: string; namespace: string; ownerKind: string; ownerName: string; onNavigate: (ns: string, name: string) => void }) {
  const { accessToken } = useAuth();
  const [keyword, setKeyword] = useState("");
  const podsQuery = useQuery({
    queryKey: ["detail-pod-list", clusterId, namespace, ownerKind, ownerName, accessToken],
    queryFn: () => getWorkloadsByKind("Pod", { clusterId, namespace, keyword: keyword || undefined, pageSize: 100 }, accessToken || undefined),
    enabled: Boolean(accessToken && clusterId),
    retry: 1,
  });
  const allPods = podsQuery.data?.items ?? [];
  const filtered = useMemo(() => allPods.filter((pod: WorkloadListItem) => {
    const metadata = (pod as any).metadata ?? (pod as any).raw ?? {};
    const ownerRefs = metadata.ownerReferences ?? [];
    if (ownerRefs.length === 0) {
      const labels = metadata.labels ?? {};
      const app = labels["app"] || labels["app.kubernetes.io/name"] || labels["name"] || "";
      return app === ownerName;
    }
    return ownerRefs.some((ref: any) => ref.name === ownerName && ref.kind?.toLowerCase() === ownerKind.toLowerCase());
  }), [allPods, ownerKind, ownerName]);

  if (podsQuery.isLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>;
  if (podsQuery.isError) return <Alert type="error" message="加载 Pod 列表失败" description={String(podsQuery.error ?? "未知错误")} style={{ margin: 24 }} />;

  const columns = [
    { title: "Pod 名称", dataIndex: "name", key: "name", render: (text: string, record: WorkloadListItem) => <a onClick={(e) => { e.preventDefault(); onNavigate((record as any).namespace || namespace, text); }} style={{ cursor: "pointer" }}>{text}</a> },
    { title: "状态", dataIndex: "state", key: "state", width: 100, render: (state: string) => <Typography.Text style={{ color: { Running: "#52c41a", Pending: "#faad14", Failed: "#ff4d4f", Succeeded: "#1890ff", Unknown: "#8c8c8c" }[state] || "#8c8c8c", fontWeight: 500 }}>{state || "-"}</Typography.Text> },
    { title: "就绪", dataIndex: "ready", key: "ready", width: 80 },
    { title: "重启", dataIndex: "restarts", key: "restarts", width: 60 },
    { title: "节点", dataIndex: "node", key: "node", width: 140 },
    { title: "IP", dataIndex: "podIP", key: "podIP", width: 130 },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 160 },
  ];

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <Input prefix={<SearchOutlined />} placeholder="搜索 Pod..." size="small" style={{ width: 240 }} value={keyword} onChange={(e) => setKeyword(e.target.value)} allowClear />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{filtered.length} 个 Pod</Typography.Text>
      </div>
      <Table columns={columns} dataSource={filtered} rowKey={(r: WorkloadListItem) => r.name || Math.random().toString()} size="small" pagination={false} scroll={{ x: 700 }}
        onRow={(record: WorkloadListItem) => ({ onClick: () => onNavigate((record as any).namespace || namespace, record.name), style: { cursor: "pointer" } })}
        locale={{ emptyText: "暂无关联 Pod" }}
      />
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
            {Object.keys(container.resources ?? {}).length > 0 && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>资源限制</Typography.Text><div style={{ marginTop: 4 }}>{container.resources?.requests && <div><Typography.Text style={{ fontSize: 12 }}>requests: </Typography.Text>{Object.entries(container.resources.requests as Record<string, string>).map(([k, v], i) => <Typography.Text key={i} code style={{ fontSize: 12, marginRight: 8 }}>{k}: {v}</Typography.Text>)}</div>}{container.resources?.limits && <div><Typography.Text style={{ fontSize: 12 }}>limits: </Typography.Text>{Object.entries(container.resources.limits as Record<string, string>).map(([k, v], i) => <Typography.Text key={i} code style={{ fontSize: 12, marginRight: 8 }}>{k}: {v}</Typography.Text>)}</div>}</div></div>}
          </div>
          {(container.env ?? []).length > 0 && <div style={{ marginTop: 12 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>环境变量 ({(container.env ?? []).length})</Typography.Text><div style={{ marginTop: 4, background: "var(--kn-fill-secondary, #f7f8fa)", borderRadius: 4, padding: "4px 8px", maxHeight: 160, overflow: "auto" }}>{(container.env ?? []).map((e: any, i: number) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace", lineHeight: 1.8 }}><Typography.Text>{e.name ?? "-"}</Typography.Text>{e.value !== undefined ? <Typography.Text code style={{ marginLeft: 8 }}>{e.value}</Typography.Text> : e.valueFrom ? <Typography.Text type="secondary" style={{ marginLeft: 8 }}>(from: {Object.keys(e.valueFrom).join(", ")})</Typography.Text> : null}</div>)}</div></div>}
          {(container.volumeMounts ?? []).length > 0 && <div style={{ marginTop: 12 }}><Typography.Text type="secondary" style={{ fontSize: 12 }}>挂载卷 ({(container.volumeMounts ?? []).length})</Typography.Text><div style={{ marginTop: 4 }}>{(container.volumeMounts ?? []).map((vm: any, i: number) => <Typography.Text key={i} code style={{ fontSize: 12, marginRight: 12 }}>{vm.name}: {vm.mountPath}{vm.readOnly ? " (ro)" : ""}</Typography.Text>)}</div></div>}
        </div>
      ))}
    </div>
  );
}

// Logs Tab
function LogsTabContent({ clusterId, namespace, podName, containers }: { clusterId: string; namespace: string; podName: string; containers?: any[] }) {
  const router = useRouter();
  const containerNames = containers?.map((c: any) => c.name).filter(Boolean) ?? [];
  return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <FileTextOutlined style={{ fontSize: 48, color: "var(--kn-text-secondary)", marginBottom: 16 }} />
      <Typography.Title level={5}>查看 Pod 日志</Typography.Title>
      <Typography.Paragraph type="secondary">点击下方按钮在新窗口中打开日志查看器，支持实时跟踪、搜索和过滤。</Typography.Paragraph>
      <Button type="primary" icon={<EyeOutlined />} onClick={() => router.push(buildLogsRoute({ clusterId, namespace, pod: podName, containerNames, resourceKind: "Pod", resourceName: podName }))}>打开日志查看器</Button>
    </div>
  );
}

// Terminal Tab
function TerminalTabContent({ clusterId, namespace, podName, containers }: { clusterId: string; namespace: string; podName: string; containers?: any[] }) {
  const router = useRouter();
  const containerNames = containers?.map((c: any) => c.name).filter(Boolean) ?? [];
  return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <CodeOutlined style={{ fontSize: 48, color: "var(--kn-text-secondary)", marginBottom: 16 }} />
      <Typography.Title level={5}>打开终端</Typography.Title>
      <Typography.Paragraph type="secondary">点击下方按钮在新窗口中打开 Web 终端，连接到 Pod 容器。</Typography.Paragraph>
      <Button type="primary" icon={<CodeOutlined />} onClick={() => router.push(buildTerminalRoute({ clusterId, namespace, pod: podName, containerNames }))}>打开终端</Button>
    </div>
  );
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
                <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(displayValue).catch(() => {})} />
              </Space>
            </div>
            <pre style={{ margin: 0, padding: "12px 16px", fontSize: 12, lineHeight: 1.6, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: isBinary ? 256 : undefined, overflow: "auto", color: "var(--kn-text-primary, #1a1a1a)" }}>{truncated}</pre>
          </div>
        );
      })}
    </div>
  );
}
