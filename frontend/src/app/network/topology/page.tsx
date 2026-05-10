"use client";

import "reactflow/dist/style.css";

import {
  BranchesOutlined,
  CheckOutlined,
  DownOutlined,
  FilterOutlined,
  MinusOutlined,
  PlusOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  RightOutlined,
  ShrinkOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dagre from "@dagrejs/dagre";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Popover, Skeleton, Tag, Tooltip, Typography } from "antd";
import { useRouter } from "next/navigation";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  getNodesBounds,
  getViewportForBounds,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import { useAuth } from "@/components/auth-context";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { RuntimeStatusPill } from "@/components/visual-system";
import { getClusters } from "@/lib/api/clusters";
import { getNetworkResources, type NetworkResource } from "@/lib/api/network";
import { getWorkloadsByKind, type WorkloadListItem } from "@/lib/api/workloads";

const { Text, Title } = Typography;

const CANVAS_BG = "var(--topology-overview-bg)";
const DEFAULT_VIEWPORT_MODE = "100%";
const MAX_ZOOM = 4;

function DetailFactsGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  if (items.length === 0) return null;
  const labelWidth = Math.min(
    144,
    Math.max(108, items.reduce((max, item) => Math.max(max, item.label.length), 0) * 7 + 24),
  );
  return (
    <div className="topology-facts-grid" style={{ ["--topology-facts-label-width" as string]: `${labelWidth}px` }}>
      {items.map((item) => (
        <div key={item.label} className="topology-facts-grid__row">
          <div className="topology-facts-grid__label">{item.label}</div>
          <div className="topology-facts-grid__value" title={item.value}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const TOKEN = {
  cluster: {
    border: "#2563eb",
    borderAlpha: "rgba(37,99,235,0.48)",
    bg: "#eff6ff",
    text: "#1d4ed8",
    tag: "#2563eb",
    icon: "☸",
    label: "Cluster",
  },
  namespace: {
    border: "#3b82f6",
    borderAlpha: "rgba(59,130,246,0.42)",
    bg: "#edf4ff",
    text: "#1e3a8a",
    tag: "#3b82f6",
    icon: "⬡",
    label: "Namespace",
  },
  instancegroup: {
    border: "#4f46e5",
    borderAlpha: "rgba(79,70,229,0.36)",
    bg: "#eef2ff",
    text: "#4338ca",
    tag: "#4f46e5",
    icon: "◫",
    label: "Instance Group",
  },
  node: {
    border: "#0f766e",
    borderAlpha: "rgba(15,118,110,0.34)",
    bg: "#ecfeff",
    text: "#0f766e",
    tag: "#0f766e",
    icon: "⬢",
    label: "Node",
  },
  lane: {
    border: "#cbd5e1",
    borderAlpha: "rgba(203,213,225,0.86)",
    bg: "#f8fbff",
    text: "#475569",
    tag: "#94a3b8",
    icon: "—",
    label: "Lane",
  },
  service: {
    border: "#8b5cf6",
    borderAlpha: "rgba(139,92,246,0.4)",
    bg: "#f5f3ff",
    text: "#6d28d9",
    tag: "#7c3aed",
    icon: "⚡",
    label: "Service",
  },
  ingress: {
    border: "#14b8a6",
    borderAlpha: "rgba(20,184,166,0.4)",
    bg: "#ecfeff",
    text: "#0f766e",
    tag: "#0d9488",
    icon: "↗",
    label: "Ingress",
  },
  ingressroute: {
    border: "#0f766e",
    borderAlpha: "rgba(15,118,110,0.4)",
    bg: "#ecfeff",
    text: "#155e75",
    tag: "#0f766e",
    icon: "⇢",
    label: "IngressRoute",
  },
  endpoints: {
    border: "#f59e0b",
    borderAlpha: "rgba(245,158,11,0.42)",
    bg: "#fffbeb",
    text: "#b45309",
    tag: "#d97706",
    icon: "◎",
    label: "Endpoints",
  },
  endpointslice: {
    border: "#f97316",
    borderAlpha: "rgba(249,115,22,0.42)",
    bg: "#fff7ed",
    text: "#c2410c",
    tag: "#ea580c",
    icon: "◌",
    label: "EndpointSlice",
  },
  deployment: {
    border: "#0ea5e9",
    borderAlpha: "rgba(14,165,233,0.4)",
    bg: "#eff8ff",
    text: "#0369a1",
    tag: "#0284c7",
    icon: "▶",
    label: "Deployment",
  },
  statefulset: {
    border: "#22c55e",
    borderAlpha: "rgba(34,197,94,0.4)",
    bg: "#f0fdf4",
    text: "#15803d",
    tag: "#16a34a",
    icon: "∞",
    label: "StatefulSet",
  },
  daemonset: {
    border: "#ef4444",
    borderAlpha: "rgba(239,68,68,0.38)",
    bg: "#fef2f2",
    text: "#b91c1c",
    tag: "#dc2626",
    icon: "◈",
    label: "DaemonSet",
  },
  pod: {
    border: "#64748b",
    borderAlpha: "rgba(100,116,139,0.36)",
    bg: "#f8fafc",
    text: "#334155",
    tag: "#475569",
    icon: "●",
    label: "Pod",
  },
} as const;

type TokenKey = keyof typeof TOKEN;
const ALL_NAMESPACE = "__all__";
const INFRA_TOKENS = new Set<TokenKey>(["cluster", "namespace", "instancegroup", "node"]);
const SOURCE_TOKEN_KEYS = [
  "service",
  "ingress",
  "ingressroute",
  "endpoints",
  "endpointslice",
  "deployment",
  "statefulset",
  "daemonset",
  "pod",
] as const satisfies readonly TokenKey[];
type SourceKey = (typeof SOURCE_TOKEN_KEYS)[number];
type ResourceFilter = "all" | "abnormal";
type GroupMode = "namespace" | "instance" | "node";
type ResourceDomainKey = "network" | "workload";
type GroupSectionKey = "network" | "workload" | "pod" | "other";
type TopologyViewMode = "namespace-overview" | "namespace-stack" | "resource-focus" | "free";
const RESOURCE_DOMAIN_KEYS = ["network", "workload"] as const satisfies readonly ResourceDomainKey[];
const STACK_TOKEN_ORDER: TokenKey[] = [
  "service",
  "ingress",
  "ingressroute",
  "endpoints",
  "endpointslice",
  "deployment",
  "statefulset",
  "daemonset",
  "pod",
];
const NETWORK_STACK_KEYS = new Set<TokenKey>([
  "service",
  "ingress",
  "ingressroute",
  "endpoints",
  "endpointslice",
]);
const WORKLOAD_STACK_KEYS = new Set<TokenKey>(["deployment", "statefulset", "daemonset"]);

interface TopoNodeData {
  label: string;
  typeLabel: string;
  tokenKey: TokenKey;
  status?: "Running" | "Pending" | "Failed" | "Unknown";
  replicas?: string;
  caption?: string;
  raw?: NetworkResource | WorkloadListItem | Record<string, unknown>;
}

type DetailRelationItem = {
  id: string;
  label: string;
  typeLabel: string;
  tokenKey: TokenKey;
  statusText?: string;
  secondaryText?: string;
  risk?: "high" | "medium";
};

type NamespaceSummary = {
  resourceCount: number;
  networkCount: number;
  workloadCount: number;
  podReplicaCount: number;
  readyReplicaCount: number;
  pendingReplicaCount: number;
};

const GROUP_MODE_ITEMS: Array<{ value: GroupMode; label: string }> = [
  { value: "namespace", label: "名称空间" },
  { value: "instance", label: "实例" },
  { value: "node", label: "节点" },
];

const NODE_W = 164;
const NODE_H = 68;
type TopologyEdgeRole = "scope" | "relation" | "ownership" | "group";
type TopologyEdgeData = {
  topologyRole?: TopologyEdgeRole;
};

type TopologyResourceDetailRequest = {
  kind: string;
  id: string;
  label?: string;
  snapshot?: {
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
    labels?: Record<string, string>;
  };
};
type TopologyFailureCategory = "service-unavailable" | "network-timeout" | "auth" | "unknown";

function resolveErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown };
  return typeof candidate.status === "number" ? candidate.status : null;
}

function resolveErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "无法拉取集群数据";
  const candidate = error as { message?: unknown };
  return typeof candidate.message === "string" && candidate.message.trim()
    ? candidate.message.trim()
    : "无法拉取集群数据";
}

function resolveFailureCategory(errors: unknown[]): TopologyFailureCategory {
  const statuses = errors.map(resolveErrorStatus).filter((value): value is number => value !== null);
  if (statuses.includes(401) || statuses.includes(403)) return "auth";
  if (statuses.includes(503) || statuses.includes(502) || statuses.includes(504)) return "service-unavailable";
  const messages = errors.map(resolveErrorMessage).join(" ").toLowerCase();
  if (messages.includes("timeout") || messages.includes("timed out") || messages.includes("network")) {
    return "network-timeout";
  }
  return "unknown";
}

function getFailureCopy(category: TopologyFailureCategory): { title: string; description: string } {
  if (category === "auth") {
    return {
      title: "集群鉴权失败",
      description: "当前凭据无权读取拓扑资源，请检查登录状态与集群授权。",
    };
  }
  if (category === "service-unavailable") {
    return {
      title: "集群服务暂不可达",
      description: "后端服务返回 5xx，拓扑数据拉取失败。可稍后重试或检查 control-api / k8s 连接。",
    };
  }
  if (category === "network-timeout") {
    return {
      title: "网络或超时异常",
      description: "请求超时或网络抖动导致拓扑拉取失败，请检查网络与集群链路。",
    };
  }
  return {
    title: "拓扑数据不可用",
    description: "无法获取当前集群拓扑数据，请重试或查看后端日志。",
  };
}

function resolveNetworkTokenKey(kind: string): SourceKey {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "ingressroute") return "ingressroute";
  if (normalized === "ingress") return "ingress";
  if (normalized === "endpoints") return "endpoints";
  if (normalized === "endpointslice") return "endpointslice";
  return "service";
}

function getNodeNamespace(node: Node<TopoNodeData>): string | null {
  if (node.data.tokenKey === "namespace") return node.data.label;
  const raw = node.data.raw as { namespace?: unknown } | undefined;
  return typeof raw?.namespace === "string" ? raw.namespace : null;
}

function isSourceKey(value: string): value is SourceKey {
  return SOURCE_TOKEN_KEYS.includes(value as SourceKey);
}

const RESOURCE_DOMAIN_META: Record<
  ResourceDomainKey,
  { label: string; shortLabel: string; icon: React.ReactNode; keys: SourceKey[] }
> = {
  network: {
    label: "网络资源域",
    shortLabel: "网络域",
    icon: <RadarChartOutlined />,
    keys: ["service", "ingress", "ingressroute", "endpoints", "endpointslice"],
  },
  workload: {
    label: "工作负载域",
    shortLabel: "工作负载域",
    icon: <BranchesOutlined />,
    keys: ["deployment", "statefulset", "daemonset", "pod"],
  },
}

function buildEdge(
  source: string,
  target: string,
  overrides: Partial<Edge> & { data?: TopologyEdgeData } = {},
): Edge {
  const style =
    overrides.style
      ? {
          ...EDGE_STYLE,
          ...overrides.style,
        }
      : EDGE_STYLE;

  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: "step",
    animated: false,
    className: `topology-flow-edge topology-flow-edge--${(overrides.data?.topologyRole ?? "relation") as TopologyEdgeRole}`,
    style,
      data: {
        topologyRole: "relation",
        ...(overrides.data ?? {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--topology-overview-edge)",
        width: 13,
        height: 13,
      },
      ...overrides,
    };
}

function sortByStackTokenOrder(left: Node<TopoNodeData>, right: Node<TopoNodeData>): number {
  const leftOrder = STACK_TOKEN_ORDER.indexOf(left.data.tokenKey);
  const rightOrder = STACK_TOKEN_ORDER.indexOf(right.data.tokenKey);
  const normalizedLeft = leftOrder >= 0 ? leftOrder : STACK_TOKEN_ORDER.length;
  const normalizedRight = rightOrder >= 0 ? rightOrder : STACK_TOKEN_ORDER.length;
  if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
  return left.data.label.localeCompare(right.data.label);
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function deriveRiskLevel(total: number, abnormal: number): "high" | "medium" | "low" {
  if (total <= 0) return "low";
  const ratio = abnormal / total;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.2) return "medium";
  return "low";
}

function deriveNodeName(namespace: string, controllerId: string, podIndex: number, clusterId: string): string {
  const slots = ["worker-a", "worker-b", "worker-c", "worker-d"];
  const slot = hashText(`${clusterId}:${namespace}:${controllerId}:${podIndex}`) % slots.length;
  return `${namespace}/${slots[slot]}`;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toStringRecord(value: unknown): Record<string, string> {
  const source = toObject(value);
  const entries = Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

function normalizeResourceKind(kind: string | undefined): string {
  return (kind ?? "").trim().toLowerCase();
}

function extractServiceSelector(resource: NetworkResource): Record<string, string> {
  return toStringRecord(toObject(resource.spec).selector);
}

function extractWorkloadTemplateLabels(workload: WorkloadListItem): Record<string, string> {
  const spec = toObject(workload.spec);
  const template = toObject(spec.template);
  const metadata = toObject(template.metadata);
  const templateLabels = toStringRecord(metadata.labels);
  if (Object.keys(templateLabels).length > 0) return templateLabels;
  return workload.labels ?? {};
}

function extractWorkloadSelectorLabels(workload: WorkloadListItem): Record<string, string> {
  const spec = toObject(workload.spec);
  const selector = toObject(spec.selector);
  const matchLabels = toStringRecord(selector.matchLabels);
  if (Object.keys(matchLabels).length > 0) return matchLabels;
  return workload.labels ?? {};
}

function labelsMatch(selector: Record<string, string>, labels: Record<string, string>): boolean {
  const entries = Object.entries(selector);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => labels[key] === value);
}

function extractIngressServiceNames(specInput: unknown): string[] {
  const spec = toObject(specInput);
  const names = new Set<string>();
  for (const rule of toArray(spec.rules)) {
    const http = toObject(toObject(rule).http);
    for (const path of toArray(http.paths)) {
      const service = toObject(toObject(toObject(path).backend).service);
      const serviceName = toStringValue(service.name);
      if (serviceName) names.add(serviceName);
    }
  }
  return Array.from(names);
}

function extractIngressRouteServiceNames(specInput: unknown): string[] {
  const spec = toObject(specInput);
  const names = new Set<string>();
  for (const route of toArray(spec.routes)) {
    for (const service of toArray(toObject(route).services)) {
      const serviceName = toStringValue(toObject(service).name);
      if (serviceName) names.add(serviceName);
    }
  }
  return Array.from(names);
}

function extractEndpointSliceServiceNames(resource: NetworkResource): string[] {
  const fromLabel = resource.labels?.["kubernetes.io/service-name"];
  if (fromLabel?.trim()) return [fromLabel.trim()];
  return [];
}

function extractEndpointTargetPodNames(resource: NetworkResource): string[] {
  const names = new Set<string>();
  const kind = normalizeResourceKind(resource.kind);

  if (kind === "endpoints") {
    for (const subset of toArray(toObject(resource.spec).subsets)) {
      for (const address of toArray(toObject(subset).addresses)) {
        const targetRef = toObject(toObject(address).targetRef);
        if (toStringValue(targetRef.kind) !== "Pod") continue;
        const podName = toStringValue(targetRef.name);
        if (podName) names.add(podName);
      }
    }
    for (const address of toArray(toObject(resource.statusJson).addresses)) {
      const targetRef = toObject(toObject(address).targetRef);
      if (toStringValue(targetRef.kind) !== "Pod") continue;
      const podName = toStringValue(targetRef.name);
      if (podName) names.add(podName);
    }
  }

  if (kind === "endpointslice") {
    for (const endpoint of toArray(toObject(resource.spec).endpoints)) {
      const targetRef = toObject(toObject(endpoint).targetRef);
      if (toStringValue(targetRef.kind) !== "Pod") continue;
      const podName = toStringValue(targetRef.name);
      if (podName) names.add(podName);
    }
  }

  return Array.from(names);
}

function controllerOwnsPodName(controller: WorkloadListItem, podName: string): boolean {
  const normalizedPodName = podName.trim();
  if (!normalizedPodName) return false;
  if (normalizedPodName === controller.name) return true;
  if (!normalizedPodName.startsWith(`${controller.name}-`)) return false;
  return true;
}

function resolveResourceDetailRequest(node: Node<TopoNodeData> | null): TopologyResourceDetailRequest | null {
  if (!node) return null;
  if (node.data.tokenKey === "namespace" || node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node") {
    return null;
  }

  const raw = (node.data.raw as { id?: unknown; kind?: unknown } | undefined) ?? undefined;
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  const kind = typeof raw?.kind === "string" ? raw.kind.trim() : "";
  if (!id || !kind) return null;
  const snapshot = {
    spec: (raw as { spec?: unknown } | undefined)?.spec as Record<string, unknown> | undefined,
    status: (raw as { status?: unknown } | undefined)?.status as Record<string, unknown> | undefined,
    labels: (raw as { labels?: unknown } | undefined)?.labels as Record<string, string> | undefined,
  };
  return {
    id,
    kind,
    label: node.data.label,
    snapshot:
      snapshot.spec || snapshot.status || snapshot.labels
        ? {
            spec: snapshot.spec,
            status: snapshot.status,
            labels: snapshot.labels,
          }
        : undefined,
  };
}

function isGroupTokenKey(tokenKey: TokenKey): boolean {
  return tokenKey === "namespace" || tokenKey === "instancegroup" || tokenKey === "node";
}

function applyDagreLayout(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
  options?: { nodesep?: number; ranksep?: number; marginx?: number; marginy?: number; rankdir?: "LR" | "TB" },
): Node<TopoNodeData>[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options?.rankdir ?? "LR",
    nodesep: options?.nodesep ?? 60,
    ranksep: options?.ranksep ?? 146,
    marginx: options?.marginx ?? 84,
    marginy: options?.marginy ?? 78,
  });

  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: { x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 },
    };
  });
}

type ComponentLayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  hasSemanticEdges: boolean;
};

function estimateNodeHeight(node: Node<TopoNodeData>): number {
  const raw = node.data.raw as {
    layoutLane?: unknown;
    layoutGroupPanel?: unknown;
    networkCount?: unknown;
    workloadCount?: unknown;
    podReplicaCount?: unknown;
    status?: unknown;
    replicas?: unknown;
    caption?: unknown;
  } | undefined;
  if (raw?.layoutLane === true) return 40;
  if (raw?.layoutGroupPanel === true) return 42;

  let height = NODE_H;
  if (node.data.tokenKey === "namespace") {
    height = 118;
    if (typeof raw?.networkCount === "number" || typeof raw?.workloadCount === "number" || typeof raw?.podReplicaCount === "number") {
      height += 26;
    }
  } else if (node.data.tokenKey === "cluster" || node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node") {
    height = 96;
  }

  if (typeof node.data.status === "string") {
    height += 10;
  }
  if (typeof node.data.replicas === "string") {
    height += 8;
  }
  if (typeof raw?.caption === "string" && raw.caption.trim()) {
    height += 8;
  }
  return Math.max(height, NODE_H);
}

function layoutComponentBlock(members: Node<TopoNodeData>[], edges: Edge[]): ComponentLayoutResult {
  const memberIds = new Set(members.map((member) => member.id));
  const semanticEdges = edges.filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target));
  const hasSemanticEdges = semanticEdges.length > 0;
  const positions = new Map<string, { x: number; y: number }>();

  if (members.length === 0) {
    return { positions, width: 0, height: 0, hasSemanticEdges };
  }

  if (hasSemanticEdges) {
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: "TB",
      nodesep: 28,
      ranksep: 34,
      marginx: 0,
      marginy: 0,
    });

    members.forEach((member) => graph.setNode(member.id, { width: NODE_W, height: estimateNodeHeight(member) }));
    semanticEdges.forEach((edge) => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    members.forEach((member) => {
      const position = graph.node(member.id);
      if (!position) return;
      const x = position.x - NODE_W / 2;
      const y = position.y - estimateNodeHeight(member) / 2;
      positions.set(member.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + estimateNodeHeight(member));
    });

    const paddingX = 18;
    const paddingY = 16;
    positions.forEach((position, id) => {
      positions.set(id, {
        x: position.x - minX + paddingX,
        y: position.y - minY + paddingY,
      });
    });

    return {
      positions,
      width: Math.max(0, maxX - minX) + paddingX * 2,
      height: Math.max(0, maxY - minY) + paddingY * 2,
      hasSemanticEdges,
    };
  }

  const columns = Math.min(3, Math.max(1, members.length >= 5 ? 3 : members.length >= 2 ? 2 : 1));
  const gapX = 18;
  const gapY = 14;
  const paddingX = 18;
  const paddingY = 16;

  members.forEach((member, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const height = estimateNodeHeight(member);
    positions.set(member.id, {
      x: paddingX + col * (NODE_W + gapX),
      y: paddingY + row * (height + gapY),
    });
  });

  const rows = Math.max(1, Math.ceil(members.length / columns));
  return {
    positions,
    width: paddingX * 2 + columns * NODE_W + Math.max(0, columns - 1) * gapX,
    height: paddingY * 2 + rows * Math.max(...members.map((member) => estimateNodeHeight(member))) + Math.max(0, rows - 1) * gapY,
    hasSemanticEdges,
  };
}

const EDGE_STYLE: React.CSSProperties = {
  stroke: "var(--topology-overview-edge)",
  strokeWidth: 1.28,
  opacity: 0.66,
};

function buildFlowGraph(
  clusterName: string,
  clusterId: string,
  networkResources: NetworkResource[],
  deployments: WorkloadListItem[],
  statefulsets: WorkloadListItem[],
  daemonsets: WorkloadListItem[],
  groupMode: GroupMode,
): { nodes: Node<TopoNodeData>[]; edges: Edge[] } {
  const activeNetwork = networkResources.filter((item) => item.state !== "deleted");
  const controllers = [
    ...deployments
      .filter((item) => item.state !== "deleted")
      .map((item) => ({ ...item, _subKind: "deployment" as const })),
    ...statefulsets
      .filter((item) => item.state !== "deleted")
      .map((item) => ({ ...item, _subKind: "statefulset" as const })),
    ...daemonsets
      .filter((item) => item.state !== "deleted")
      .map((item) => ({ ...item, _subKind: "daemonset" as const })),
  ];

  const namespaces = Array.from(
    new Set([
      ...activeNetwork.map((item) => item.namespace),
      ...controllers.map((item) => item.namespace),
    ]),
  ).sort();

  if (namespaces.length === 0) namespaces.push("default");

  const nodes: Node<TopoNodeData>[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  const clusterNodeId = `cluster-${clusterId}`;
  const useNamespaceGroups = groupMode === "namespace";
  const namespaceSummaries = new Map<string, NamespaceSummary>();
  const networkNodeIdByResourceId = new Map<string, string>();
  const serviceNodeIdByNamespaceName = new Map<string, string>();
  const controllerNodeIdById = new Map<string, string>();
  const controllersByNamespace = new Map<string, WorkloadListItem[]>();
  const hasSemanticEdge = new Set<string>();
  const nodePool = new Map<
    string,
    {
      podCount: number;
      readyPods: number;
      namespaces: Set<string>;
    }
  >();

  const pushEdge = (edge: Edge) => {
    if (edgeIds.has(edge.id)) return;
    edgeIds.add(edge.id);
    edges.push(edge);
  };

  nodes.push({
    id: clusterNodeId,
    type: "topo",
    position: { x: 0, y: 0 },
    data: {
      label: clusterName,
      typeLabel: "cluster",
      tokenKey: "cluster",
    },
  });

  namespaces.forEach((namespace) => {
    const namespaceNetwork = activeNetwork.filter((item) => item.namespace === namespace);
    const namespaceControllers = controllers.filter((item) => item.namespace === namespace);
    const podReplicaCount = namespaceControllers.reduce((total, item) => total + Math.max(item.replicas ?? 0, 0), 0);
    const readyReplicaCount = namespaceControllers.reduce(
      (total, item) => total + Math.max(item.readyReplicas ?? 0, 0),
      0,
    );
    namespaceSummaries.set(namespace, {
      resourceCount: namespaceNetwork.length + namespaceControllers.length + podReplicaCount,
      networkCount: namespaceNetwork.length,
      workloadCount: namespaceControllers.length,
      podReplicaCount,
      readyReplicaCount,
      pendingReplicaCount: Math.max(podReplicaCount - readyReplicaCount, 0),
    });
  });

  if (useNamespaceGroups) {
    namespaces.forEach((namespace) => {
      const namespaceId = `ns-${namespace}`;
      const summary = namespaceSummaries.get(namespace);
      nodes.push({
        id: namespaceId,
        type: "topo",
        position: { x: 0, y: 0 },
        data: {
          label: namespace,
          typeLabel: "namespace",
          tokenKey: "namespace",
          caption: "scope boundary",
          raw: summary
            ? {
                namespace,
                podCount: summary.resourceCount,
                readyPods: summary.readyReplicaCount,
                pendingPods: summary.pendingReplicaCount,
                networkCount: summary.networkCount,
                workloadCount: summary.workloadCount,
                podReplicaCount: summary.podReplicaCount,
                mode: "namespace",
              }
            : { namespace, mode: "namespace" },
        },
      });
      pushEdge(
        buildEdge(clusterNodeId, namespaceId, {
          style: {
            strokeWidth: 1.06,
            opacity: 0.34,
          },
          data: { topologyRole: "scope" },
          markerEnd: undefined,
        }),
      );
    });
  }

  activeNetwork.forEach((resource) => {
    const tokenKey = resolveNetworkTokenKey(String(resource.kind));
    const networkNodeId = `net-${resource.id}`;
    nodes.push({
      id: networkNodeId,
      type: "topo",
      position: { x: 0, y: 0 },
      data: {
        label: resource.name,
        typeLabel: resource.kind,
        tokenKey,
        caption: resource.namespace,
        raw: resource,
      },
    });
    networkNodeIdByResourceId.set(resource.id, networkNodeId);
    if (normalizeResourceKind(resource.kind) === "service") {
      serviceNodeIdByNamespaceName.set(`${resource.namespace}/${resource.name}`, networkNodeId);
    }
  });

  controllers.forEach((controller) => {
    const controllerId = `ctrl-${controller.id}`;
    const ready = controller.readyReplicas ?? 0;
    const total = controller.replicas ?? 0;

    let status: TopoNodeData["status"] = "Unknown";
    if (total === 0) status = "Pending";
    else if (ready >= total) status = "Running";
    else if (ready > 0) status = "Pending";
    else status = "Failed";

    nodes.push({
      id: controllerId,
      type: "topo",
      position: { x: 0, y: 0 },
      data: {
        label: controller.name,
        typeLabel: controller.kind || controller._subKind,
        tokenKey: controller._subKind,
        status,
        replicas: `${ready}/${total}`,
        caption: controller.namespace,
        raw: controller,
      },
    });
    controllerNodeIdById.set(controller.id, controllerId);
    const namespaceControllers = controllersByNamespace.get(controller.namespace) ?? [];
    namespaceControllers.push(controller);
    controllersByNamespace.set(controller.namespace, namespaceControllers);

    const podCount = Math.min(total || 1, groupMode === "namespace" ? 4 : 6);
    const instanceGroupId = `instance-${controller.id}`;

    if (groupMode === "instance") {
      const pendingPods = Math.max(podCount - ready, 0);
      nodes.push({
        id: instanceGroupId,
        type: "topo",
        position: { x: 0, y: 0 },
        data: {
          label: `${controller.name} instances`,
          typeLabel: "Instance set",
          tokenKey: "instancegroup",
          caption: `${podCount} pods · ${ready} ready`,
          raw: {
            namespace: controller.namespace,
            controller: controller.name,
            podCount,
            readyPods: ready,
            pendingPods,
            abnormalPods: pendingPods,
            riskLevel: deriveRiskLevel(podCount, pendingPods),
            mode: "instance",
          },
        },
      });
      pushEdge(
        buildEdge(controllerId, instanceGroupId, {
          style: {
            strokeWidth: 1,
            opacity: 0.34,
          },
          data: { topologyRole: "group" },
          markerEnd: undefined,
        }),
      );
    }

    for (let index = 0; index < podCount; index += 1) {
      const podReady = index < ready;
      const podId = `pod-${controller.id}-${index}`;
      const podStatus: TopoNodeData["status"] = podReady ? "Running" : "Pending";
      const suffix = (controller.id.slice(-4) + index.toString(16)).slice(-5);
      const nodeName = deriveNodeName(controller.namespace, controller.id, index, clusterId);

      if (groupMode === "node") {
        const currentNode = nodePool.get(nodeName) ?? {
          podCount: 0,
          readyPods: 0,
          namespaces: new Set<string>(),
        };
        currentNode.podCount += 1;
        currentNode.readyPods += podReady ? 1 : 0;
        currentNode.namespaces.add(controller.namespace);
        nodePool.set(nodeName, currentNode);
      }

      nodes.push({
        id: podId,
        type: "topo",
        position: { x: 0, y: 0 },
        data: {
          label: `${controller.name.slice(0, 10)}-${suffix}`,
          typeLabel: "Pod",
          tokenKey: "pod",
          status: podStatus,
          caption: groupMode === "node" ? nodeName : controller.namespace,
          raw: {
            namespace: controller.namespace,
            phase: podStatus,
            controller: controller.name,
            nodeName,
          },
        },
      });

      pushEdge(
        buildEdge(groupMode === "instance" ? instanceGroupId : controllerId, podId, {
          style: {
            opacity: podReady ? 0.34 : 0.2,
            strokeDasharray: podReady ? undefined : "4 3",
          },
          data: {
            topologyRole: groupMode === "instance" ? "group" : "ownership",
          },
          markerEnd: undefined,
        }),
      );

      if (groupMode === "node") {
        pushEdge(
          buildEdge(podId, `node-${nodeName}`, {
            style: {
              strokeWidth: 0.92,
              opacity: podReady ? 0.24 : 0.16,
              strokeDasharray: podReady ? "6 4" : "3 5",
            },
            data: { topologyRole: "group" },
            markerEnd: undefined,
          }),
        );
      }
    }
  });

  if (groupMode === "node") {
    Array.from(nodePool.entries())
      .sort((left, right) => right[1].podCount - left[1].podCount || left[0].localeCompare(right[0]))
      .forEach(([nodeName, stats]) => {
        const nodeId = `node-${nodeName}`;
        nodes.push({
          id: nodeId,
          type: "topo",
          position: { x: 0, y: 0 },
          data: {
            label: nodeName,
            typeLabel: "Node",
            tokenKey: "node",
            caption: `${stats.podCount} pods · ${stats.readyPods} ready`,
            raw: {
              namespace: Array.from(stats.namespaces).sort().join(", "),
              nodeName,
              podCount: stats.podCount,
              readyPods: stats.readyPods,
              pendingPods: Math.max(stats.podCount - stats.readyPods, 0),
              abnormalPods: Math.max(stats.podCount - stats.readyPods, 0),
              riskLevel: deriveRiskLevel(
                stats.podCount,
                Math.max(stats.podCount - stats.readyPods, 0),
              ),
              mode: "node",
            },
          },
        });

        pushEdge(
          buildEdge(clusterNodeId, nodeId, {
            style: {
              strokeWidth: 0.92,
              opacity: 0.18,
            },
            data: { topologyRole: "scope" },
            markerEnd: undefined,
          }),
        );
      });
  }

  const registerSemanticLink = (sourceId: string, targetId: string, role: TopologyEdgeRole = "relation") => {
    hasSemanticEdge.add(sourceId);
    hasSemanticEdge.add(targetId);
    pushEdge(
      buildEdge(sourceId, targetId, {
        data: { topologyRole: role },
        style:
          role === "ownership"
            ? {
                strokeWidth: 1.02,
                opacity: 0.32,
              }
            : {
                strokeWidth: 1.06,
                opacity: 0.34,
              },
        markerEnd: undefined,
      }),
    );
  };

  activeNetwork.forEach((resource) => {
    const sourceNodeId = networkNodeIdByResourceId.get(resource.id);
    if (!sourceNodeId) return;
    const kind = normalizeResourceKind(resource.kind);

    if (kind === "ingress") {
      extractIngressServiceNames(resource.spec).forEach((serviceName) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${serviceName}`);
        if (serviceNodeId) registerSemanticLink(sourceNodeId, serviceNodeId);
      });
      return;
    }

    if (kind === "ingressroute") {
      extractIngressRouteServiceNames(resource.spec).forEach((serviceName) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${serviceName}`);
        if (serviceNodeId) registerSemanticLink(sourceNodeId, serviceNodeId);
      });
      return;
    }

    if (kind === "endpoints") {
      const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${resource.name}`);
      if (serviceNodeId) {
        registerSemanticLink(serviceNodeId, sourceNodeId);
        const podNames = extractEndpointTargetPodNames(resource);
        const namespaceControllers = controllersByNamespace.get(resource.namespace) ?? [];
        namespaceControllers.forEach((controller) => {
          if (!podNames.some((podName) => controllerOwnsPodName(controller, podName))) return;
          const controllerNodeId = controllerNodeIdById.get(controller.id);
          if (controllerNodeId) registerSemanticLink(serviceNodeId, controllerNodeId);
        });
      }
      return;
    }

    if (kind === "endpointslice") {
      extractEndpointSliceServiceNames(resource).forEach((serviceName) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${serviceName}`);
        if (!serviceNodeId) return;
        registerSemanticLink(serviceNodeId, sourceNodeId);
        const podNames = extractEndpointTargetPodNames(resource);
        const namespaceControllers = controllersByNamespace.get(resource.namespace) ?? [];
        namespaceControllers.forEach((controller) => {
          if (!podNames.some((podName) => controllerOwnsPodName(controller, podName))) return;
          const controllerNodeId = controllerNodeIdById.get(controller.id);
          if (controllerNodeId) registerSemanticLink(serviceNodeId, controllerNodeId);
        });
      });
      return;
    }

    if (kind === "service") {
      const selector = extractServiceSelector(resource);
      if (Object.keys(selector).length === 0) return;
      controllers.forEach((controller) => {
        if (controller.namespace !== resource.namespace) return;
        const templateLabels = extractWorkloadTemplateLabels(controller);
        const selectorLabels = extractWorkloadSelectorLabels(controller);
        if (!labelsMatch(selector, templateLabels) && !labelsMatch(selector, selectorLabels)) {
          return;
        }
        const controllerNodeId = controllerNodeIdById.get(controller.id);
        if (controllerNodeId) registerSemanticLink(sourceNodeId, controllerNodeId);
      });
    }
  });

  activeNetwork.forEach((resource) => {
    const networkNodeId = networkNodeIdByResourceId.get(resource.id);
    if (!networkNodeId || hasSemanticEdge.has(networkNodeId)) return;
    const namespaceId = `ns-${resource.namespace}`;
    pushEdge(
      buildEdge(useNamespaceGroups ? namespaceId : clusterNodeId, networkNodeId, {
        style: useNamespaceGroups
          ? {
              strokeWidth: 0.98,
              opacity: 0.28,
            }
          : {
              strokeWidth: 0.92,
              opacity: 0.2,
            },
        data: { topologyRole: "scope" },
        markerEnd: undefined,
      }),
    );
  });

  controllers.forEach((controller) => {
    const controllerNodeId = controllerNodeIdById.get(controller.id);
    if (!controllerNodeId || hasSemanticEdge.has(controllerNodeId)) return;
    const namespaceId = `ns-${controller.namespace}`;
    pushEdge(
      buildEdge(useNamespaceGroups ? namespaceId : clusterNodeId, controllerNodeId, {
        style: useNamespaceGroups
          ? {
              strokeWidth: 0.98,
              opacity: 0.32,
            }
          : {
              strokeWidth: 0.92,
              opacity: 0.2,
            },
        data: { topologyRole: "scope" },
        markerEnd: undefined,
      }),
    );
  });

  return {
    nodes: applyDagreLayout(nodes, edges),
    edges,
  };
}

function applyNamespaceStackLayout(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
  expandedGroupIds: string[],
  focusedNamespaceId?: string | null,
  componentIdByNodeId?: Map<string, string>,
  componentNodeIdsById?: Map<string, string[]>,
): Node<TopoNodeData>[] {
  if (nodes.length === 0) return nodes;
  const clusterNode = nodes.find((node) => node.data.tokenKey === "cluster");
  const namespaceNodes = nodes
    .filter((node) => node.data.tokenKey === "namespace")
    .sort((left, right) => left.data.label.localeCompare(right.data.label));
  if (!clusterNode || namespaceNodes.length === 0) return nodes;

  if (focusedNamespaceId) {
    namespaceNodes.sort((left, right) => {
      if (left.id === focusedNamespaceId) return -1;
      if (right.id === focusedNamespaceId) return 1;
      return left.data.label.localeCompare(right.data.label);
    });
  }

  const groupMembers = new Map<string, Node<TopoNodeData>[]>();
  namespaceNodes.forEach((namespaceNode) => {
    const members = nodes
      .filter((node) => {
        if (node.id === clusterNode.id || node.id === namespaceNode.id) return false;
        if (node.data.tokenKey === "namespace") return false;
        return getNodeNamespace(node) === namespaceNode.data.label;
      })
      .sort(sortByStackTokenOrder);
    groupMembers.set(namespaceNode.id, members);
  });

  const positioned = new Map<string, { x: number; y: number }>();
  const syntheticNodes: Node<TopoNodeData>[] = [];
  const collapsedCardW = 236;
  const collapsedCardH = 112;
  const expandedHeaderH = 118;
  const panelPaddingX = 24;
  const panelPaddingY = 20;
  const componentGapY = 18;
  const clusterX = 34;
  const clusterY = 92;
  const startX = 286;
  const startY = 34;
  const colGap = 22;
  const rowGap = 26;
  const maxCols = 3;
  let cursorX = startX;
  let cursorY = startY;
  let currentRowHeight = 0;

  positioned.set(clusterNode.id, { x: clusterX, y: clusterY });

  namespaceNodes.forEach((namespaceNode) => {
    const members = groupMembers.get(namespaceNode.id) ?? [];
    const expanded = expandedGroupIds.includes(namespaceNode.id);
    const orderedMembers = [...members];
    const componentBuckets: Array<{ componentId: string; members: Node<TopoNodeData>[] }> = [];
    if (expanded) {
      const orderedComponentIds: string[] = [];
      const componentMembersById = new Map<string, Node<TopoNodeData>[]>();
      orderedMembers.forEach((member) => {
        const componentId = componentIdByNodeId?.get(member.id);
        if (!componentId) return;
        if (!orderedComponentIds.includes(componentId)) orderedComponentIds.push(componentId);
        const componentMemberIds = componentNodeIdsById?.get(componentId) ?? [];
        const bucketMembers = orderedMembers.filter((item) => componentMemberIds.includes(item.id));
        if (bucketMembers.length === 0) return;
        componentMembersById.set(componentId, bucketMembers);
      });
      orderedComponentIds.forEach((componentId) => {
        const bucketMembers = componentMembersById.get(componentId);
        if (!bucketMembers || bucketMembers.length === 0) return;
        componentBuckets.push({ componentId, members: bucketMembers });
      });
    }
    const componentMetrics = expanded
      ? componentBuckets.map((component) => {
          const sortedMembers = [...component.members].sort(sortByStackTokenOrder);
          const componentMemberIds = new Set(component.members.map((member) => member.id));
          const componentEdges = edges.filter((edge) => componentMemberIds.has(edge.source) && componentMemberIds.has(edge.target));
          const layout = layoutComponentBlock(sortedMembers, componentEdges);
          return {
            componentId: component.componentId,
            members: sortedMembers,
            layout,
            hasSemanticEdges: layout.hasSemanticEdges,
          };
        })
      : [];
    const panelWidth = expanded
      ? panelPaddingX * 2 + Math.max(0, ...componentMetrics.map((component) => component.layout.width))
      : collapsedCardW;
    const resourceBodyHeight = expanded
      ? componentMetrics.reduce(
          (total, component, index) => total + component.layout.height + (index > 0 ? componentGapY : 0),
          0,
        )
      : 0;
    const panelHeight = expanded ? expandedHeaderH + panelPaddingY + resourceBodyHeight + panelPaddingY : collapsedCardH;

    if (cursorX > startX && cursorX + panelWidth > startX + maxCols * (collapsedCardW + colGap)) {
      cursorX = startX;
      cursorY += currentRowHeight + rowGap;
      currentRowHeight = 0;
    }

    positioned.set(namespaceNode.id, {
      x: cursorX + 18,
      y: cursorY + 16,
    });

    if (expanded) {
      syntheticNodes.push({
        id: `panel-${namespaceNode.id}`,
        type: "topo",
        position: { x: cursorX, y: cursorY },
        draggable: false,
        selectable: false,
        zIndex: -1,
        data: {
          label: "",
          typeLabel: "lane",
          tokenKey: "lane",
          raw: {
            layoutGroupPanel: true,
            layoutWidth: panelWidth,
            layoutHeight: panelHeight,
          },
        },
      });

      let componentCursorY = cursorY + expandedHeaderH + panelPaddingY;
      componentMetrics.forEach((component, index) => {
        const localGapY = component.hasSemanticEdges ? 20 : 14;
        syntheticNodes.push({
          id: `panel-${namespaceNode.id}-${component.componentId}`,
          type: "topo",
          position: { x: cursorX + panelPaddingX, y: componentCursorY },
          draggable: false,
          selectable: false,
          zIndex: -2,
          data: {
            label: "",
            typeLabel: "lane",
            tokenKey: "lane",
            raw: {
              layoutGroupPanel: true,
              layoutWidth: component.layout.width,
              layoutHeight: component.layout.height,
            },
          },
        });

        component.members.forEach((member) => {
          const localPosition = component.layout.positions.get(member.id);
          if (!localPosition) return;
          positioned.set(member.id, {
            x: cursorX + panelPaddingX + localPosition.x,
            y: componentCursorY + localPosition.y,
          });
        });

        componentCursorY += component.layout.height;
        if (index < componentMetrics.length - 1) {
          componentCursorY += localGapY;
        }
      });
    }

    currentRowHeight = Math.max(currentRowHeight, panelHeight);

    if (expanded) {
      cursorX = startX;
      cursorY += currentRowHeight + rowGap;
      currentRowHeight = 0;
    } else {
      cursorX += panelWidth + colGap;
      const cardIndexInRow = Math.round((cursorX - startX) / (collapsedCardW + colGap));
      if (cardIndexInRow >= maxCols) {
        cursorX = startX;
        cursorY += currentRowHeight + rowGap;
        currentRowHeight = 0;
      }
    }
  });

  const layoutNodes = nodes.map((node) => {
    const nextPosition = positioned.get(node.id);
    if (!nextPosition) return node;
    return {
      ...node,
      position: nextPosition,
    };
  });

  return [...syntheticNodes, ...layoutNodes];
}

function applyNamespaceOverviewLayout(
  nodes: Node<TopoNodeData>[],
  focusedNamespaceId?: string | null,
): Node<TopoNodeData>[] {
  const namespaceNodes = nodes
    .filter((node) => node.data.tokenKey === "namespace")
    .sort((left, right) => {
      if (focusedNamespaceId) {
        if (left.id === focusedNamespaceId) return -1;
        if (right.id === focusedNamespaceId) return 1;
      }
      const leftCount = Number((left.data.raw as { podCount?: unknown } | undefined)?.podCount ?? 0);
      const rightCount = Number((right.data.raw as { podCount?: unknown } | undefined)?.podCount ?? 0);
      if (leftCount !== rightCount) return rightCount - leftCount;
      return left.data.label.localeCompare(right.data.label);
    });

  if (namespaceNodes.length === 0) return nodes;

  const positioned = new Map<string, { x: number; y: number }>();
  const cardW = 286;
  const cardH = 138;
  const startX = 42;
  const startY = 34;
  const gapX = 26;
  const gapY = 24;
  const maxCols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(namespaceNodes.length))));

  namespaceNodes.forEach((node, index) => {
    const row = Math.floor(index / maxCols);
    const col = index % maxCols;
    positioned.set(node.id, {
      x: startX + col * (cardW + gapX),
      y: startY + row * (cardH + gapY),
    });
  });

  return nodes
    .filter((node) => node.data.tokenKey === "namespace")
    .map((node) => ({
      ...node,
      position: positioned.get(node.id) ?? node.position,
    }));
}

function applyFocusedRelationLayout(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
): Node<TopoNodeData>[] {
  const focusNodes = nodes.filter((node) => {
    if (node.data.tokenKey === "cluster" || node.data.tokenKey === "namespace") return false;
    const raw = node.data.raw as { layoutLane?: unknown; layoutGroupPanel?: unknown } | undefined;
    return raw?.layoutLane !== true && raw?.layoutGroupPanel !== true;
  });
  if (focusNodes.length === 0) return nodes;

  const layoutNodes = applyDagreLayout(focusNodes, edges, {
    rankdir: "LR",
    nodesep: 44,
    ranksep: 96,
    marginx: 0,
    marginy: 0,
  });

  const minX = Math.min(...layoutNodes.map((node) => node.position.x));
  const minY = Math.min(...layoutNodes.map((node) => node.position.y));
  const maxX = Math.max(
    ...layoutNodes.map((node) => node.position.x + (typeof node.width === "number" ? node.width : NODE_W)),
  );
  const maxY = Math.max(...layoutNodes.map((node) => node.position.y + estimateNodeHeight(node)));

  const offsetX = 78 - minX;
  const offsetY = 58 - minY;
  const shellWidth = Math.max(540, maxX - minX + 156);
  const shellHeight = Math.max(320, maxY - minY + 128);

  const shiftedNodes = layoutNodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    },
  }));

  const shellNode: Node<TopoNodeData> = {
    id: "focus-shell",
    type: "topo",
    position: { x: 28, y: 24 },
    draggable: false,
    selectable: false,
    zIndex: -2,
    data: {
      label: "",
      typeLabel: "lane",
      tokenKey: "lane",
      raw: {
        layoutGroupPanel: true,
        layoutWidth: shellWidth,
        layoutHeight: shellHeight,
      },
    },
  };

  return [shellNode, ...shiftedNodes];
}

function buildConnectedComponents(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
  allowedNodeIds?: Set<string>,
): {
  componentIdByNodeId: Map<string, string>;
  componentNodeIdsById: Map<string, string[]>;
  componentCanonicalNodeById: Map<string, string>;
} {
  const nodeIds = nodes
    .filter((node) => node.data.tokenKey !== "cluster" && node.data.tokenKey !== "namespace")
    .filter((node) => (allowedNodeIds ? allowedNodeIds.has(node.id) : true))
    .map((node) => node.id);
  const adjacency = new Map<string, Set<string>>();
  nodeIds.forEach((id) => adjacency.set(id, new Set<string>()));

  edges.forEach((edge) => {
    if (allowedNodeIds && (!allowedNodeIds.has(edge.source) || !allowedNodeIds.has(edge.target))) return;
    const role = ((edge.data as TopologyEdgeData | undefined)?.topologyRole ?? "relation") as TopologyEdgeRole;
    if (role === "scope") return;
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  });

  const componentIdByNodeId = new Map<string, string>();
  const componentNodeIdsById = new Map<string, string[]>();
  const componentCanonicalNodeById = new Map<string, string>();
  const visited = new Set<string>();
  let componentSeq = 0;

  nodeIds.forEach((rootId) => {
    if (visited.has(rootId)) return;
    componentSeq += 1;
    const componentId = `component-${componentSeq}`;
    const queue: string[] = [rootId];
    const componentMemberIds: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (!adjacency.has(current)) continue;
      componentMemberIds.push(current);
      const next = adjacency.get(current);
      if (!next) continue;
      next.forEach((candidate) => {
        if (!visited.has(candidate)) queue.push(candidate);
      });
    }

    if (componentMemberIds.length === 0) return;
    const sortedMembers = [...componentMemberIds].sort((left, right) => left.localeCompare(right));
    componentNodeIdsById.set(componentId, sortedMembers);
    componentCanonicalNodeById.set(componentId, sortedMembers[0]);
    sortedMembers.forEach((nodeId) => {
      componentIdByNodeId.set(nodeId, componentId);
    });
  });

  return {
    componentIdByNodeId,
    componentNodeIdsById,
    componentCanonicalNodeById,
  };
}

function buildNamespaceCanvasEdges(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
  focusedNodeId: string | null,
): Edge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const canvasEdges: Edge[] = [];
  const seen = new Set<string>();
  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  const pushEdge = (edge: Edge) => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    canvasEdges.push(edge);
  };

  const focusedNode = focusedNodeId ? nodeMap.get(focusedNodeId) : null;
  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;

    const sourceRaw = sourceNode.data.raw as { layoutLane?: unknown; layoutGroupPanel?: unknown } | undefined;
    const targetRaw = targetNode.data.raw as { layoutLane?: unknown; layoutGroupPanel?: unknown } | undefined;
    if (sourceRaw?.layoutLane || targetRaw?.layoutLane || sourceRaw?.layoutGroupPanel || targetRaw?.layoutGroupPanel) return;

    const isClusterEdge =
      (sourceNode.data.tokenKey === "cluster" && targetNode.data.tokenKey === "namespace") ||
      (targetNode.data.tokenKey === "cluster" && sourceNode.data.tokenKey === "namespace");

    if (isClusterEdge) {
      pushEdge({
        ...edge,
        style: {
          ...EDGE_STYLE,
          ...edge.style,
          strokeWidth: 0.9,
          opacity: 0.22,
        },
        markerEnd: undefined,
      });
    }
  });

  if (!focusedNodeId) return canvasEdges;
  if (!focusedNode) return canvasEdges;

  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return;
    const rawData = (edge.data as TopologyEdgeData | undefined) ?? {};
    const isScope = rawData.topologyRole === "scope";
    const isGroup = rawData.topologyRole === "group";
    const sourceComponentId = (sourceNode.data.raw as { componentId?: string } | undefined)?.componentId;
    const targetComponentId = (targetNode.data.raw as { componentId?: string } | undefined)?.componentId;
    if (sourceComponentId && targetComponentId && sourceComponentId !== targetComponentId) return;

    pushEdge({
      ...edge,
      style: {
        ...EDGE_STYLE,
        ...edge.style,
        strokeWidth: isScope ? 0.84 : isGroup ? 0.9 : 1.08,
        opacity: isScope ? 0.14 : isGroup ? 0.24 : 0.36,
        strokeDasharray: isScope ? "4 4" : edge.style?.strokeDasharray,
      },
      markerEnd: undefined,
    });
  });

  return canvasEdges;
}

const TopoNode = memo(({ data, selected }: NodeProps<TopoNodeData>) => {
  const token = TOKEN[data.tokenKey];
  const isGroupNode =
    data.tokenKey === "namespace" || data.tokenKey === "instancegroup" || data.tokenKey === "node";
  const raw = data.raw as {
    podCount?: unknown;
    readyPods?: unknown;
    pendingPods?: unknown;
    abnormalPods?: unknown;
    riskLevel?: unknown;
    caption?: unknown;
    layoutLane?: unknown;
    layoutWidth?: unknown;
    layoutHeight?: unknown;
    layoutGroupPanel?: unknown;
    networkCount?: unknown;
    workloadCount?: unknown;
    podReplicaCount?: unknown;
    onSummarySelect?: ((section: GroupSectionKey) => void) | undefined;
    selectedGroupSection?: GroupSectionKey | null;
  } | undefined;
  const isLaneNode = raw?.layoutLane === true;
  const isGroupPanelNode = raw?.layoutGroupPanel === true;
  const isNamespaceNode = data.tokenKey === "namespace" && !isLaneNode;
  const laneWidth = typeof raw?.layoutWidth === "number" ? raw.layoutWidth : NODE_W;
  const laneHeight = typeof raw?.layoutHeight === "number" ? raw.layoutHeight : NODE_H;
  const namespaceWidth = 278;
  const namespaceHeight = 138;
  const groupCount = typeof raw?.podCount === "number" ? raw.podCount : null;
  const readyCount = typeof raw?.readyPods === "number" ? raw.readyPods : null;
  const pendingCount = typeof raw?.pendingPods === "number" ? raw.pendingPods : 0;
  const abnormalCount = typeof raw?.abnormalPods === "number" ? raw.abnormalPods : pendingCount;
  const unreadyCount = pendingCount;
  const networkCount = typeof raw?.networkCount === "number" ? raw.networkCount : null;
  const workloadCount = typeof raw?.workloadCount === "number" ? raw.workloadCount : null;
  const podReplicaCount = typeof raw?.podReplicaCount === "number" ? raw.podReplicaCount : null;
  const riskLevel =
    raw?.riskLevel === "high" || raw?.riskLevel === "medium" || raw?.riskLevel === "low"
      ? raw.riskLevel
      : null;
  const collapsed = typeof data.caption === "string" && data.caption.includes("已折叠");
  const selectedGroupSection =
    raw?.selectedGroupSection === "network" ||
    raw?.selectedGroupSection === "workload" ||
    raw?.selectedGroupSection === "pod" ||
    raw?.selectedGroupSection === "other"
      ? raw.selectedGroupSection
      : null;
  const onSummarySelect = typeof raw?.onSummarySelect === "function" ? raw.onSummarySelect : null;

  return (
    <div
      style={{
        width: isLaneNode ? laneWidth : isNamespaceNode ? namespaceWidth : NODE_W,
        minHeight: isLaneNode ? laneHeight : isNamespaceNode ? namespaceHeight : NODE_H,
        borderRadius: isGroupPanelNode ? 22 : isLaneNode ? 12 : isNamespaceNode ? 16 : 10,
        border: isGroupPanelNode
          ? "1px dashed rgba(191, 219, 254, 0.46)"
          : `1px ${isGroupNode && !isLaneNode ? "dashed" : "solid"} ${selected ? token.border : token.borderAlpha}`,
        background: isGroupPanelNode
          ? "linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(248,250,252,0.42) 100%)"
          : isLaneNode
          ? "rgba(255,255,255,0.78)"
          : selected
            ? token.bg
            : "var(--topology-card-bg)",
        boxShadow: isGroupPanelNode
          ? "inset 0 1px 0 rgba(255,255,255,0.72)"
          : isLaneNode
          ? "inset 0 1px 0 rgba(255,255,255,0.88)"
          : selected
            ? `0 0 0 1px ${token.border}33, 0 8px 18px rgba(15, 23, 42, 0.1)`
            : "0 2px 8px rgba(15, 23, 42, 0.05)",
        overflow: "hidden",
        transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
        pointerEvents: isLaneNode || isGroupPanelNode ? "none" : "auto",
      }}
    >
      {isGroupPanelNode ? null : (
      <div
        style={{
          height: isLaneNode ? 1 : 2,
          background: `linear-gradient(90deg, ${token.border}, ${token.borderAlpha})`,
        }}
      />
      )}
      {isGroupPanelNode ? null : (
      <div style={{ padding: isLaneNode ? "7px 9px 9px" : isNamespaceNode ? "9px 11px 11px" : "7px 9px 9px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--topology-overview-subtle)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {data.typeLabel}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isGroupNode && !isLaneNode ? (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: collapsed ? "rgba(100, 116, 139, 0.12)" : "rgba(34, 197, 94, 0.12)",
                  color: collapsed ? "#475569" : "#15803d",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {collapsed ? "展" : "收"}
              </span>
            ) : null}
            {abnormalCount > 0 && !isLaneNode ? (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#b91c1c",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                ! {abnormalCount}
              </span>
            ) : null}
            {isGroupNode && groupCount !== null && !isLaneNode ? (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: "rgba(37, 99, 235, 0.1)",
                  color: "#1d4ed8",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {groupCount}
              </span>
            ) : null}
            {!isLaneNode ? <span style={{ color: token.text, fontSize: 12, lineHeight: 1 }}>{token.icon}</span> : null}
          </div>
        </div>

        <div
          style={{
            marginTop: isLaneNode ? 2 : 4,
            fontSize: isLaneNode ? 10 : isNamespaceNode ? 12 : 13,
            fontWeight: 700,
            color: "var(--topology-overview-text)",
            lineHeight: 1.34,
            letterSpacing: "-0.01em",
            wordBreak: "break-word",
          }}
        >
          {data.label}
        </div>

        {data.caption ? (
          <div
            style={{
              marginTop: isLaneNode ? 1 : 3,
              color: "var(--topology-overview-subtle)",
              fontSize: isLaneNode ? 8 : isNamespaceNode ? 9 : 10,
              lineHeight: 1.45,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              wordBreak: "break-word",
            }}
          >
            {data.caption}
          </div>
        ) : null}

        {isLaneNode ? null : (
          <>
        {!isNamespaceNode && (data.status || data.replicas) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
            {data.status ? <RuntimeStatusPill status={data.status} /> : null}
            {data.replicas ? (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "rgba(148,163,184,0.12)",
                  color: "var(--topology-overview-subtle)",
                  fontSize: 11,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {data.replicas}
              </span>
            ) : null}
          </div>
        )}

        {isGroupNode && groupCount !== null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: isNamespaceNode ? 5 : 7, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(37, 99, 235, 0.08)",
                color: "#1d4ed8",
                fontSize: isNamespaceNode ? 8 : 9,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              组内 {groupCount}
            </span>
            {readyCount !== null ? (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "rgba(34, 197, 94, 0.1)",
                  color: "#15803d",
                  fontSize: isNamespaceNode ? 9 : 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                就绪 {readyCount}
              </span>
            ) : null}
            {pendingCount > 0 ? (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "rgba(239, 68, 68, 0.1)",
                  color: "#b91c1c",
                  fontSize: isNamespaceNode ? 9 : 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                异常 {abnormalCount}
              </span>
            ) : null}
            {isGroupNode ? (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "rgba(59, 130, 246, 0.1)",
                  color: "#1d4ed8",
                  fontSize: isNamespaceNode ? 9 : 10,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                未就绪 {unreadyCount}
              </span>
            ) : null}
            {isGroupNode && riskLevel ? (
              <span
                className={`topology-risk-chip topology-risk-chip--${riskLevel}`}
                style={{ padding: "2px 7px", borderRadius: 999, fontSize: isNamespaceNode ? 9 : 10, fontWeight: 700, lineHeight: 1.2 }}
              >
                风险 {riskLevel === "high" ? "高" : riskLevel === "medium" ? "中" : "低"}
              </span>
            ) : null}
          </div>
        ) : null}
        {isNamespaceNode && (networkCount !== null || workloadCount !== null || podReplicaCount !== null) ? (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
            {networkCount !== null ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSummarySelect?.("network");
                }}
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: selectedGroupSection === "network" ? "1px solid rgba(109, 40, 217, 0.28)" : "1px solid transparent",
                  background: "rgba(139, 92, 246, 0.1)",
                  color: "#6d28d9",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  cursor: "pointer",
                }}
              >
                网络 {networkCount}
              </button>
            ) : null}
            {workloadCount !== null ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSummarySelect?.("workload");
                }}
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: selectedGroupSection === "workload" ? "1px solid rgba(3, 105, 161, 0.28)" : "1px solid transparent",
                  background: "rgba(14, 165, 233, 0.1)",
                  color: "#0369a1",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  cursor: "pointer",
                }}
              >
                工作负载 {workloadCount}
              </button>
            ) : null}
            {podReplicaCount !== null ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSummarySelect?.("pod");
                }}
                style={{
                  padding: "2px 7px",
                  borderRadius: 999,
                  border: selectedGroupSection === "pod" ? "1px solid rgba(51, 65, 85, 0.28)" : "1px solid transparent",
                  background: "rgba(100, 116, 139, 0.1)",
                  color: "#334155",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  cursor: "pointer",
                }}
              >
                Pod {podReplicaCount}
              </button>
            ) : null}
          </div>
        ) : null}
          </>
        )}
      </div>
      )}

      {isLaneNode || isGroupPanelNode ? null : (
        <>
          <Handle
            type="target"
            position={Position.Left}
            style={{
              width: 8,
              height: 8,
              left: -4,
              background: token.border,
              border: "2px solid var(--topology-overview-bg)",
            }}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{
              width: 8,
              height: 8,
              right: -4,
              background: token.border,
              border: "2px solid var(--topology-overview-bg)",
            }}
          />
        </>
      )}
    </div>
  );
});

TopoNode.displayName = "TopoNode";

const nodeTypes = { topo: TopoNode };

function minimapNodeColor(node: Node<TopoNodeData>): string {
  const raw = node.data.raw as { layoutLane?: unknown } | undefined;
  if (raw?.layoutLane) return "transparent";
  return TOKEN[node.data.tokenKey]?.border ?? "var(--topology-overview-edge)";
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  return (
    <div className="topology-control-group">
      <Tooltip title="缩小">
        <Button size="small" icon={<MinusOutlined />} onClick={onZoomOut} />
      </Tooltip>
      <Tooltip title="放大">
        <Button size="small" icon={<PlusOutlined />} onClick={onZoomIn} />
      </Tooltip>
      <Tooltip title="适应视图">
        <Button size="small" icon={<ShrinkOutlined />} onClick={onFitView} />
      </Tooltip>
    </div>
  );
}

function TopologyCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onNodeDragStart,
  onNodeDragStop,
  isLoading,
  hasNodes,
  selectedClusterId,
  clusterDataUnavailable,
  unavailableSummary,
  unavailableCategory,
  onRetry,
  viewportVersion,
  viewportKey,
  viewportMode,
  onFitViewRef,
  onZoomInRef,
  onZoomOutRef,
  isNodeDragging,
}: {
  nodes: Node<TopoNodeData>[];
  edges: Edge[];
  onNodesChange: ReturnType<typeof useNodesState>[2];
  onEdgesChange: ReturnType<typeof useEdgesState>[2];
  onNodeClick: (event: React.MouseEvent, node: Node<TopoNodeData>) => void;
  isLoading: boolean;
  hasNodes: boolean;
  selectedClusterId: string | null;
  clusterDataUnavailable: boolean;
  unavailableSummary: string;
  unavailableCategory: TopologyFailureCategory;
  onRetry: () => void;
  viewportVersion: number;
  viewportKey: string;
  viewportMode: TopologyViewMode;
  onFitViewRef: React.MutableRefObject<(() => void) | null>;
  onZoomInRef: React.MutableRefObject<(() => void) | null>;
  onZoomOutRef: React.MutableRefObject<(() => void) | null>;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  isNodeDragging: boolean;
}) {
  const { fitView, zoomIn, zoomOut, setViewport } = useReactFlow();
  const reactFlowWidth = useStore((store) => store.width);
  const reactFlowHeight = useStore((store) => store.height);
  const viewport = useViewport();
  const suspendAutoViewportUntilRef = useRef(0);

  const suspendAutoViewport = useCallback((duration = 680) => {
    suspendAutoViewportUntilRef.current = Date.now() + duration;
  }, []);

  const autoViewportSuspended = useCallback(() => Date.now() < suspendAutoViewportUntilRef.current, []);

  const updateViewport = useCallback(
    (mode: "100%" | "fit" = DEFAULT_VIEWPORT_MODE) => {
      if (autoViewportSuspended()) return;
      if (mode === "fit") {
        fitView({ padding: 0.1, duration: 320, minZoom: 0.5, maxZoom: MAX_ZOOM });
        return;
      }

      const targetNodes = nodes.filter((node) => {
        const raw = node.data.raw as { layoutLane?: unknown; layoutGroupPanel?: unknown } | undefined;
        if (raw?.layoutLane === true || raw?.layoutGroupPanel === true) return false;
        if (viewportMode === "namespace-overview" && mode === DEFAULT_VIEWPORT_MODE) {
          return node.data.tokenKey === "namespace";
        }
        if (viewportMode === "resource-focus" && mode === DEFAULT_VIEWPORT_MODE) {
          return node.data.tokenKey !== "cluster" && node.data.tokenKey !== "namespace";
        }
        if (mode === DEFAULT_VIEWPORT_MODE) {
          return node.data.tokenKey === "cluster" || node.data.tokenKey === "namespace";
        }
        return true;
      });
      if (targetNodes.length === 0) return;

      const bounds = getNodesBounds(
        targetNodes.map((node) => ({
          ...node,
          width: typeof node.width === "number" ? node.width : NODE_W,
          height: typeof node.height === "number" ? node.height : NODE_H,
        })),
      );

      if (reactFlowWidth <= 0 || reactFlowHeight <= 0) return;

      const nextViewport = getViewportForBounds(
        bounds,
        reactFlowWidth,
        reactFlowHeight,
        0.1,
        1,
        0.52,
      );
      const minZoom = viewportMode === "resource-focus" ? 0.62 : 0.74;
      const maxZoom = viewportMode === "resource-focus" ? 1.08 : 1;
      const clampedZoom = Math.max(Math.min(nextViewport.zoom, maxZoom), minZoom);
      const centeredX = (reactFlowWidth - bounds.width * clampedZoom) / 2 - bounds.x * clampedZoom;
      const centeredY =
        viewportMode === "resource-focus"
          ? Math.max(20, (reactFlowHeight - bounds.height * clampedZoom) / 2 - bounds.y * clampedZoom)
          : Math.max(18, (reactFlowHeight - bounds.height * clampedZoom) / 2 - bounds.y * clampedZoom);
      setViewport({ x: centeredX, y: centeredY, zoom: clampedZoom }, { duration: 320 });
    },
    [autoViewportSuspended, fitView, nodes, reactFlowHeight, reactFlowWidth, setViewport, viewportMode],
  );

  useEffect(() => {
    onFitViewRef.current = () => updateViewport("fit");
    onZoomInRef.current = () => zoomIn({ duration: 180 });
    onZoomOutRef.current = () => zoomOut({ duration: 180 });
  }, [updateViewport, zoomIn, zoomOut, onFitViewRef, onZoomInRef, onZoomOutRef]);

  useEffect(() => {
    if (!hasNodes) return;
    if (autoViewportSuspended()) return;
    let frameA = 0;
    let frameB = 0;
    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(() => {
        updateViewport(DEFAULT_VIEWPORT_MODE);
      });
    });
    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [autoViewportSuspended, hasNodes, reactFlowHeight, reactFlowWidth, updateViewport, viewportKey, viewportVersion]);

  useEffect(() => {
    if (!hasNodes || !nodes.length || reactFlowWidth <= 0 || reactFlowHeight <= 0) return;
    if (viewportMode !== "resource-focus") return;
    if (autoViewportSuspended()) return;
    if (isNodeDragging || nodes.some((node) => node.dragging)) return;
    const focusedNode = nodes.find((node) => node.selected);
    if (!focusedNode) return;
    const width = typeof focusedNode.width === "number" ? focusedNode.width : NODE_W;
    const height = typeof focusedNode.height === "number" ? focusedNode.height : NODE_H;
    const left = focusedNode.position.x * viewport.zoom + viewport.x;
    const top = focusedNode.position.y * viewport.zoom + viewport.y;
    const right = left + width * viewport.zoom;
    const bottom = top + height * viewport.zoom;
    const padX = 64;
    const padY = 56;
    const visibleLeft = padX;
    const visibleTop = padY;
    const visibleRight = reactFlowWidth - padX;
    const visibleBottom = reactFlowHeight - padY;

    let nextX = viewport.x;
    let nextY = viewport.y;
    if (left < visibleLeft) nextX += visibleLeft - left;
    else if (right > visibleRight) nextX -= right - visibleRight;
    if (top < visibleTop) nextY += visibleTop - top;
    else if (bottom > visibleBottom) nextY -= bottom - visibleBottom;

    if (nextX !== viewport.x || nextY !== viewport.y) {
      setViewport({ x: nextX, y: nextY, zoom: viewport.zoom }, { duration: 220 });
    }
  }, [autoViewportSuspended, hasNodes, isNodeDragging, nodes, reactFlowHeight, reactFlowWidth, setViewport, viewport, viewportMode]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDragStart={() => {
        suspendAutoViewport(960);
        onNodeDragStart();
      }}
      onNodeDragStop={() => {
        suspendAutoViewport(560);
        onNodeDragStop();
      }}
      onMoveStart={() => suspendAutoViewport(960)}
      onMoveEnd={() => suspendAutoViewport(560)}
      nodeTypes={nodeTypes}
      minZoom={0.08}
      maxZoom={4}
      autoPanOnNodeDrag={false}
      proOptions={{ hideAttribution: true }}
      style={{ background: CANVAS_BG }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--topology-overview-grid)" />

      <MiniMap
        nodeColor={minimapNodeColor}
        position="bottom-right"
        style={{
          background: "var(--topology-overview-panel)",
          border: "1px solid var(--topology-overview-border)",
          borderRadius: 16,
          width: 164,
          height: 100,
        }}
        maskColor="var(--topology-overview-mask)"
      />

      {isLoading && !hasNodes ? (
        <div className="topology-canvas-overlay">
          <Skeleton active paragraph={{ rows: 7 }} />
        </div>
      ) : null}

      {!hasNodes && !isLoading ? (
        <div className="topology-canvas-overlay topology-canvas-overlay--empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: "var(--topology-overview-subtle)" }}>
                {selectedClusterId ? "当前筛选条件下没有可视资源" : "先选择一个集群"}
              </span>
            }
          />
        </div>
      ) : null}

      {clusterDataUnavailable ? (
        <div className="topology-canvas-overlay">
          <Alert
            type="warning"
            showIcon
            message={getFailureCopy(unavailableCategory).title}
            description={
              <div style={{ display: "grid", gap: 8 }}>
                <span>{getFailureCopy(unavailableCategory).description}</span>
                <span style={{ color: "var(--topology-overview-subtle)" }}>{unavailableSummary}</span>
                <div>
                  <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
                    重试拉取
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      ) : null}
    </ReactFlow>
  );
}

function NodeDetailPanel({
  focusedNode,
  connections,
  groupMembers,
  groupSummary,
  selectedGroupSection,
  onSelectGroupSection,
  onClear,
  onToggleGroup,
  isGroupExpanded,
  onSelectConnection,
  anomalyDistribution,
  onApplyQuickFilter,
  activeQuickAction,
  currentResourceActionLabel,
  onOpenCurrentResource,
  onOpenResourceDetail,
}: {
  focusedNode: Node<TopoNodeData> | null;
  connections: DetailRelationItem[];
  groupMembers: DetailRelationItem[];
  groupSummary: {
    total: number;
    network: number;
    workloads: number;
    pods: number;
    unready: number;
  } | null;
  selectedGroupSection: GroupSectionKey | null;
  onSelectGroupSection: (section: GroupSectionKey | null) => void;
  onClear: () => void;
  onToggleGroup: () => void;
  isGroupExpanded: boolean;
  onSelectConnection: (id: string) => void;
  anomalyDistribution: Array<{ label: string; count: number; risk: "high" | "medium" | "low" | "unready" }>;
  onApplyQuickFilter: (action: "abnormal" | "group" | "highRisk") => void;
  activeQuickAction: "abnormal" | "group" | "highRisk" | null;
  currentResourceActionLabel: string | null;
  onOpenCurrentResource: () => void;
  onOpenResourceDetail: () => void;
}) {
  const nodeData = focusedNode?.data ?? null;
  const token = nodeData ? TOKEN[nodeData.tokenKey] : null;
  const isGroupNode =
    nodeData?.tokenKey === "namespace" || nodeData?.tokenKey === "instancegroup" || nodeData?.tokenKey === "node";
  const raw = (nodeData?.raw as Record<string, unknown> | undefined) ?? undefined;
  const relationItems = isGroupNode ? groupMembers : connections;
  const groupedRelationSections = useMemo(
    () =>
      isGroupNode
        ? [
            {
              key: "network" as GroupSectionKey,
              title: "网络资源",
              items: relationItems.filter((item) => NETWORK_STACK_KEYS.has(item.tokenKey)),
            },
            {
              key: "workload" as GroupSectionKey,
              title: "工作负载",
              items: relationItems.filter((item) => WORKLOAD_STACK_KEYS.has(item.tokenKey)),
            },
            {
              key: "pod" as GroupSectionKey,
              title: "Pod",
              items: relationItems.filter((item) => item.tokenKey === "pod"),
            },
            {
              key: "other" as GroupSectionKey,
              title: "其他资源",
              items: relationItems.filter(
                (item) =>
                  !NETWORK_STACK_KEYS.has(item.tokenKey) &&
                  !WORKLOAD_STACK_KEYS.has(item.tokenKey) &&
                  item.tokenKey !== "pod",
              ),
            },
          ].filter((section) => section.items.length > 0)
        : [],
    [isGroupNode, relationItems],
  );
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sectionRefs = useRef<Partial<Record<GroupSectionKey, HTMLDivElement | null>>>({});

  useEffect(() => {
    if (!isGroupNode || !selectedGroupSection) return;
    if (!groupedRelationSections.some((section) => section.key === selectedGroupSection)) return;

    const frameId = window.requestAnimationFrame(() => {
      const sectionEl = sectionRefs.current[selectedGroupSection];
      if (!sectionEl) return;
      sectionEl.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [groupedRelationSections, isGroupNode, selectedGroupSection]);

  if (!focusedNode || !nodeData || !token) return null;

  const facts: Array<{ label: string; value: string }> = [];
  if (raw?.namespace) facts.push({ label: "Namespace", value: String(raw.namespace) });
  if (raw?.kind) facts.push({ label: "Kind", value: String(raw.kind) });
  if (raw?.state) facts.push({ label: "State", value: String(raw.state) });
  if (raw?.phase) facts.push({ label: "Phase", value: String(raw.phase) });
  if (raw?.mode) facts.push({ label: "View", value: String(raw.mode) });
  if (raw?.controller) facts.push({ label: "Controller", value: String(raw.controller) });
  if (raw?.nodeName) facts.push({ label: "Node", value: String(raw.nodeName) });
  if (raw?.podCount !== undefined) facts.push({ label: "Pods", value: String(raw.podCount) });
  if (raw?.readyPods !== undefined) facts.push({ label: "Ready Pods", value: String(raw.readyPods) });
  if (raw?.replicas !== undefined) facts.push({ label: "Replicas", value: String(raw.replicas) });
  if (raw?.readyReplicas !== undefined) facts.push({ label: "Ready", value: String(raw.readyReplicas) });
  if (raw?.createdAt) facts.push({ label: "Created", value: String(raw.createdAt).replace("T", " ").slice(0, 16) });

  const spec = raw?.spec as Record<string, unknown> | undefined;
  if (spec?.type) facts.push({ label: "Service Type", value: String(spec.type) });
  if (spec?.clusterIP) facts.push({ label: "Cluster IP", value: String(spec.clusterIP) });
  if (Array.isArray(spec?.entryPoints) && spec.entryPoints.length > 0) {
    facts.push({ label: "EntryPoints", value: spec.entryPoints.join(", ") });
  }
  if (Array.isArray(spec?.routes) && spec.routes[0] && typeof spec.routes[0] === "object") {
    const route = spec.routes[0] as { match?: unknown };
    if (typeof route.match === "string") {
      facts.push({ label: "Match", value: route.match });
    }
  }

  const primaryFacts = facts.slice(0, isGroupNode ? 8 : 6);
  const secondaryFacts = facts.slice(isGroupNode ? 8 : 6);
  const longestFactValue = facts.reduce((max, item) => Math.max(max, item.value.length), 0);
  const panelWidth = Math.min(560, Math.max(404, 328 + longestFactValue * 5));
  return (
    <aside
      className="topology-detail-panel"
      style={{
        width: panelWidth,
        minWidth: panelWidth,
        maxWidth: 560,
      }}
    >
      <div className="topology-detail-panel__header">
        <div>
          <div className="topology-detail-panel__eyebrow">{nodeData.typeLabel}</div>
          <Title level={4} style={{ margin: "4px 0 0" }}>
            {nodeData.label}
          </Title>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isGroupNode ? (
            <Button size="small" type="primary" onClick={onOpenResourceDetail}>
              完整详情
            </Button>
          ) : null}
          {!isGroupNode && currentResourceActionLabel ? (
            <button type="button" className="topology-current-resource-button" onClick={onOpenCurrentResource}>
              <span className="topology-current-resource-button__halo" />
              <span className="topology-current-resource-button__icon">
                <RightOutlined />
              </span>
              <span className="topology-current-resource-button__content">
                <span className="topology-current-resource-button__eyebrow">{currentResourceActionLabel}</span>
                <span className="topology-current-resource-button__title">{nodeData.label}</span>
              </span>
            </button>
          ) : null}
          {isGroupNode ? (
            <Button size="small" onClick={onToggleGroup}>
              {isGroupExpanded ? "收起" : "展开"}
            </Button>
          ) : null}
          <Button size="small" onClick={onClear}>
            清空
          </Button>
        </div>
      </div>

      <div className="topology-detail-panel__badges">
        <Tag
          variant="filled"
          style={{
            margin: 0,
            background: `${token.border}18`,
            color: token.text,
            borderRadius: 999,
          }}
        >
          {token.icon} {TOKEN[nodeData.tokenKey].label}
        </Tag>
        {nodeData.status ? <RuntimeStatusPill status={nodeData.status} /> : null}
        {nodeData.replicas ? (
          <Tag variant="filled" style={{ margin: 0, borderRadius: 999 }}>
            {nodeData.replicas}
          </Tag>
        ) : null}
      </div>

      {!isGroupNode ? (
        <div className="topology-detail-section">
          <div className="topology-detail-section__title">资源活动</div>
          <div className="topology-source-matrix">
            <div className="topology-source-matrix__item">
              <div style={{ minWidth: 0 }}>
                <div className="topology-source-matrix__main">
                  <span style={{ color: token.text, fontSize: 16, lineHeight: 1 }}>{token.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="topology-source-matrix__name">{nodeData.label}</div>
                    <div className="topology-source-matrix__meta">
                      {nodeData.typeLabel}
                      {raw?.namespace ? ` · ${String(raw.namespace)}` : ""}
                    </div>
                  </div>
                </div>
                <DetailFactsGrid items={primaryFacts} />
              </div>
              <div className="topology-source-matrix__tags" />
            </div>
          </div>
        </div>
      ) : null}

      {isGroupNode && groupSummary ? (
        <div className="topology-detail-section">
          <div className="topology-detail-section__title">组概览</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            {[
              { label: "组内资源", value: groupSummary.total, tone: "rgba(37, 99, 235, 0.08)", color: "#1d4ed8" },
              { label: "网络资源", value: groupSummary.network, tone: "rgba(139, 92, 246, 0.08)", color: "#6d28d9" },
              { label: "工作负载", value: groupSummary.workloads, tone: "rgba(14, 165, 233, 0.08)", color: "#0369a1" },
              { label: "Pod / 未就绪", value: `${groupSummary.pods} / ${groupSummary.unready}`, tone: "rgba(100, 116, 139, 0.08)", color: "#334155" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  background: "var(--topology-detail-card)",
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--topology-overview-subtle)",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 999,
                    padding: "4px 9px",
                    background: item.tone,
                    color: item.color,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          <DetailFactsGrid items={facts} />
        </div>
      ) : secondaryFacts.length > 0 ? (
        <div className="topology-detail-section">
          <div className="topology-detail-section__title">补充信息</div>
          <DetailFactsGrid items={secondaryFacts} />
        </div>
      ) : null}

      <div className="topology-detail-section">
        <div className="topology-detail-section__title">{isGroupNode ? "组内资源" : "关系"}</div>
        {relationItems.length === 0 ? (
          <Text type="secondary">{isGroupNode ? "当前组内没有可见资源。" : "当前节点没有相邻资源。"}</Text>
        ) : isGroupNode ? (
          <div className="topology-detail-grouped-list">
            {groupedRelationSections.map((section) => {
              const isSectionCollapsed =
                collapsedSections[section.key] && selectedGroupSection !== section.key;

              return (
                <div
                  key={section.key}
                  ref={(element) => {
                    sectionRefs.current[section.key] = element;
                  }}
                  className="topology-detail-grouped-list__section"
                >
                <button
                  type="button"
                  className={`topology-detail-grouped-list__header ${isSectionCollapsed ? "is-collapsed" : ""}`}
                  onClick={() => {
                    onSelectGroupSection(null);
                    setCollapsedSections((current) => ({
                      ...current,
                      [section.key]: !current[section.key],
                    }));
                  }}
                >
                  <span
                    className={`topology-detail-grouped-list__title ${selectedGroupSection === section.key ? "is-focused" : ""}`}
                  >
                    {section.title}
                  </span>
                  <span className="topology-detail-grouped-list__meta">
                    <span className="topology-detail-grouped-list__count">{section.items.length}</span>
                    <span className="topology-detail-grouped-list__toggle">
                      {isSectionCollapsed ? "展开" : "收起"}
                    </span>
                  </span>
                </button>
                <div
                  className="topology-detail-list"
                  style={{ display: isSectionCollapsed ? "none" : "flex" }}
                >
                  {section.items.map((item) => {
                    const itemToken = TOKEN[item.tokenKey];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`topology-detail-list__item ${item.risk ? `is-${item.risk}` : ""}`}
                        onClick={() => onSelectConnection(item.id)}
                      >
                        <div>
                          <div className="topology-detail-list__title">
                            <span style={{ color: itemToken.text }}>{itemToken.icon}</span>
                            <span>{item.label}</span>
                          </div>
                          <div className="topology-detail-list__meta">{item.typeLabel}</div>
                        </div>
                        <div className="topology-detail-list__chips">
                          {item.secondaryText ? (
                            <span className="topology-detail-list__chip">{item.secondaryText}</span>
                          ) : null}
                          {item.statusText ? (
                            <span
                              className={`topology-detail-list__chip ${
                                item.risk === "high"
                                  ? "is-danger"
                                  : item.risk === "medium"
                                    ? "is-warn"
                                    : "is-neutral"
                              }`}
                            >
                              {item.statusText}
                            </span>
                          ) : null}
                          <Tag variant="filled" style={{ margin: 0 }}>
                            组内
                          </Tag>
                        </div>
                      </button>
                    );
                  })}
                </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="topology-detail-list">
            {relationItems.map((item) => {
              const itemToken = TOKEN[item.tokenKey];
              return (
                <button
                  key={item.id}
                  type="button"
                  className="topology-detail-list__item"
                  onClick={() => onSelectConnection(item.id)}
                >
                  <div>
                    <div className="topology-detail-list__title">
                      <span style={{ color: itemToken.text }}>{itemToken.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    <div className="topology-detail-list__meta">{item.typeLabel}</div>
                  </div>
                  <Tag variant="filled" style={{ margin: 0 }}>
                    {isGroupNode ? "组内" : "相邻"}
                  </Tag>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="topology-detail-section">
        <div className="topology-detail-section__title">异常</div>
        <div className="topology-anomaly-list">
          {anomalyDistribution.length === 0 ? (
            <Tag variant="filled" style={{ margin: 0 }}>
              0
            </Tag>
          ) : (
            anomalyDistribution.map((item) => (
              <div key={item.label} className="topology-anomaly-list__item">
                <span>{item.label}</span>
                <span className={`topology-risk-chip topology-risk-chip--${item.risk}`}>{item.count}</span>
              </div>
            ))
          )}
        </div>
        <div className="topology-quick-actions">
          <button
            type="button"
            className={`topology-quick-actions__item ${activeQuickAction === "abnormal" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("abnormal")}
          >
            异常聚焦
          </button>
          <button
            type="button"
            className={`topology-quick-actions__item ${activeQuickAction === "highRisk" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("highRisk")}
          >
            高风险链路
          </button>
          <button
            type="button"
            className={`topology-quick-actions__item ${activeQuickAction === "group" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("group")}
          >
            异常组
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function NetworkTopologyPage() {
  const { accessToken: token } = useAuth();
  const router = useRouter();
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(ALL_NAMESPACE);
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<SourceKey[]>([...SOURCE_TOKEN_KEYS]);
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("namespace");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [selectedGroupSection, setSelectedGroupSection] = useState<GroupSectionKey | null>(null);
  const [activeQuickAction, setActiveQuickAction] = useState<"abnormal" | "group" | "highRisk" | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([]);
  const [resourceFocusPanelOpen, setResourceFocusPanelOpen] = useState(false);
  const [clusterPanelOpen, setClusterPanelOpen] = useState(false);
  const [namespacePanelOpen, setNamespacePanelOpen] = useState(false);
  const [groupModePanelOpen, setGroupModePanelOpen] = useState(false);
  const [expandedResourceDomains, setExpandedResourceDomains] = useState<ResourceDomainKey[]>([...RESOURCE_DOMAIN_KEYS]);
  const [detailRequest, setDetailRequest] = useState<TopologyResourceDetailRequest | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const fitViewRef = useRef<(() => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const userExpandedGroupsRef = useRef(false);
  const [userExpandedGroups, setUserExpandedGroups] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<TopoNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ["clusters"],
    queryFn: () => getClusters({ state: "active", selectableOnly: true }, token!),
    enabled: !!token,
  });

  const effectiveClusterId = selectedClusterId ?? clustersData?.items?.[0]?.id ?? null;
  const selectedCluster = clustersData?.items?.find((item) => item.id === effectiveClusterId);
  const queryEnabled = !!token && !!effectiveClusterId;

  const { data: networkData, isLoading: networkLoading, error: networkError, refetch } = useQuery({
    queryKey: ["topology-network", effectiveClusterId],
    queryFn: () => getNetworkResources({ clusterId: effectiveClusterId!, pageSize: 200 }, token!),
    enabled: queryEnabled,
  });

  const { data: deploymentData, isLoading: deploymentLoading, error: deploymentError } = useQuery({
    queryKey: ["topology-deployments", effectiveClusterId],
    queryFn: () =>
      getWorkloadsByKind("Deployment", { clusterId: effectiveClusterId!, pageSize: 200 }, token!),
    enabled: queryEnabled,
  });

  const { data: statefulSetData, isLoading: statefulSetLoading, error: statefulSetError } = useQuery({
    queryKey: ["topology-statefulsets", effectiveClusterId],
    queryFn: () =>
      getWorkloadsByKind("StatefulSet", { clusterId: effectiveClusterId!, pageSize: 200 }, token!),
    enabled: queryEnabled,
  });

  const { data: daemonSetData, isLoading: daemonSetLoading, error: daemonSetError } = useQuery({
    queryKey: ["topology-daemonsets", effectiveClusterId],
    queryFn: () =>
      getWorkloadsByKind("DaemonSet", { clusterId: effectiveClusterId!, pageSize: 200 }, token!),
    enabled: queryEnabled,
  });

  const isLoading =
    clustersLoading ||
    networkLoading ||
    deploymentLoading ||
    statefulSetLoading ||
    daemonSetLoading;
  const clusterDataUnavailable =
    !isLoading &&
    !!effectiveClusterId &&
    (!!networkError || !!deploymentError || !!statefulSetError || !!daemonSetError);
  const topologyErrors = [networkError, deploymentError, statefulSetError, daemonSetError].filter(Boolean);
  const unavailableCategory = resolveFailureCategory(topologyErrors);
  const unavailableSummary = topologyErrors.map(resolveErrorMessage).join(" | ");

  const namespaceOptions = useMemo(() => {
    const values = new Set<string>();
    (networkData?.items ?? []).forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    (deploymentData?.items ?? []).forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    (statefulSetData?.items ?? []).forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    (daemonSetData?.items ?? []).forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });

    return [
      { value: ALL_NAMESPACE, label: "全部名称空间" },
      ...Array.from(values)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ];
  }, [daemonSetData?.items, deploymentData?.items, networkData?.items, statefulSetData?.items]);

  const namespaceFilteredNetwork = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? networkData?.items ?? []
        : (networkData?.items ?? []).filter((item) => item.namespace === selectedNamespace),
    [networkData?.items, selectedNamespace],
  );
  const namespaceFilteredDeployments = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? deploymentData?.items ?? []
        : (deploymentData?.items ?? []).filter((item) => item.namespace === selectedNamespace),
    [deploymentData?.items, selectedNamespace],
  );
  const namespaceFilteredStatefulSets = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? statefulSetData?.items ?? []
        : (statefulSetData?.items ?? []).filter((item) => item.namespace === selectedNamespace),
    [selectedNamespace, statefulSetData?.items],
  );
  const namespaceFilteredDaemonSets = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? daemonSetData?.items ?? []
        : (daemonSetData?.items ?? []).filter((item) => item.namespace === selectedNamespace),
    [daemonSetData?.items, selectedNamespace],
  );
  const deferredSelectedCluster = useDeferredValue(selectedCluster);
  const deferredNamespaceFilteredNetwork = useDeferredValue(namespaceFilteredNetwork);
  const deferredNamespaceFilteredDeployments = useDeferredValue(namespaceFilteredDeployments);
  const deferredNamespaceFilteredStatefulSets = useDeferredValue(namespaceFilteredStatefulSets);
  const deferredNamespaceFilteredDaemonSets = useDeferredValue(namespaceFilteredDaemonSets);

  useEffect(() => {
    if (!deferredSelectedCluster) return;
    let cancelled = false;
    const graph = buildFlowGraph(
      deferredSelectedCluster.name,
      deferredSelectedCluster.id,
      deferredNamespaceFilteredNetwork,
      deferredNamespaceFilteredDeployments,
      deferredNamespaceFilteredStatefulSets,
      deferredNamespaceFilteredDaemonSets,
      groupMode,
    );
    const raf = window.requestAnimationFrame(() => {
      if (cancelled) return;
      startTransition(() => {
        setNodes(graph.nodes);
        setEdges(graph.edges);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [
    deferredSelectedCluster,
    deferredNamespaceFilteredNetwork,
    deferredNamespaceFilteredDeployments,
    deferredNamespaceFilteredStatefulSets,
    deferredNamespaceFilteredDaemonSets,
    groupMode,
    setNodes,
    setEdges,
  ]);

  const baseHasNodes = nodes.length > 0;

  const graphNodeMap = useMemo(() => {
    const map = new Map<string, Node<TopoNodeData>>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const availableResourceTypeKeys = useMemo(
    () =>
      RESOURCE_DOMAIN_KEYS.flatMap((domain) =>
        RESOURCE_DOMAIN_META[domain].keys.filter((key) => {
          const count = nodes.filter((node) => node.data.tokenKey === key).length;
          return count > 0;
        }),
      ),
    [nodes],
  );

  const effectiveSelectedResourceTypes = useMemo(() => {
    if (availableResourceTypeKeys.length === 0) return selectedResourceTypes;
    const available = new Set(availableResourceTypeKeys);
    const next = selectedResourceTypes.filter((item) => available.has(item));
    return next.length > 0 ? next : [...availableResourceTypeKeys];
  }, [availableResourceTypeKeys, selectedResourceTypes]);

  const nodeMatchesFilter = useCallback(
    (node: Node<TopoNodeData>) => {
      const tokenKey = node.data.tokenKey;
      const infra = INFRA_TOKENS.has(tokenKey);

      if (!infra && !effectiveSelectedResourceTypes.includes(tokenKey as SourceKey)) {
        return false;
      }

      if (resourceFilter === "all") return true;
      if (resourceFilter === "abnormal") {
        if (tokenKey === "instancegroup" || tokenKey === "node") {
          const raw = node.data.raw as { abnormalPods?: unknown; pendingPods?: unknown } | undefined;
          const abnormal =
            typeof raw?.abnormalPods === "number"
              ? raw.abnormalPods
              : typeof raw?.pendingPods === "number"
                ? raw.pendingPods
                : 0;
          return abnormal > 0;
        }
        return infra || ["Pending", "Failed", "Unknown"].includes(node.data.status ?? "");
      }
      return true;
    },
    [effectiveSelectedResourceTypes, resourceFilter],
  );

  const baseFilteredNodeIds = useMemo(() => {
    const ids = new Set<string>();

    nodes.forEach((node) => {
      if (!nodeMatchesFilter(node)) return;
      ids.add(node.id);
    });

    edges.forEach((edge) => {
      const sourceNode = graphNodeMap.get(edge.source);
      const targetNode = graphNodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return;

      if (ids.has(edge.source) && INFRA_TOKENS.has(targetNode.data.tokenKey)) {
        ids.add(edge.target);
      }
      if (ids.has(edge.target) && INFRA_TOKENS.has(sourceNode.data.tokenKey)) {
        ids.add(edge.source);
      }
    });

    return ids;
  }, [nodes, edges, graphNodeMap, nodeMatchesFilter]);

  const groupNodeIds = useMemo(
    () =>
      nodes
        .filter((node) =>
          groupMode === "namespace"
            ? node.data.tokenKey === "namespace"
            : groupMode === "instance"
            ? node.data.tokenKey === "instancegroup"
            : groupMode === "node"
              ? node.data.tokenKey === "node"
              : false,
        )
        .map((node) => node.id),
    [groupMode, nodes],
  );

  const effectiveExpandedGroupIds = useMemo(() => {
    const expanded =
      selectedNamespace !== ALL_NAMESPACE && groupMode === "namespace" && groupNodeIds.includes(`ns-${selectedNamespace}`)
        ? Array.from(new Set([...expandedGroupIds, `ns-${selectedNamespace}`]))
        : [...expandedGroupIds];

    if (!focusedNodeId) return expanded;
    const focused = graphNodeMap.get(focusedNodeId);
    if (!focused) return expanded;

    let forceGroupId: string | null = null;
    if (focused.data.tokenKey === "namespace" || focused.data.tokenKey === "instancegroup" || focused.data.tokenKey === "node") {
      forceGroupId = focused.id;
    } else if (groupMode === "namespace") {
      const focusedNamespace = getNodeNamespace(focused);
      forceGroupId = focusedNamespace ? `ns-${focusedNamespace}` : null;
    }

    if (!forceGroupId || expanded.includes(forceGroupId) || !groupNodeIds.includes(forceGroupId)) {
      return expanded;
    }

    return [...expanded, forceGroupId];
  }, [expandedGroupIds, focusedNodeId, graphNodeMap, groupMode, groupNodeIds, selectedNamespace]);

  const collapsedHiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    groupNodeIds
      .filter((groupId) => !effectiveExpandedGroupIds.includes(groupId))
      .forEach((groupId) => {
        if (groupMode === "namespace") {
          const namespaceName = graphNodeMap.get(groupId)?.data.label;
          if (!namespaceName) return;
          nodes.forEach((node) => {
            if (node.id === groupId || node.data.tokenKey === "cluster" || node.data.tokenKey === "namespace") {
              return;
            }
            if (getNodeNamespace(node) === namespaceName) {
              hidden.add(node.id);
            }
          });
          return;
        }

        const groupNode = graphNodeMap.get(groupId);
        const groupRaw = groupNode?.data.raw as { abnormalPods?: unknown; pendingPods?: unknown } | undefined;
        const abnormalCount =
          typeof groupRaw?.abnormalPods === "number"
            ? groupRaw.abnormalPods
            : typeof groupRaw?.pendingPods === "number"
              ? groupRaw.pendingPods
              : 0;
        if (resourceFilter === "abnormal" && abnormalCount > 0) {
          return;
        }
        if (groupMode === "instance") {
          edges.forEach((edge) => {
            if (edge.source === groupId) {
              hidden.add(edge.target);
            }
          });
        }

        if (groupMode === "node") {
          edges.forEach((edge) => {
            if (edge.target === groupId) {
              hidden.add(edge.source);
            }
          });
        }
      });

    return hidden;
  }, [edges, effectiveExpandedGroupIds, graphNodeMap, groupMode, groupNodeIds, nodes, resourceFilter]);

  const connectedComponents = useMemo(
    () => buildConnectedComponents(nodes, edges, baseFilteredNodeIds),
    [baseFilteredNodeIds, edges, nodes],
  );
  const { componentIdByNodeId, componentNodeIdsById, componentCanonicalNodeById } = connectedComponents;

  const focusVisibleNodeIds = useMemo(() => {
    if (!focusedNodeId) return null;
    if (!baseFilteredNodeIds.has(focusedNodeId)) return null;
    const focusedNode = graphNodeMap.get(focusedNodeId);
    if (!focusedNode) return null;

    const visible = new Set<string>();
    const includeNamespacePath = (nodeId: string) => {
      const node = graphNodeMap.get(nodeId);
      if (!node) return;
      const namespace = getNodeNamespace(node);
      if (namespace) {
        const namespaceId = `ns-${namespace}`;
        if (baseFilteredNodeIds.has(namespaceId)) {
          visible.add(namespaceId);
        }
      }
      const clusterNode = nodes.find((item) => item.data.tokenKey === "cluster");
      if (clusterNode && baseFilteredNodeIds.has(clusterNode.id)) {
        visible.add(clusterNode.id);
      }
    };

    const componentId = componentIdByNodeId.get(focusedNodeId);
    const componentMemberIds = componentId ? componentNodeIdsById.get(componentId) ?? [] : [focusedNodeId];
    componentMemberIds.forEach((nodeId) => {
      if (!baseFilteredNodeIds.has(nodeId)) return;
      visible.add(nodeId);
      includeNamespacePath(nodeId);
    });

    if (focusedNode.data.tokenKey === "namespace") {
      nodes.forEach((node) => {
        if (node.data.tokenKey === "cluster" || node.data.tokenKey === "namespace") return;
        if (!baseFilteredNodeIds.has(node.id)) return;
        if (getNodeNamespace(node) !== focusedNode.data.label) return;
        visible.add(node.id);
        includeNamespacePath(node.id);
      });
    } else if (focusedNode.data.tokenKey === "cluster") {
      nodes.forEach((node) => {
        if (node.data.tokenKey === "cluster" || node.data.tokenKey === "namespace") {
          if (baseFilteredNodeIds.has(node.id)) visible.add(node.id);
        }
      });
    }

    return visible;
  }, [baseFilteredNodeIds, componentIdByNodeId, componentNodeIdsById, focusedNodeId, graphNodeMap, nodes]);

  const filteredNodeIds = useMemo(() => {
    let ids = new Set(baseFilteredNodeIds);

    if (collapsedHiddenNodeIds.size > 0) {
      ids = new Set(Array.from(ids).filter((id) => !collapsedHiddenNodeIds.has(id)));
    }

    if (focusVisibleNodeIds) {
      ids = new Set(Array.from(ids).filter((id) => focusVisibleNodeIds.has(id)));
    }

    return ids;
  }, [baseFilteredNodeIds, collapsedHiddenNodeIds, focusVisibleNodeIds]);

  const visibleNodes = useMemo(
    () =>
      nodes
        .filter((node) => filteredNodeIds.has(node.id))
        .map((node) => {
          const raw = node.data.raw as Record<string, unknown> | undefined;
          if (
            node.data.tokenKey !== "namespace" &&
            node.data.tokenKey !== "instancegroup" &&
            node.data.tokenKey !== "node"
          ) {
            return node;
          }

          const baseCaption = node.data.caption ?? "";
          const collapsed = !effectiveExpandedGroupIds.includes(node.id);
          return {
            ...node,
            data: {
              ...node.data,
              raw:
                node.data.tokenKey === "namespace"
                  ? {
                      ...raw,
                      selectedGroupSection,
                      onSummarySelect: (section: GroupSectionKey) => {
                        userExpandedGroupsRef.current = true;
                        setUserExpandedGroups(true);
                        setExpandedGroupIds((current) => (current.includes(node.id) ? current : [...current, node.id]));
                        setFocusedNodeId(node.id);
                        setSelectedGroupSection(section);
                      },
                    }
                  : raw,
              caption: collapsed ? `${baseCaption} · 已折叠` : `${baseCaption} · 已展开`,
            },
          };
        }),
    [effectiveExpandedGroupIds, nodes, filteredNodeIds, selectedGroupSection],
  );
  const visibleEdges = useMemo(
    () => edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)),
    [edges, filteredNodeIds],
  );
  const effectiveNamespaceExpandedGroupIds = useMemo(() => {
    if (groupMode !== "namespace") return effectiveExpandedGroupIds;
    if (selectedNamespace !== ALL_NAMESPACE) return effectiveExpandedGroupIds;
    if (focusedNodeId) return effectiveExpandedGroupIds;
    if (activeQuickAction) return effectiveExpandedGroupIds;
    if (resourceFilter !== "all") return effectiveExpandedGroupIds;
    if (userExpandedGroups) return effectiveExpandedGroupIds;
    return [];
  }, [
    activeQuickAction,
    effectiveExpandedGroupIds,
    focusedNodeId,
    groupMode,
    resourceFilter,
    selectedNamespace,
    userExpandedGroups,
  ]);
  const focusedNamespaceId = useMemo(() => {
    if (!focusedNodeId || groupMode !== "namespace") return null;
    const focused = graphNodeMap.get(focusedNodeId);
    if (!focused) return null;
    if (focused.data.tokenKey === "namespace") return focused.id;
    const namespace = getNodeNamespace(focused);
    return namespace ? `ns-${namespace}` : null;
  }, [focusedNodeId, graphNodeMap, groupMode]);
  const focusedNode = useMemo(
    () => (focusedNodeId ? graphNodeMap.get(focusedNodeId) ?? null : null),
    [focusedNodeId, graphNodeMap],
  );
  const topologyViewMode = useMemo<TopologyViewMode>(() => {
    if (groupMode !== "namespace") return "free";
    if (
      focusedNode &&
      focusedNode.data.tokenKey !== "cluster" &&
      focusedNode.data.tokenKey !== "namespace" &&
      !isGroupTokenKey(focusedNode.data.tokenKey)
    ) {
      return "resource-focus";
    }
    if (
      selectedNamespace === ALL_NAMESPACE &&
      !focusedNodeId &&
      resourceFilter === "all" &&
      !activeQuickAction &&
      !userExpandedGroups
    ) {
      return "namespace-overview";
    }
    return "namespace-stack";
  }, [activeQuickAction, focusedNode, focusedNodeId, groupMode, resourceFilter, selectedNamespace, userExpandedGroups]);
  const visibleLayoutNodes = useMemo(() => {
    if (topologyViewMode === "namespace-overview") {
      return applyNamespaceOverviewLayout(visibleNodes, focusedNamespaceId);
    }

    if (topologyViewMode === "resource-focus") {
      return applyFocusedRelationLayout(visibleNodes, visibleEdges);
    }

    if (groupMode === "namespace") {
      return applyNamespaceStackLayout(
        visibleNodes,
        visibleEdges,
        effectiveNamespaceExpandedGroupIds,
        focusedNamespaceId,
        componentIdByNodeId,
        componentNodeIdsById,
      );
    }

    const shouldCompactVisibleLayout = collapsedHiddenNodeIds.size > 0;
    if (!shouldCompactVisibleLayout || visibleNodes.length === 0) return visibleNodes;
    return applyDagreLayout(visibleNodes, visibleEdges, { nodesep: 42, ranksep: 108, marginx: 68, marginy: 60 });
  }, [
    componentIdByNodeId,
    componentNodeIdsById,
    groupMode,
    collapsedHiddenNodeIds.size,
    focusedNamespaceId,
    topologyViewMode,
    visibleNodes,
    visibleEdges,
    effectiveNamespaceExpandedGroupIds,
  ]);

  const layoutViewportKey = useMemo(
    () =>
      JSON.stringify({
        clusterId: selectedCluster?.id ?? null,
        groupMode,
        topologyViewMode,
        visibleNodeCount: visibleLayoutNodes.length,
        focusedNodeId: focusedNodeId ?? null,
        selectedNamespace,
      }),
    [focusedNodeId, groupMode, selectedCluster?.id, selectedNamespace, topologyViewMode, visibleLayoutNodes.length],
  );

  const canvasEdges = useMemo(() => {
    if (topologyViewMode === "namespace-overview") {
      return [];
    }
    if (topologyViewMode === "resource-focus") {
      const visibleNodeIds = new Set(visibleLayoutNodes.map((node) => node.id));
      return visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
    }
    if (groupMode === "namespace") {
      return buildNamespaceCanvasEdges(visibleLayoutNodes, visibleEdges, focusedNodeId);
    }
    return visibleEdges;
  }, [focusedNodeId, groupMode, topologyViewMode, visibleEdges, visibleLayoutNodes]);
  const focusedResourceDetailRequest = useMemo(
    () => resolveResourceDetailRequest(focusedNode),
    [focusedNode],
  );


  const resourceFocusCounts = useMemo(() => {
    const counts = new Map<SourceKey, number>();
    nodes.forEach((node) => {
      if (!baseFilteredNodeIds.has(node.id)) return;
      if (!isSourceKey(node.data.tokenKey)) return;
      counts.set(node.data.tokenKey, (counts.get(node.data.tokenKey) ?? 0) + 1);
    });

    return counts;
  }, [nodes, baseFilteredNodeIds]);

  const resourceFocusSections = useMemo(() => {
    return RESOURCE_DOMAIN_KEYS.map((domain) => {
      const items = RESOURCE_DOMAIN_META[domain].keys.map((key) => ({
        value: key,
        label: TOKEN[key].label,
        icon: TOKEN[key].icon,
        count: resourceFocusCounts.get(key) ?? 0,
      })).filter((item) => item.count > 0);

      return {
        domain,
        domainCount: RESOURCE_DOMAIN_META[domain].keys.reduce(
          (total, key) => total + (resourceFocusCounts.get(key) ?? 0),
          0,
        ),
        items,
      };
    });
  }, [resourceFocusCounts]);

  const selectedResourceFocusSummary = useMemo(() => {
    const availableSet = new Set(availableResourceTypeKeys);
    const selectedAvailable = effectiveSelectedResourceTypes.filter((key) => availableSet.has(key));

    if (selectedAvailable.length === availableResourceTypeKeys.length) {
      return "全部资源";
    }

    const fullDomains = RESOURCE_DOMAIN_KEYS.filter((domain) =>
      RESOURCE_DOMAIN_META[domain].keys
        .filter((key) => availableSet.has(key))
        .every((key) => selectedAvailable.includes(key)),
    );

    if (fullDomains.length > 0) {
      const labels = fullDomains.map((domain) => RESOURCE_DOMAIN_META[domain].shortLabel);
      return labels.length <= 2 ? labels.join(", ") : `${labels[0]}, ${labels[1]}, +${labels.length - 2}`;
    }

    const labels = selectedAvailable.map((key) => TOKEN[key].label);
    return labels.length <= 2 ? labels.join(", ") : `${labels[0]}, ${labels[1]}, +${labels.length - 2}`;
  }, [availableResourceTypeKeys, effectiveSelectedResourceTypes]);

  const breadcrumbItems = useMemo(() => {
    if (!focusedNodeId) return [];
    const node = graphNodeMap.get(focusedNodeId);
    if (!node) return [];

    const items: Array<{ id: string; label: string; typeLabel: string; nodeId?: string }> = [];
    const clusterNode = nodes.find((item) => item.data.tokenKey === "cluster");
    const namespace = getNodeNamespace(node);

    if (clusterNode) {
      items.push({
        id: clusterNode.id,
        nodeId: clusterNode.id,
        label: clusterNode.data.label,
        typeLabel: clusterNode.data.typeLabel,
      });
    }

    if (namespace) {
      const namespaceNode = graphNodeMap.get(`ns-${namespace}`);
      if (namespaceNode && namespaceNode.id !== clusterNode?.id) {
        items.push({
          id: namespaceNode.id,
          nodeId: namespaceNode.id,
          label: namespaceNode.data.label,
          typeLabel: namespaceNode.data.typeLabel,
        });
      }
    }

    if (node.data.tokenKey !== "namespace" && node.data.tokenKey !== "cluster") {
      const componentId = componentIdByNodeId.get(node.id);
      if (componentId) {
        const memberIds = componentNodeIdsById.get(componentId) ?? [];
        const componentLabelNode =
          memberIds
            .map((id) => graphNodeMap.get(id))
            .filter((value): value is Node<TopoNodeData> => Boolean(value))
            .sort((left, right) => {
              const leftOrder = STACK_TOKEN_ORDER.indexOf(left.data.tokenKey);
              const rightOrder = STACK_TOKEN_ORDER.indexOf(right.data.tokenKey);
              const normalizedLeft = leftOrder >= 0 ? leftOrder : STACK_TOKEN_ORDER.length;
              const normalizedRight = rightOrder >= 0 ? rightOrder : STACK_TOKEN_ORDER.length;
              if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
              return left.data.label.localeCompare(right.data.label);
            })[0] ?? null;

        if (componentLabelNode) {
          items.push({
            id: componentId,
            nodeId: componentCanonicalNodeById.get(componentId) ?? componentLabelNode.id,
            label: `${componentLabelNode.data.label} group`,
            typeLabel: "component",
          });
        }
      }
    }

    if (node.id !== clusterNode?.id && node.id !== `ns-${namespace}`) {
      items.push({ id: node.id, nodeId: node.id, label: node.data.label, typeLabel: node.data.typeLabel });
    }

    return items;
  }, [componentCanonicalNodeById, componentIdByNodeId, componentNodeIdsById, focusedNodeId, graphNodeMap, nodes]);

  const connections = useMemo(() => {
    if (!focusedNodeId) return [];
    const neighbors = new Map<string, { id: string; label: string; typeLabel: string; tokenKey: TokenKey }>();

    edges.forEach((edge) => {
      const adjacentId =
        edge.source === focusedNodeId ? edge.target : edge.target === focusedNodeId ? edge.source : null;
      if (!adjacentId) return;
      const adjacentNode = graphNodeMap.get(adjacentId);
      if (!adjacentNode) return;

      neighbors.set(adjacentId, {
        id: adjacentId,
        label: adjacentNode.data.label,
        typeLabel: adjacentNode.data.typeLabel,
        tokenKey: adjacentNode.data.tokenKey,
      });
    });

    return Array.from(neighbors.values()).slice(0, 8);
  }, [focusedNodeId, edges, graphNodeMap]);

  const groupMembers = useMemo(() => {
    if (!focusedNode) return [];
    if (!["namespace", "instancegroup", "node"].includes(focusedNode.data.tokenKey)) return [];

    const buildMemberItem = (node: Node<TopoNodeData>) => {
      const raw = node.data.raw as {
        state?: unknown;
        pendingPods?: unknown;
      } | undefined;
      const pendingCount = typeof raw?.pendingPods === "number" ? raw.pendingPods : 0;
      const risk: DetailRelationItem["risk"] =
        ["Pending", "Failed", "Unknown"].includes(node.data.status ?? "") || pendingCount > 0
          ? "high"
          : raw?.state === "degraded"
            ? "medium"
            : undefined;
      const statusText =
        node.data.status ??
        (typeof raw?.state === "string" && raw.state !== "active" ? String(raw.state) : undefined);
      const secondaryText = node.data.replicas ?? (pendingCount > 0 ? `未就绪 ${pendingCount}` : undefined);

      return {
        id: node.id,
        label: node.data.label,
        typeLabel: node.data.typeLabel,
        tokenKey: node.data.tokenKey,
        statusText,
        secondaryText,
        risk,
      };
    };

    if (focusedNode.data.tokenKey === "namespace") {
      return visibleLayoutNodes
        .filter((node) => node.id !== focusedNode.id)
        .filter((node) => {
          const raw = node.data.raw as { layoutLane?: unknown } | undefined;
          if (raw?.layoutLane) return false;
          return getNodeNamespace(node) === focusedNode.data.label;
        })
        .map(buildMemberItem)
        .slice(0, 14);
    }

    const memberIds = new Set<string>();
    edges.forEach((edge) => {
      if (focusedNode.data.tokenKey === "instancegroup" && edge.source === focusedNode.id) {
        memberIds.add(edge.target);
      }
      if (focusedNode.data.tokenKey === "node" && edge.target === focusedNode.id) {
        memberIds.add(edge.source);
      }
    });

    return Array.from(memberIds)
      .map((id) => graphNodeMap.get(id))
      .filter((node): node is Node<TopoNodeData> => Boolean(node))
      .map(buildMemberItem)
      .slice(0, 14);
  }, [edges, focusedNode, graphNodeMap, visibleLayoutNodes]);

  const groupSummary = useMemo(() => {
    if (!focusedNode) return null;
    if (!["namespace", "instancegroup", "node"].includes(focusedNode.data.tokenKey)) return null;

    const summary = {
      total: groupMembers.length,
      network: 0,
      workloads: 0,
      pods: 0,
      unready: 0,
    };

    groupMembers.forEach((member) => {
      if (NETWORK_STACK_KEYS.has(member.tokenKey)) summary.network += 1;
      else if (WORKLOAD_STACK_KEYS.has(member.tokenKey)) summary.workloads += 1;
      else if (member.tokenKey === "pod") summary.pods += 1;

      const node = graphNodeMap.get(member.id);
      if (!node) return;
      const raw = node.data.raw as { pendingPods?: unknown } | undefined;
      if (["Pending", "Failed", "Unknown"].includes(node.data.status ?? "")) {
        summary.unready += 1;
      } else if (typeof raw?.pendingPods === "number") {
        summary.unready += raw.pendingPods;
      }
    });

    return summary;
  }, [focusedNode, graphNodeMap, groupMembers]);

  const quickLinkDefinitions = useMemo(
    () => [
      { key: "service", label: "前往 Service 页面", path: "/network/services" },
      { key: "endpoints", label: "前往 Endpoints 页面", path: "/network/endpoints" },
      { key: "endpointslice", label: "前往 EndpointSlice 页面", path: "/network/endpointslices" },
      { key: "ingress", label: "前往 Ingress 页面", path: "/network/ingress" },
      { key: "ingressroute", label: "前往 IngressRoute 页面", path: "/network/ingressroute" },
      { key: "deployment", label: "前往 Deployment 页面", path: "/workloads/deployments" },
      { key: "statefulset", label: "前往 StatefulSet 页面", path: "/workloads/statefulsets" },
      { key: "daemonset", label: "前往 DaemonSet 页面", path: "/workloads/daemonsets" },
      { key: "pod", label: "前往 Pod 页面", path: "/workloads/pods" },
    ],
    [],
  );

  const focusNamespace = useMemo(() => {
    if (!focusedNode) return selectedNamespace;
    const raw = focusedNode.data.raw as Record<string, unknown> | undefined;
    const ns = typeof raw?.namespace === "string" ? raw.namespace.trim() : "";
    return ns || selectedNamespace;
  }, [focusedNode, selectedNamespace]);

  const detailInteractionsDisabled = clusterDataUnavailable;

  const focusNodeById = useCallback(
    (targetNodeId: string | null) => {
      const nextNode = targetNodeId ? graphNodeMap.get(targetNodeId) ?? null : null;
      setFocusedNodeId(targetNodeId);
      setSelectedGroupSection(null);

      if (!nextNode || !isGroupTokenKey(nextNode.data.tokenKey)) return;
      userExpandedGroupsRef.current = true;
      setUserExpandedGroups(true);
      setExpandedGroupIds((current) => {
        const currentSet = new Set(current);
        currentSet.add(nextNode.id);
        return Array.from(currentSet);
      });
    },
    [graphNodeMap],
  );

  const handleOpenQuickLink = useCallback(
    (key: string) => {
      const target = quickLinkDefinitions.find((item) => item.key === key);
      if (!target) return;
      const params = new URLSearchParams();
      if (effectiveClusterId) {
        params.set("clusterId", effectiveClusterId);
        params.set("cluster", effectiveClusterId);
      }
      if (focusNamespace && focusNamespace !== ALL_NAMESPACE) {
        params.set("namespace", focusNamespace);
      }
      const keyword = focusedNode?.data.label?.trim();
      if (keyword && focusedNode?.data.tokenKey !== "cluster" && focusedNode?.data.tokenKey !== "namespace") {
        params.set("keyword", keyword);
      }
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${target.path}?${query}` : target.path);
      });
    },
    [effectiveClusterId, focusNamespace, focusedNode?.data.label, focusedNode?.data.tokenKey, quickLinkDefinitions, router],
  );

  const currentResourceActionLabel = useMemo(() => {
    const tokenKey = focusedNode?.data.tokenKey;
    if (!tokenKey || tokenKey === "cluster" || tokenKey === "namespace" || tokenKey === "instancegroup" || tokenKey === "node") {
      return null;
    }
    const def = quickLinkDefinitions.find((item) => item.key === tokenKey);
    return def ? def.label : null;
  }, [focusedNode?.data.tokenKey, quickLinkDefinitions]);

  const handleOpenCurrentResource = useCallback(() => {
    const tokenKey = focusedNode?.data.tokenKey;
    if (!tokenKey) return;
    if (tokenKey === "cluster" || tokenKey === "namespace" || tokenKey === "instancegroup" || tokenKey === "node") return;
    handleOpenQuickLink(tokenKey);
  }, [focusedNode?.data.tokenKey, handleOpenQuickLink]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<TopoNodeData>) => {
    const raw = node.data.raw as { layoutLane?: unknown } | undefined;
    if (raw?.layoutLane) return;
    focusNodeById(node.id);
  }, [focusNodeById]);

  const handleRefresh = useCallback(() => {
    refetch();
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setDetailRequest(null);
    setViewportVersion((current) => current + 1);
  }, [refetch]);

  const handleClusterChange = useCallback(
    (value: string) => {
      userExpandedGroupsRef.current = false;
      setUserExpandedGroups(false);
      setSelectedClusterId(value);
      setSelectedNamespace(ALL_NAMESPACE);
      setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
      setSelectedGroupSection(null);
      setFocusedNodeId(null);
      setExpandedGroupIds([]);
      setDetailRequest(null);
      setResourceFocusPanelOpen(false);
      setClusterPanelOpen(false);
      setViewportVersion((current) => current + 1);
    },
    [],
  );

  const handleNamespaceChange = useCallback((value: string) => {
    userExpandedGroupsRef.current = value !== ALL_NAMESPACE;
    setUserExpandedGroups(value !== ALL_NAMESPACE);
    setSelectedNamespace(value);
    setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setExpandedGroupIds(value === ALL_NAMESPACE ? [] : [`ns-${value}`]);
    setDetailRequest(null);
    setResourceFocusPanelOpen(false);
    setNamespacePanelOpen(false);
    setViewportVersion((current) => current + 1);
  }, []);

  const handleSelectAllResourceTypes = useCallback(() => {
    setSelectedResourceTypes(
      availableResourceTypeKeys.length > 0 ? [...availableResourceTypeKeys] : [...SOURCE_TOKEN_KEYS],
    );
    setSelectedGroupSection(null);
  }, [availableResourceTypeKeys]);

  const handleResetResourceTypesToDefault = useCallback(() => {
    setSelectedResourceTypes([...availableResourceTypeKeys]);
    setSelectedGroupSection(null);
  }, [availableResourceTypeKeys]);

  const handleToggleResourceDomain = useCallback((domain: ResourceDomainKey) => {
    setExpandedResourceDomains((current) =>
      current.includes(domain)
        ? current.filter((item) => item !== domain)
        : [...current, domain],
    );
  }, []);

  const handleToggleResourceDomainSelection = useCallback((domain: ResourceDomainKey) => {
    const keys = RESOURCE_DOMAIN_META[domain].keys;
    setSelectedResourceTypes((current) => {
      const allSelected = keys.every((key) => effectiveSelectedResourceTypes.includes(key));
      if (allSelected) {
        const next = current.filter((key) => !keys.includes(key));
        return next.length > 0 ? next : current;
      }
      return Array.from(new Set([...current, ...keys]));
    });
    setSelectedGroupSection(null);
  }, [effectiveSelectedResourceTypes]);

  const handleToggleResourceType = useCallback((value: SourceKey) => {
    setSelectedResourceTypes((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value);
        return next.length > 0 ? next : current;
      }
      return [...current, value];
    });
    setSelectedGroupSection(null);
  }, []);

  const handleGroupModeChange = useCallback((value: GroupMode) => {
    userExpandedGroupsRef.current = false;
    setUserExpandedGroups(false);
    setGroupMode(value);
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setExpandedGroupIds([]);
    setDetailRequest(null);
    setGroupModePanelOpen(false);
    setViewportVersion((current) => current + 1);
  }, []);

  const handleAbnormalFocusToggle = useCallback(() => {
    setResourceFilter((current) => (current === "abnormal" ? "all" : "abnormal"));
    setSelectedGroupSection(null);
  }, []);

  const handleFitView = useCallback(() => {
    fitViewRef.current?.();
  }, []);

  const handleZoomIn = useCallback(() => {
    zoomInRef.current?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    zoomOutRef.current?.();
  }, []);

  const handleResetView = useCallback(() => {
    userExpandedGroupsRef.current = false;
    setUserExpandedGroups(false);
    setFocusedNodeId(null);
    setSelectedGroupSection(null);
    setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
    setGroupMode("namespace");
    setResourceFilter("all");
    setActiveQuickAction(null);
    setExpandedGroupIds([]);
    setDetailRequest(null);
    setClusterPanelOpen(false);
    setNamespacePanelOpen(false);
    setGroupModePanelOpen(false);
    setResourceFocusPanelOpen(false);
    setViewportVersion((current) => current + 1);
  }, []);

  const hasNodes = visibleLayoutNodes.length > 0;
  const isAbnormalFocusActive = resourceFilter === "abnormal";
  const abnormalDistribution = useMemo(() => {
    const riskCounts: Record<"high" | "medium" | "low", number> = { high: 0, medium: 0, low: 0 };
    let unreadyCount = 0;
    visibleNodes.forEach((node) => {
      const raw = node.data.raw as {
        abnormalPods?: unknown;
        pendingPods?: unknown;
        riskLevel?: unknown;
      } | undefined;
      const abnormal =
        typeof raw?.abnormalPods === "number"
          ? raw.abnormalPods
          : typeof raw?.pendingPods === "number"
            ? raw.pendingPods
            : ["Pending", "Failed", "Unknown"].includes(node.data.status ?? "")
              ? 1
              : 0;
      unreadyCount += abnormal;
      if (abnormal <= 0) return;
      if (node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node") {
        const risk = raw?.riskLevel === "high" || raw?.riskLevel === "medium" ? raw.riskLevel : "low";
        riskCounts[risk] += 1;
        return;
      }
      riskCounts.high += 1;
    });
    return [
      { label: "高风险", count: riskCounts.high, risk: "high" as const },
      { label: "中风险", count: riskCounts.medium, risk: "medium" as const },
      { label: "低风险", count: riskCounts.low, risk: "low" as const },
      { label: "未就绪", count: unreadyCount, risk: "unready" as const },
    ];
  }, [visibleNodes]);

  const abnormalGroupIds = useMemo(
    () =>
      nodes
        .filter((node) => node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node")
        .filter((node) => {
          const raw = node.data.raw as { abnormalPods?: unknown; pendingPods?: unknown } | undefined;
          const abnormal =
            typeof raw?.abnormalPods === "number"
              ? raw.abnormalPods
              : typeof raw?.pendingPods === "number"
                ? raw.pendingPods
                : 0;
          return abnormal > 0;
        })
        .map((node) => node.id),
    [nodes],
  );
  const highRiskGroupIds = useMemo(
    () =>
      nodes
        .filter((node) => node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node")
        .filter((node) => {
          const raw = node.data.raw as { riskLevel?: unknown; abnormalPods?: unknown; pendingPods?: unknown } | undefined;
          const abnormal =
            typeof raw?.abnormalPods === "number"
              ? raw.abnormalPods
              : typeof raw?.pendingPods === "number"
                ? raw.pendingPods
                : 0;
          return abnormal > 0 && raw?.riskLevel === "high";
        })
        .map((node) => node.id),
    [nodes],
  );

  const handleQuickFilter = useCallback(
    (action: "abnormal" | "group" | "highRisk") => {
      setActiveQuickAction(action);
      if (action === "abnormal") {
        setResourceFilter("abnormal");
        setSelectedGroupSection(null);
        return;
      }
      if (action === "highRisk") {
        setResourceFilter("abnormal");
        const target = highRiskGroupIds.length > 0 ? highRiskGroupIds : abnormalGroupIds;
        setExpandedGroupIds((current) => Array.from(new Set([...current, ...target])));
        setSelectedGroupSection(null);
        setFocusedNodeId(target[0] ?? null);
        return;
      }
      if (action === "group") {
        setResourceFilter("abnormal");
        setExpandedGroupIds((current) => Array.from(new Set([...current, ...abnormalGroupIds])));
        setSelectedGroupSection(null);
        setFocusedNodeId(abnormalGroupIds[0] ?? null);
        return;
      }
    },
    [abnormalGroupIds, highRiskGroupIds],
  );

  const isFocusedGroupExpanded = useMemo(
    () => (focusedNodeId ? effectiveExpandedGroupIds.includes(focusedNodeId) : false),
    [effectiveExpandedGroupIds, focusedNodeId],
  );

  const resourceFocusPanel = (
    <div className="topology-popover-panel topology-popover-panel--resource-focus">
      <div>
        <div className="topology-resource-tree__toolbar">
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--topology-overview-subtle)",
            }}
          >
            资源域
          </div>
          <div className="topology-resource-tree__toolbar-actions">
            <button type="button" className="topology-resource-tree__toolbar-action" onClick={handleSelectAllResourceTypes}>
              全选
            </button>
            <button type="button" className="topology-resource-tree__toolbar-action" onClick={handleResetResourceTypesToDefault}>
              默认
            </button>
          </div>
        </div>
        <button
          type="button"
          className={`topology-resource-tree__all ${effectiveSelectedResourceTypes.length === availableResourceTypeKeys.length ? "is-active" : ""}`}
          onClick={handleSelectAllResourceTypes}
        >
          <span className="topology-resource-tree__all-main">
            <FilterOutlined />
            <strong>全部资源</strong>
          </span>
          <span className="topology-resource-tree__all-check">
            {effectiveSelectedResourceTypes.length === availableResourceTypeKeys.length ? <CheckOutlined /> : null}
          </span>
        </button>
      </div>

      {resourceFocusSections.map((section) => (
        <div key={section.domain} className="topology-resource-tree">
          <div className="topology-resource-tree__header">
            <button
              type="button"
              className="topology-resource-tree__title"
              onClick={() => handleToggleResourceDomain(section.domain)}
            >
              {expandedResourceDomains.includes(section.domain) ? (
                <DownOutlined style={{ fontSize: 12 }} />
              ) : (
                <RightOutlined style={{ fontSize: 12 }} />
              )}
              <span style={{ color: "var(--topology-overview-subtle)" }}>
                {RESOURCE_DOMAIN_META[section.domain].icon}
              </span>
              <span>{RESOURCE_DOMAIN_META[section.domain].label}</span>
            </button>
            <div className="topology-resource-tree__controls">
              <Text type="secondary" style={{ fontSize: 12 }}>
                {section.domainCount} 个
              </Text>
              <button
                type="button"
                className={`topology-resource-tree__check ${
                  RESOURCE_DOMAIN_META[section.domain].keys.every((key) => effectiveSelectedResourceTypes.includes(key))
                    ? "is-checked"
                    : RESOURCE_DOMAIN_META[section.domain].keys.some((key) => effectiveSelectedResourceTypes.includes(key))
                      ? "is-indeterminate"
                      : ""
                }`}
                onClick={() => handleToggleResourceDomainSelection(section.domain)}
              >
                {RESOURCE_DOMAIN_META[section.domain].keys.every((key) => effectiveSelectedResourceTypes.includes(key)) ? (
                  <CheckOutlined />
                ) : RESOURCE_DOMAIN_META[section.domain].keys.some((key) => effectiveSelectedResourceTypes.includes(key)) ? (
                  <span className="topology-resource-tree__dash" />
                ) : null}
              </button>
            </div>
          </div>
          <div className={`topology-resource-tree__items ${expandedResourceDomains.includes(section.domain) ? "is-expanded" : "is-collapsed"}`}>
            {section.items.length === 0 ? (
              <Tag variant="filled" color="default" style={{ margin: 0 }}>
                当前范围无资源
              </Tag>
            ) : (
              section.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`topology-resource-tree__item ${effectiveSelectedResourceTypes.includes(item.value) ? "is-active" : ""}`}
                  onClick={() => handleToggleResourceType(item.value)}
                >
                  <span className="topology-resource-tree__item-main">
                    <span>{item.icon}</span>
                    <strong>{item.label}</strong>
                  </span>
                  <span className="topology-resource-tree__item-side">
                    <span style={{ fontSize: 11, opacity: 0.72 }}>{item.count}</span>
                    <span className={`topology-resource-tree__check ${effectiveSelectedResourceTypes.includes(item.value) ? "is-checked" : ""}`}>
                      {effectiveSelectedResourceTypes.includes(item.value) ? <CheckOutlined /> : null}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
  const selectedClusterLabel =
    clustersData?.items?.find((item) => item.id === effectiveClusterId)?.name ?? "选择集群";
  const selectedNamespaceLabel =
    namespaceOptions.find((item) => item.value === selectedNamespace)?.label ?? "全部名称空间";
  const selectedGroupModeLabel =
    GROUP_MODE_ITEMS.find((item) => item.value === groupMode)?.label ?? "名称空间";
  const toolbarShellStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 18,
    border: "1px solid rgba(203, 213, 225, 0.42)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(248,250,252,0.66) 100%)",
    boxShadow: "0 10px 26px rgba(15, 23, 42, 0.045), inset 0 1px 0 rgba(255,255,255,0.68)",
    backdropFilter: "blur(14px)",
  };
  const toolbarPillBaseStyle: React.CSSProperties = {
    minHeight: 52,
    minWidth: 168,
    padding: "10px 14px",
    borderRadius: 16,
    border: "1px solid rgba(191, 219, 254, 0.7)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.84) 0%, rgba(239,246,255,0.74) 100%)",
    boxShadow: "0 8px 18px rgba(37, 99, 235, 0.06), inset 0 1px 0 rgba(255,255,255,0.84)",
  };
  const toolbarWidePillStyle: React.CSSProperties = {
    ...toolbarPillBaseStyle,
    minWidth: 236,
  };
  const toolbarToggleStyle: React.CSSProperties = {
    ...toolbarPillBaseStyle,
    minWidth: 174,
    background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.9) 100%)",
  };

  const clusterPanel = (
    <div className="topology-popover-panel topology-popover-panel--compact">
      {(clustersData?.items ?? []).map((item) => (
        <button
          key={item.id}
          type="button"
          className={`topology-resource-tree__item ${effectiveClusterId === item.id ? "is-active" : ""}`}
          onClick={() => handleClusterChange(item.id)}
        >
          <span className="topology-resource-tree__item-main">
            <span>☸</span>
            <strong>{item.name}</strong>
          </span>
          <span className="topology-resource-tree__item-side">
            <span className={`topology-resource-tree__check ${effectiveClusterId === item.id ? "is-checked" : ""}`}>
              {effectiveClusterId === item.id ? <CheckOutlined /> : null}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  const namespacePanel = (
    <div className="topology-popover-panel topology-popover-panel--compact topology-popover-panel--scroll">
      {namespaceOptions.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`topology-resource-tree__item ${selectedNamespace === item.value ? "is-active" : ""}`}
          onClick={() => handleNamespaceChange(item.value)}
        >
          <span className="topology-resource-tree__item-main">
            <span>⬡</span>
            <strong>{item.label}</strong>
          </span>
          <span className="topology-resource-tree__item-side">
            <span className={`topology-resource-tree__check ${selectedNamespace === item.value ? "is-checked" : ""}`}>
              {selectedNamespace === item.value ? <CheckOutlined /> : null}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  const groupModePanel = (
    <div className="topology-popover-panel topology-popover-panel--narrow">
      {GROUP_MODE_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`topology-resource-tree__item ${groupMode === item.value ? "is-active" : ""}`}
          onClick={() => handleGroupModeChange(item.value)}
        >
          <span className="topology-resource-tree__item-main">
            <span>◫</span>
            <strong>{item.label}</strong>
          </span>
          <span className="topology-resource-tree__item-side">
            <span className={`topology-resource-tree__check ${groupMode === item.value ? "is-checked" : ""}`}>
              {groupMode === item.value ? <CheckOutlined /> : null}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="topology-overview-page">
      <section className="topology-map-shell">
        <div className="topology-toolbar-stack" style={toolbarShellStyle}>
          <div className="topology-toolbar-row">
            <div className="topology-toolbar-section">
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={clusterPanelOpen}
                onOpenChange={setClusterPanelOpen}
                content={clusterPanel}
                overlayStyle={{ width: "var(--topology-popover-width-compact)", maxWidth: "calc(100vw - 24px)" }}
              >
                <button
                  type="button"
                  className={`topology-filter-pill topology-filter-pill--interactive ${clusterPanelOpen ? "is-active" : ""}`}
                  style={{ ...toolbarPillBaseStyle, opacity: clustersLoading ? 0.6 : 1 }}
                  disabled={clustersLoading}
                >
                  <span className="topology-filter-pill__lead">
                    <span className="topology-filter-pill__icon">
                      <RadarChartOutlined />
                    </span>
                  </span>
                  <span className="topology-filter-pill__content">
                    <span className="topology-filter-pill__label">集群</span>
                    <span className="topology-filter-pill__value">{selectedClusterLabel}</span>
                  </span>
                  <span className="topology-filter-pill__meta">
                    <DownOutlined className="topology-filter-pill__arrow" />
                  </span>
                </button>
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={namespacePanelOpen}
                onOpenChange={setNamespacePanelOpen}
                content={namespacePanel}
                overlayStyle={{ width: "var(--topology-popover-width-compact)", maxWidth: "calc(100vw - 24px)" }}
              >
                <button
                  type="button"
                  className={`topology-filter-pill topology-filter-pill--interactive ${namespacePanelOpen ? "is-active" : ""}`}
                  style={toolbarPillBaseStyle}
                >
                  <span className="topology-filter-pill__lead">
                    <span className="topology-filter-pill__icon">
                      <BranchesOutlined />
                    </span>
                  </span>
                  <span className="topology-filter-pill__content">
                    <span className="topology-filter-pill__label">名称空间</span>
                    <span className="topology-filter-pill__value">{selectedNamespaceLabel}</span>
                  </span>
                  <span className="topology-filter-pill__meta">
                    <DownOutlined className="topology-filter-pill__arrow" />
                  </span>
                </button>
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={resourceFocusPanelOpen}
                onOpenChange={setResourceFocusPanelOpen}
                content={resourceFocusPanel}
                overlayStyle={{ width: "var(--topology-popover-width-resource)", maxWidth: "calc(100vw - 24px)" }}
              >
                <button
                  type="button"
                  className={`topology-filter-pill topology-filter-pill--interactive topology-filter-pill--wide ${resourceFocusPanelOpen ? "is-active" : ""}`}
                  style={toolbarWidePillStyle}
                >
                  <span className="topology-filter-pill__lead">
                    <span className="topology-filter-pill__icon">
                      <FilterOutlined />
                    </span>
                  </span>
                  <span className="topology-filter-pill__content">
                    <span className="topology-filter-pill__label">资源类型</span>
                    <span className="topology-filter-pill__value">{selectedResourceFocusSummary}</span>
                  </span>
                  <span className="topology-filter-pill__meta">
                    <span className="topology-filter-pill__count">{effectiveSelectedResourceTypes.length}</span>
                    <DownOutlined className="topology-filter-pill__arrow" />
                  </span>
                </button>
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={groupModePanelOpen}
                onOpenChange={setGroupModePanelOpen}
                content={groupModePanel}
                overlayStyle={{ width: "var(--topology-popover-width-narrow)", maxWidth: "calc(100vw - 24px)" }}
              >
                <button
                  type="button"
                  className={`topology-filter-pill topology-filter-pill--interactive ${groupModePanelOpen ? "is-active" : ""}`}
                  style={toolbarPillBaseStyle}
                >
                  <span className="topology-filter-pill__lead">
                    <span className="topology-filter-pill__icon">
                      <BranchesOutlined />
                    </span>
                  </span>
                  <span className="topology-filter-pill__content">
                    <span className="topology-filter-pill__label">分组</span>
                    <span className="topology-filter-pill__value">{selectedGroupModeLabel}</span>
                  </span>
                  <span className="topology-filter-pill__meta">
                    <DownOutlined className="topology-filter-pill__arrow" />
                  </span>
                </button>
              </Popover>
              <button
                type="button"
                className={`topology-filter-pill topology-filter-pill--toggle ${isAbnormalFocusActive ? "is-active" : ""}`}
                onClick={handleAbnormalFocusToggle}
                style={toolbarToggleStyle}
              >
                <span className="topology-filter-pill__lead">
                  <span className="topology-filter-pill__icon topology-filter-pill__icon--warning">
                    <WarningOutlined />
                  </span>
                </span>
                <span className="topology-filter-pill__content">
                  <span className="topology-filter-pill__label">异常链路</span>
                  <span className="topology-filter-pill__value">聚焦告警</span>
                </span>
                <span className="topology-filter-pill__meta">
                  <WarningOutlined className="topology-filter-pill__toggle-icon" />
                </span>
              </button>
            </div>

            <div className="topology-toolbar-section topology-toolbar-section--compact">
              <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={networkLoading && isLoading}>
                刷新数据
              </Button>
              <Button size="small" onClick={handleResetView}>回到全局</Button>
              <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitView={handleFitView} />
            </div>
          </div>

        </div>

        <div className={`topology-workbench ${focusedNode ? "has-detail" : "is-canvas-only"}`}>
          <section className="topology-canvas-stage">
            <div className="topology-canvas-stage__body">
              <div className="topology-canvas-stage__breadcrumbs">
                {breadcrumbItems.length === 0 ? (
                  <Tag variant="filled" color="default" style={{ margin: 0 }}>
                    Global
                  </Tag>
                ) : (
                  breadcrumbItems.map((item, index) => (
                    <Button
                      key={item.id}
                      size="small"
                      type={index === breadcrumbItems.length - 1 ? "primary" : "default"}
                      disabled={!item.nodeId}
                      onClick={() => {
                        const targetNodeId = item.nodeId;
                        if (!targetNodeId) return;
                        focusNodeById(targetNodeId);
                      }}
                    >
                      {item.typeLabel} / {item.label}
                    </Button>
                  ))
                )}
              </div>
              <div className="topology-canvas-surface">
                <ReactFlowProvider>
                  <TopologyCanvas
                    nodes={visibleLayoutNodes}
                    edges={canvasEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={handleNodeClick}
                    onNodeDragStart={() => setIsNodeDragging(true)}
                    onNodeDragStop={() => setIsNodeDragging(false)}
                    isLoading={isLoading}
                    hasNodes={hasNodes && baseHasNodes}
                    selectedClusterId={effectiveClusterId}
                    clusterDataUnavailable={clusterDataUnavailable}
                    unavailableSummary={unavailableSummary}
                    unavailableCategory={unavailableCategory}
                    onRetry={handleRefresh}
                    viewportVersion={viewportVersion}
                    viewportKey={layoutViewportKey}
                    viewportMode={topologyViewMode}
                    onFitViewRef={fitViewRef}
                    onZoomInRef={zoomInRef}
                    onZoomOutRef={zoomOutRef}
                    isNodeDragging={isNodeDragging}
                  />
                </ReactFlowProvider>
              </div>
            </div>
          </section>

          {focusedNode ? (
            <NodeDetailPanel
              key={focusedNode.id}
              focusedNode={focusedNode}
              connections={connections}
              groupMembers={groupMembers}
              groupSummary={groupSummary}
              selectedGroupSection={selectedGroupSection}
              onSelectGroupSection={setSelectedGroupSection}
              anomalyDistribution={abnormalDistribution}
              onApplyQuickFilter={handleQuickFilter}
              activeQuickAction={activeQuickAction}
              currentResourceActionLabel={detailInteractionsDisabled ? null : currentResourceActionLabel}
              onOpenCurrentResource={() => {
                if (detailInteractionsDisabled) return;
                handleOpenCurrentResource();
              }}
              onOpenResourceDetail={() => {
                if (detailInteractionsDisabled) return;
                if (focusedResourceDetailRequest) {
                  setDetailRequest(focusedResourceDetailRequest);
                }
              }}
              isGroupExpanded={isFocusedGroupExpanded}
              onToggleGroup={() => {
                if (!focusedNodeId) return;
                setExpandedGroupIds((current) =>
                  (current.length > 0 ? current : effectiveExpandedGroupIds).includes(focusedNodeId)
                    ? (current.length > 0 ? current : effectiveExpandedGroupIds).filter((item) => item !== focusedNodeId)
                    : [...(current.length > 0 ? current : effectiveExpandedGroupIds), focusedNodeId],
                );
              }}
              onSelectConnection={(id) => {
                if (detailInteractionsDisabled) return;
                focusNodeById(id);
              }}
              onClear={() => {
                setSelectedGroupSection(null);
                setFocusedNodeId(null);
                setDetailRequest(null);
              }}
            />
          ) : null}
        </div>
        <ResourceDetailDrawer
          open={Boolean(detailRequest)}
          onClose={() => setDetailRequest(null)}
          token={token}
          request={detailRequest}
          width={1120}
          onNavigateRequest={(request) => setDetailRequest(request)}
        />
      </section>
      <style jsx global>{`
        .topology-facts-grid {
          margin-top: 10px;
          border: 1px solid var(--topology-overview-border);
          border-radius: 18px;
          overflow: hidden;
          background: var(--topology-detail-card);
        }

        .topology-facts-grid__row {
          display: grid;
          grid-template-columns: minmax(112px, 136px) minmax(0, 1fr);
        }

        .topology-facts-grid__row + .topology-facts-grid__row {
          border-top: 1px solid var(--topology-overview-border);
        }

        .topology-facts-grid__label {
          padding: 10px 12px;
          background: var(--topology-detail-muted-bg);
          color: var(--topology-overview-subtle);
          font-size: 12px;
          line-height: 1.4;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          border-right: 1px solid var(--topology-overview-border);
        }

        .topology-facts-grid__value {
          padding: 10px 12px;
          color: var(--topology-overview-text);
          font-size: 13px;
          line-height: 1.4;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .topology-current-resource-button {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          border: 1px solid var(--topology-jump-button-border);
          border-radius: 16px;
          padding: 8px 14px 8px 11px;
          background: var(--topology-jump-button-bg);
          color: var(--topology-jump-button-text);
          box-shadow: var(--topology-jump-button-shadow);
          transition:
            transform 160ms ease,
            box-shadow 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
          overflow: hidden;
          cursor: pointer;
        }

        .topology-current-resource-button:hover {
          transform: translateY(-1px);
          border-color: var(--topology-jump-button-border-hover);
          background: var(--topology-jump-button-bg-hover);
          box-shadow: var(--topology-jump-button-shadow-hover);
        }

        .topology-current-resource-button__halo {
          position: absolute;
          inset: 1px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(255,255,255,0.38), rgba(255,255,255,0));
          pointer-events: none;
        }

        .topology-current-resource-button__icon {
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 999px;
          background: var(--topology-jump-button-icon-bg);
          color: var(--topology-jump-button-icon);
          font-size: 13px;
          flex: 0 0 auto;
        }

        .topology-current-resource-button__content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          text-align: left;
        }

        .topology-current-resource-button__eyebrow {
          font-size: 11px;
          line-height: 1.1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--topology-jump-button-subtle);
        }

        .topology-current-resource-button__title {
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 13px;
          line-height: 1.2;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
