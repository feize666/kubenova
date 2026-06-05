"use client";

import "reactflow/dist/style.css";

import {
  BranchesOutlined,
  CheckOutlined,
  DownOutlined,
  FileTextOutlined,
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
import { Alert, Empty, Popover, Skeleton, Tooltip, Typography } from "antd";
import type { ButtonProps } from "antd";
import { useRouter } from "next/navigation";
import { forwardRef, memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  useStoreApi,
  getNodesBounds,
  getViewportForBounds,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "reactflow";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsFilterTriggerButton, OpsIconActionButton, OpsPopoverPanel } from "@/components/ops";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { RuntimeStatusPill } from "@/components/visual-system";
import { getClusters } from "@/lib/api/clusters";
import type { Cluster } from "@/lib/api/types";
import { getNetworkResources, type NetworkResource } from "@/lib/api/network";
import {
  getDynamicResourceDetail,
  getDynamicResources,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
  type ResourceIdentity,
} from "@/lib/api/resources";
import {
  getTopologyNamespaceSummaries,
  type TopologyNamespaceSummaryItem,
} from "@/lib/api/topology-summary";
import { getWorkloadsByKind, type WorkloadListItem } from "@/lib/api/workloads";

const { Text, Title } = Typography;

const CANVAS_BG = "var(--topology-overview-bg)";
const DEFAULT_VIEWPORT_MODE = "100%";
const MAX_ZOOM = 4;
const TOPOLOGY_QUERY_STALE_TIME_MS = 30_000;
const TOPOLOGY_QUERY_GC_TIME_MS = 60_000;
const TOPOLOGY_RESOURCE_QUERY_OPTIONS = {
  staleTime: TOPOLOGY_QUERY_STALE_TIME_MS,
  gcTime: TOPOLOGY_QUERY_GC_TIME_MS,
} as const;
const GATEWAY_DETAIL_CONCURRENCY = 4;
const LARGE_GRAPH_MINIMAP_NODE_LIMIT = 180;
const LARGE_GRAPH_MINIMAP_EDGE_LIMIT = 280;
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const;
const TOPO_EDGE_TYPES: Record<string, never> = {};
const handleTopologyReactFlowError = (id: string, message: string) => {
  // React Flow 11 emits dev-only 002 during Next/React dev remounts even with stable type maps.
  if (id === "002") return;
  console.error(message);
};

function scheduleTopologyWork(task: () => void, timeout = 700) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(task, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, 32);
  return () => window.clearTimeout(id);
}

function TopologyReactFlowErrorHandler({ children }: { children: ReactNode }) {
  const store = useStoreApi();
  if (store.getState().onError !== handleTopologyReactFlowError) {
    store.setState({ onError: handleTopologyReactFlowError });
  }
  return <>{children}</>;
}

const TopologyFilterPill = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  Omit<ButtonProps, "icon" | "value"> & {
    label: ReactNode;
    value: ReactNode;
    icon: ReactNode;
    meta?: ReactNode;
    active?: boolean;
    wide?: boolean;
    warning?: boolean;
    toggle?: boolean;
  }
>(function TopologyFilterPill({
  label,
  value,
  icon,
  meta,
  active,
  wide,
  warning,
  toggle,
  style,
  className,
  ...props
}, ref) {
  return (
    <OpsFilterTriggerButton
      {...props}
      ref={ref}
      baseClassName="topology-filter-pill"
      className={[
        toggle ? "topology-filter-pill--toggle" : "topology-filter-pill--interactive",
        wide ? "topology-filter-pill--wide" : undefined,
        className,
      ].filter(Boolean).join(" ")}
      active={active}
      icon={icon}
      label={label}
      labelSuffix=""
      meta={meta}
      slotClassNames={{
        lead: "topology-filter-pill__lead",
        icon: ["topology-filter-pill__icon", warning ? "topology-filter-pill__icon--warning" : undefined]
          .filter(Boolean)
          .join(" "),
        copy: "topology-filter-pill__content",
        label: "topology-filter-pill__label",
        valueWrap: "topology-filter-pill__content-value",
        value: "topology-filter-pill__value",
        affordance: "topology-filter-pill__meta",
        caret: "topology-filter-pill__arrow",
        meta: "topology-filter-pill__meta-content",
      }}
      style={style}
      value={value}
    />
  );
});

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
  networkpolicy: {
    border: "#0891b2",
    borderAlpha: "rgba(8,145,178,0.38)",
    bg: "#ecfeff",
    text: "#155e75",
    tag: "#0891b2",
    icon: "◍",
    label: "NetworkPolicy",
  },
  gatewayclass: {
    border: "#7c3aed",
    borderAlpha: "rgba(124,58,237,0.38)",
    bg: "#f5f3ff",
    text: "#6d28d9",
    tag: "#7c3aed",
    icon: "◇",
    label: "GatewayClass",
  },
  gateway: {
    border: "#0d9488",
    borderAlpha: "rgba(13,148,136,0.38)",
    bg: "#f0fdfa",
    text: "#0f766e",
    tag: "#0d9488",
    icon: "◆",
    label: "Gateway",
  },
  httproute: {
    border: "#2563eb",
    borderAlpha: "rgba(37,99,235,0.38)",
    bg: "#eff6ff",
    text: "#1d4ed8",
    tag: "#2563eb",
    icon: "⇆",
    label: "HTTPRoute",
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
  "networkpolicy",
  "gatewayclass",
  "gateway",
  "httproute",
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
  "gatewayclass",
  "gateway",
  "httproute",
  "service",
  "ingress",
  "ingressroute",
  "endpoints",
  "endpointslice",
  "networkpolicy",
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
  "networkpolicy",
  "gatewayclass",
  "gateway",
  "httproute",
]);
const WORKLOAD_STACK_KEYS = new Set<TokenKey>(["deployment", "statefulset", "daemonset"]);

interface TopoNodeData {
  label: string;
  typeLabel: string;
  tokenKey: TokenKey;
  status?: "Running" | "Pending" | "Failed" | "Unknown";
  replicas?: string;
  caption?: string;
  raw?: unknown;
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

const NODE_W = 220;
const NODE_H = 78;
const NODE_MAX_W = 320;
const NODE_LABEL_CHAR_W = 7.2;
const NODE_LABEL_LINE_H = 17.5;
const ADAPTIVE_NAME_TOKENS = new Set<TokenKey>(["pod", "endpointslice"]);
type TopologyEdgeRole =
  | "scope"
  | "relation"
  | "owner"
  | "selector"
  | "service-endpoint"
  | "gateway-route"
  | "network-policy"
  | "group";
type TopologyEdgeData = {
  topologyRole?: TopologyEdgeRole;
  topologyLabel?: string;
};
const EDGE_MARKER_COLOR = "rgba(100, 116, 139, 0.66)";
const EDGE_LABEL_STYLE: React.CSSProperties = {
  fill: "#475569",
  fontSize: 10,
  fontWeight: 500,
  opacity: 0.66,
};
const EDGE_LABEL_BG_STYLE: React.CSSProperties = {
  fill: "rgba(255, 255, 255, 0.86)",
  stroke: "rgba(203, 213, 225, 0.56)",
  strokeWidth: 0.5,
};
const EDGE_ROLE_LABEL: Record<TopologyEdgeRole, string | undefined> = {
  scope: undefined,
  relation: undefined,
  owner: "owns",
  selector: "selects",
  "service-endpoint": "endpoints",
  "gateway-route": "routes",
  "network-policy": "policy",
  group: undefined,
};

type TopologyResourceDetailRequest = {
  kind: string;
  id: string;
  label?: string;
  clusterId?: string;
  group?: string;
  version?: string;
  resource?: string;
  namespace?: string;
  name?: string;
  apiVersion?: string;
  kindLabel?: string;
  snapshot?: {
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
    labels?: Record<string, string>;
  };
};
type TopologyYamlTarget = {
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
};
type TopologyFailureCategory = "service-unavailable" | "network-timeout" | "auth" | "unknown";
type GatewayKindKey = "gatewayclass" | "gateway" | "httproute";
type GatewayTopologyResource = DynamicResourceItem & {
  kind: "GatewayClass" | "Gateway" | "HTTPRoute";
  group: "gateway.networking.k8s.io";
  version: "v1";
  resource: "gatewayclasses" | "gateways" | "httproutes";
  spec?: Record<string, unknown>;
  statusJson?: Record<string, unknown>;
};
type GatewayTopologyResult = {
  items: GatewayTopologyResource[];
  unavailableKinds: Array<"GatewayClass" | "Gateway" | "HTTPRoute">;
};

const GATEWAY_TOPOLOGY_META: Record<
  GatewayKindKey,
  { kind: "GatewayClass" | "Gateway" | "HTTPRoute"; resource: "gatewayclasses" | "gateways" | "httproutes"; tokenKey: SourceKey }
> = {
  gatewayclass: {
    kind: "GatewayClass",
    resource: "gatewayclasses",
    tokenKey: "gatewayclass",
  },
  gateway: {
    kind: "Gateway",
    resource: "gateways",
    tokenKey: "gateway",
  },
  httproute: {
    kind: "HTTPRoute",
    resource: "httproutes",
    tokenKey: "httproute",
  },
};

const GATEWAY_TOPOLOGY_KINDS = Object.keys(GATEWAY_TOPOLOGY_META) as GatewayKindKey[];
const GATEWAY_DETAIL_TOPOLOGY_KINDS = new Set<GatewayTopologyResource["kind"]>(["Gateway", "HTTPRoute"]);
const GATEWAY_TOKEN_BY_KIND: Partial<Record<string, SourceKey>> = {
  GatewayClass: "gatewayclass",
  Gateway: "gateway",
  HTTPRoute: "httproute",
};
const EMPTY_TOPOLOGY_NAMESPACE_SUMMARIES: TopologyNamespaceSummaryItem[] = [];
const EMPTY_CLUSTERS: Cluster[] = [];
const EMPTY_NETWORK_RESOURCES: NetworkResource[] = [];
const EMPTY_GATEWAY_TOPOLOGY_RESOURCES: GatewayTopologyResource[] = [];
const EMPTY_GATEWAY_UNAVAILABLE_KINDS: GatewayTopologyResult["unavailableKinds"] = [];
const EMPTY_WORKLOAD_ITEMS: WorkloadListItem[] = [];

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
      description: "拓扑数据暂时不可用，请稍后重试。",
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
    description: "无法获取当前集群拓扑数据，请稍后重试。",
  };
}

function resolveNetworkTokenKey(kind: string): SourceKey {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "ingressroute") return "ingressroute";
  if (normalized === "ingress") return "ingress";
  if (normalized === "endpoints") return "endpoints";
  if (normalized === "endpointslice") return "endpointslice";
  if (normalized === "networkpolicy") return "networkpolicy";
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

function incrementSourceCount(counts: Map<SourceKey, number>, key: SourceKey, count = 1) {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

const RESOURCE_DOMAIN_META: Record<
  ResourceDomainKey,
  { label: string; shortLabel: string; icon: React.ReactNode; keys: SourceKey[] }
> = {
  network: {
    label: "网络资源域",
    shortLabel: "网络域",
    icon: <RadarChartOutlined />,
    keys: [
      "service",
      "ingress",
      "ingressroute",
      "endpoints",
      "endpointslice",
      "networkpolicy",
      "gatewayclass",
      "gateway",
      "httproute",
    ],
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
  const {
    className: overrideClassName,
    data: overrideData,
    label: overrideLabel,
    labelBgBorderRadius: overrideLabelBgBorderRadius,
    labelBgPadding: overrideLabelBgPadding,
    labelBgStyle: overrideLabelBgStyle,
    labelStyle: overrideLabelStyle,
    markerEnd: overrideMarkerEnd,
    style: overrideStyle,
    ...restOverrides
  } = overrides;
  const role: TopologyEdgeRole = overrideData?.topologyRole ?? "relation";
  const topologyLabel = overrideData?.topologyLabel ?? EDGE_ROLE_LABEL[role];
  const label = overrideLabel ?? topologyLabel;
  const data: TopologyEdgeData = {
    topologyRole: role,
    ...(topologyLabel ? { topologyLabel } : {}),
    ...(overrideData ?? {}),
  };
  const className = ["topology-flow-edge", `topology-flow-edge--${role}`, overrideClassName]
    .filter(Boolean)
    .join(" ");
  const hasMarkerOverride = Object.prototype.hasOwnProperty.call(overrides, "markerEnd");
  const style =
    overrideStyle
      ? {
          ...EDGE_STYLE,
          ...overrideStyle,
        }
      : EDGE_STYLE;

  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    animated: false,
    className,
    style,
    data,
    label,
    labelShowBg: Boolean(label),
    labelStyle: label ? { ...EDGE_LABEL_STYLE, ...(overrideLabelStyle ?? {}) } : overrideLabelStyle,
    labelBgStyle: label ? { ...EDGE_LABEL_BG_STYLE, ...(overrideLabelBgStyle ?? {}) } : overrideLabelBgStyle,
    labelBgPadding: label ? [5, 2] : overrideLabelBgPadding,
    labelBgBorderRadius: label ? 4 : overrideLabelBgBorderRadius,
    markerEnd: hasMarkerOverride
      ? overrideMarkerEnd
      : {
          type: MarkerType.ArrowClosed,
          color: EDGE_MARKER_COLOR,
          width: 12,
          height: 12,
        },
    ...restOverrides,
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

const DYNAMIC_RESOURCE_BY_TOKEN: Partial<
  Record<TokenKey, { group: string; version: string; resource: string; kindLabel: string }>
> = {
  namespace: { group: "", version: "v1", resource: "namespaces", kindLabel: "Namespace" },
  service: { group: "", version: "v1", resource: "services", kindLabel: "Service" },
  ingress: { group: "networking.k8s.io", version: "v1", resource: "ingresses", kindLabel: "Ingress" },
  ingressroute: { group: "traefik.io", version: "v1alpha1", resource: "ingressroutes", kindLabel: "IngressRoute" },
  endpoints: { group: "", version: "v1", resource: "endpoints", kindLabel: "Endpoints" },
  endpointslice: { group: "discovery.k8s.io", version: "v1", resource: "endpointslices", kindLabel: "EndpointSlice" },
  networkpolicy: { group: "networking.k8s.io", version: "v1", resource: "networkpolicies", kindLabel: "NetworkPolicy" },
  gatewayclass: { group: "gateway.networking.k8s.io", version: "v1", resource: "gatewayclasses", kindLabel: "GatewayClass" },
  gateway: { group: "gateway.networking.k8s.io", version: "v1", resource: "gateways", kindLabel: "Gateway" },
  httproute: { group: "gateway.networking.k8s.io", version: "v1", resource: "httproutes", kindLabel: "HTTPRoute" },
  deployment: { group: "apps", version: "v1", resource: "deployments", kindLabel: "Deployment" },
  statefulset: { group: "apps", version: "v1", resource: "statefulsets", kindLabel: "StatefulSet" },
  daemonset: { group: "apps", version: "v1", resource: "daemonsets", kindLabel: "DaemonSet" },
  pod: { group: "", version: "v1", resource: "pods", kindLabel: "Pod" },
};

function getStringField(raw: Record<string, unknown> | undefined, key: string): string {
  const value = raw?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function keepNonEmptyRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(record).length > 0 ? record : undefined;
}

function parseApiVersion(value: string): { group: string; version: string } | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!normalized.includes("/")) return { group: "", version: normalized };
  const [group, version] = normalized.split("/");
  return version ? { group, version } : null;
}

function buildTopologySnapshot(raw: Record<string, unknown> | undefined): TopologyResourceDetailRequest["snapshot"] {
  if (!raw) return undefined;
  const labels = toStringRecord(raw.labels ?? toObject(raw.metadata).labels);
  const spec = keepNonEmptyRecord(toObject(raw.spec));
  const status =
    keepNonEmptyRecord(toObject(raw.statusJson)) ??
    keepNonEmptyRecord(toObject(raw.status)) ??
    keepNonEmptyRecord(
      Object.fromEntries(
        [
          "state",
          "status",
          "phase",
          "podPhase",
          "replicas",
          "readyReplicas",
          "availableReplicas",
          "updatedReplicas",
          "createdAt",
          "creationTimestamp",
          "updatedAt",
          "podCount",
          "readyPods",
          "pendingPods",
          "networkCount",
          "workloadCount",
          "podReplicaCount",
          "controller",
          "nodeName",
          "selector",
          "ownerRefs",
          "restarts",
        ]
          .map((key) => [key, raw[key]])
          .filter((entry): entry is [string, unknown] => entry[1] !== undefined && entry[1] !== null && entry[1] !== ""),
      ),
    );
  if (!spec && !status && Object.keys(labels).length === 0) return undefined;
  return {
    spec,
    status,
    labels: Object.keys(labels).length > 0 ? labels : undefined,
  };
}

function resolveDynamicDetailParts(
  nodeData: TopoNodeData,
  raw: Record<string, unknown> | undefined,
): Omit<TopologyResourceDetailRequest, "kind" | "id" | "snapshot" | "label"> | null {
  const mapped = DYNAMIC_RESOURCE_BY_TOKEN[nodeData.tokenKey];
  if (!mapped) return null;
  const clusterId = getStringField(raw, "clusterId");
  const name = getStringField(raw, "name") || nodeData.label.trim();
  if (!clusterId || !name) return null;
  const apiVersion = getStringField(raw, "apiVersion");
  const parsedApiVersion = parseApiVersion(apiVersion);
  const group = getStringField(raw, "group") || parsedApiVersion?.group || mapped.group;
  const version = getStringField(raw, "version") || parsedApiVersion?.version || mapped.version;
  const resource = getStringField(raw, "resource") || mapped.resource;
  const kindLabel = getStringField(raw, "kind") || mapped.kindLabel;
  if (!version || !resource) return null;
  const namespace =
    nodeData.tokenKey === "namespace" || !getStringField(raw, "namespace")
      ? ""
      : getStringField(raw, "namespace");
  return {
    clusterId,
    group,
    version,
    resource,
    namespace,
    name,
    apiVersion: apiVersion || (group ? `${group}/${version}` : version),
    kindLabel,
  };
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
  const projectedSelector = toObject(workload.selector);
  const projectedMatchLabels = toStringRecord(projectedSelector.matchLabels);
  if (Object.keys(projectedMatchLabels).length > 0) return projectedMatchLabels;
  const projectedLabels = toStringRecord(projectedSelector);
  if (Object.keys(projectedLabels).length > 0) return projectedLabels;
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

function extractNetworkPolicyPodSelector(resource: NetworkResource): Record<string, string> {
  const podSelector = toObject(toObject(resource.spec).podSelector);
  return toStringRecord(podSelector.matchLabels);
}

function networkPolicySelectsAllPods(resource: NetworkResource): boolean {
  const spec = toObject(resource.spec);
  if (!Object.prototype.hasOwnProperty.call(spec, "podSelector")) return false;
  const podSelector = toObject(spec.podSelector);
  const matchLabels = toStringRecord(podSelector.matchLabels);
  return Object.keys(matchLabels).length === 0 && toArray(podSelector.matchExpressions).length === 0;
}

function extractNetworkPolicyPeerSelectors(resource: NetworkResource): Record<string, string>[] {
  const spec = toObject(resource.spec);
  const selectors: Record<string, string>[] = [];
  const collectPeers = (peers: unknown[]) => {
    peers.forEach((peer) => {
      const podSelector = toObject(toObject(peer).podSelector);
      const matchLabels = toStringRecord(podSelector.matchLabels);
      if (Object.keys(matchLabels).length > 0) selectors.push(matchLabels);
    });
  };

  toArray(spec.ingress).forEach((rule) => collectPeers(toArray(toObject(rule).from)));
  toArray(spec.egress).forEach((rule) => collectPeers(toArray(toObject(rule).to)));
  return selectors;
}

function extractGatewayClassName(resource: GatewayTopologyResource): string | undefined {
  return toStringValue(toObject(resource.spec).gatewayClassName);
}

function extractHttpRouteGatewayRefs(resource: GatewayTopologyResource): string[] {
  const refs = new Set<string>();
  for (const parentRef of toArray(toObject(resource.spec).parentRefs)) {
    const parent = toObject(parentRef);
    const kind = toStringValue(parent.kind) ?? "Gateway";
    if (kind !== "Gateway") continue;
    const name = toStringValue(parent.name);
    if (!name) continue;
    const namespace = toStringValue(parent.namespace) ?? resource.namespace;
    refs.add(`${namespace}/${name}`);
  }
  return Array.from(refs);
}

function extractHttpRouteBackendRefs(resource: GatewayTopologyResource): string[] {
  const refs = new Set<string>();
  for (const rule of toArray(toObject(resource.spec).rules)) {
    for (const backendRef of toArray(toObject(rule).backendRefs)) {
      const backend = toObject(backendRef);
      const kind = toStringValue(backend.kind) ?? "Service";
      if (kind !== "Service") continue;
      const name = toStringValue(backend.name);
      if (!name) continue;
      const namespace = toStringValue(backend.namespace) ?? resource.namespace;
      refs.add(`${namespace}/${name}`);
    }
  }
  return Array.from(refs);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

async function getGatewayTopologyResources(
  clusterId: string,
  token: string,
  options: { signal?: AbortSignal; includeDetails?: boolean; namespace?: string } = {},
): Promise<GatewayTopologyResult> {
  const { signal, includeDetails = true, namespace } = options;
  const lists = await Promise.all(
    GATEWAY_TOPOLOGY_KINDS.map(async (kindKey) => {
      const meta = GATEWAY_TOPOLOGY_META[kindKey];
      const scopedNamespace = meta.kind === "GatewayClass" ? undefined : namespace;
      try {
        const list = await getDynamicResources(
          {
            clusterId,
            group: "gateway.networking.k8s.io",
            version: "v1",
            resource: meta.resource,
            namespace: scopedNamespace,
            pageSize: 200,
            missingAsEmpty: true,
          },
          token,
          { signal },
        );
        return {
          items: list.items.map((item) => ({
            ...item,
            kind: meta.kind,
            group: "gateway.networking.k8s.io" as const,
            version: "v1" as const,
            resource: meta.resource,
          })),
          unavailableKind: null,
        };
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) {
          throw err;
        }
        return {
          items: [],
          unavailableKind: meta.kind,
        };
      }
    }),
  );

  const items = lists.flatMap((list) => list.items);
  const unavailableKinds = lists
    .map((list) => list.unavailableKind)
    .filter((kind): kind is "GatewayClass" | "Gateway" | "HTTPRoute" => Boolean(kind));
  if (!includeDetails) {
    return {
      items,
      unavailableKinds,
    };
  }
  const withDetails = await mapWithConcurrency(
    items,
    GATEWAY_DETAIL_CONCURRENCY,
    async (item): Promise<GatewayTopologyResource> => {
      if (!GATEWAY_DETAIL_TOPOLOGY_KINDS.has(item.kind)) {
        return item;
      }
      try {
        const detail = await getDynamicResourceDetail(
          {
            clusterId: item.clusterId,
            group: item.group,
            version: item.version,
            resource: item.resource,
            namespace: item.namespace || undefined,
            name: item.name,
          },
          token,
          { signal },
        );
        const raw = toObject(detail.raw);
        return {
          ...item,
          spec: toObject(raw.spec),
          statusJson: toObject(raw.status),
          labels: Object.keys(item.labels ?? {}).length > 0 ? item.labels : toStringRecord(toObject(raw.metadata).labels),
        };
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) {
          throw err;
        }
        return item;
      }
    },
  );

  return {
    items: withDetails,
    unavailableKinds,
  };
}

function controllerOwnsPodName(controller: WorkloadListItem, podName: string): boolean {
  const normalizedPodName = podName.trim();
  if (!normalizedPodName) return false;
  if (normalizedPodName === controller.name) return true;
  if (!normalizedPodName.startsWith(`${controller.name}-`)) return false;
  return true;
}

function resolvePodStatus(pod: WorkloadListItem): TopoNodeData["status"] {
  const phase = String(pod.podPhase ?? pod.statusJson?.phase ?? pod.status ?? "").trim();
  if (phase === "Running") return "Running";
  if (phase === "Failed") return "Failed";
  if (phase === "Pending") return "Pending";
  return "Unknown";
}

function resolveResourceDetailRequest(node: Node<TopoNodeData> | null): TopologyResourceDetailRequest | null {
  if (!node) return null;
  if (node.data.tokenKey === "instancegroup" || node.data.tokenKey === "node") {
    return null;
  }

  const raw =
    (node.data.raw as
      | {
          id?: unknown;
          kind?: unknown;
          clusterId?: unknown;
          group?: unknown;
          version?: unknown;
          resource?: unknown;
          namespace?: unknown;
          name?: unknown;
          apiVersion?: unknown;
          spec?: unknown;
          status?: unknown;
          statusJson?: unknown;
          labels?: unknown;
        }
      | undefined) ?? undefined;
  const rawRecord = raw as Record<string, unknown> | undefined;
  const snapshot = buildTopologySnapshot(rawRecord);
  const dynamicParts = resolveDynamicDetailParts(node.data, rawRecord);
  if (dynamicParts) {
    return {
      ...dynamicParts,
      id: [
        "dynamic",
        dynamicParts.clusterId,
        dynamicParts.group ?? "",
        dynamicParts.version ?? "",
        dynamicParts.resource ?? "",
        dynamicParts.namespace ?? "",
        dynamicParts.name,
      ].join(":"),
      kind: "dynamic",
      label: node.data.label,
      snapshot,
    };
  }
  const rawId = typeof raw?.id === "string" ? raw.id.trim() : "";
  const dynamicId =
    raw?.group && raw?.version && raw?.resource && raw?.clusterId && raw?.name
      ? [
          "dynamic",
          String(raw.clusterId),
          String(raw.group),
          String(raw.version),
          String(raw.resource),
          typeof raw.namespace === "string" ? raw.namespace : "",
          String(raw.name),
        ].join(":")
      : "";
  const id = dynamicId || rawId;
  const kind = dynamicId ? "dynamic" : typeof raw?.kind === "string" ? raw.kind.trim() : "";
  if (!id || !kind) return null;
  return {
    id,
    kind,
    label: node.data.label,
    snapshot,
  };
}

function resolveResourceYamlTarget(node: Node<TopoNodeData> | null): TopologyYamlTarget | null {
  const request = resolveResourceDetailRequest(node);
  if (!request) return null;
  const raw =
    (node?.data.raw as
      | {
          clusterId?: unknown;
          group?: unknown;
          version?: unknown;
          resource?: unknown;
          namespace?: unknown;
          name?: unknown;
          kind?: unknown;
        }
      | undefined) ?? undefined;
  if (request.kind === "dynamic") {
    const parts = request.id.split(":");
    if (parts.length < 7 || parts[0] !== "dynamic") return null;
    const dynamicIdentity: DynamicResourceIdentity = {
      clusterId: parts[1] ?? "",
      group: parts[2] ?? "",
      version: parts[3] ?? "",
      resource: parts[4] ?? "",
      namespace: parts[5] || undefined,
      name: parts.slice(6).join(":"),
    };
    return {
      identity: {
        clusterId: dynamicIdentity.clusterId,
        namespace: dynamicIdentity.namespace ?? "",
        kind: dynamicIdentity.resource,
        name: dynamicIdentity.name,
      },
      dynamicIdentity,
    };
  }
  const clusterId = typeof raw?.clusterId === "string" ? raw.clusterId.trim() : "";
  const namespace = typeof raw?.namespace === "string" ? raw.namespace.trim() : "";
  const kind = typeof raw?.kind === "string" ? raw.kind.trim() : request.kind;
  const name = typeof raw?.name === "string" ? raw.name.trim() : request.label ?? "";
  if (!clusterId || !kind || !name) return null;
  return {
    identity: {
      clusterId,
      namespace,
      kind,
      name,
    },
  };
}

function isGroupTokenKey(tokenKey: TokenKey): boolean {
  return tokenKey === "namespace" || tokenKey === "instancegroup" || tokenKey === "node";
}

type TopologyNodeSize = {
  width: number;
  height: number;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countDisplayUnits(value: string): number {
  return Array.from(value).reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 1.5 : 1), 0);
}

function estimateLabelLines(label: string, width: number, tokenKey: TokenKey): number {
  const maxLines = ADAPTIVE_NAME_TOKENS.has(tokenKey) ? 4 : tokenKey === "namespace" ? 3 : 2;
  const contentWidth = Math.max(72, width - 28);
  const charsPerLine = Math.max(8, Math.floor(contentWidth / NODE_LABEL_CHAR_W));
  return clampNumber(Math.ceil(countDisplayUnits(label) / charsPerLine), 1, maxLines);
}

function estimateNodeSizeFromData(data: TopoNodeData): TopologyNodeSize {
  const raw = data.raw as {
    layoutLane?: unknown;
    layoutGroupPanel?: unknown;
    layoutWidth?: unknown;
    layoutHeight?: unknown;
    networkCount?: unknown;
    workloadCount?: unknown;
    podReplicaCount?: unknown;
    caption?: unknown;
  } | undefined;

  if (raw?.layoutLane === true || raw?.layoutGroupPanel === true) {
    return {
      width: typeof raw.layoutWidth === "number" ? raw.layoutWidth : NODE_W,
      height: typeof raw.layoutHeight === "number" ? raw.layoutHeight : NODE_H,
    };
  }

  const labelUnits = countDisplayUnits(data.label);
  const isNamespace = data.tokenKey === "namespace";
  const isGroup = isGroupTokenKey(data.tokenKey);
  const isAdaptiveName = ADAPTIVE_NAME_TOKENS.has(data.tokenKey);
  const minWidth = isNamespace ? 278 : isGroup ? 184 : isAdaptiveName ? 206 : NODE_W;
  const maxWidth = isNamespace ? 360 : isGroup ? 292 : isAdaptiveName ? NODE_MAX_W : 280;
  const width = clampNumber(minWidth + Math.max(0, labelUnits - 18) * (isAdaptiveName ? 5.8 : 4.8), minWidth, maxWidth);
  const labelLines = estimateLabelLines(data.label, width, data.tokenKey);

  let height = NODE_H + Math.max(0, labelLines - 1) * NODE_LABEL_LINE_H;
  if (isNamespace) {
    height = 138 + Math.max(0, labelLines - 2) * NODE_LABEL_LINE_H;
    if (typeof raw?.networkCount === "number" || typeof raw?.workloadCount === "number" || typeof raw?.podReplicaCount === "number") {
      height += 8;
    }
  } else if (data.tokenKey === "cluster" || data.tokenKey === "instancegroup" || data.tokenKey === "node") {
    height = 96 + Math.max(0, labelLines - 1) * NODE_LABEL_LINE_H;
  }

  if (!isNamespace && typeof data.status === "string") height += 22;
  if (!isNamespace && typeof data.replicas === "string") height += 8;
  if (typeof data.caption === "string" && data.caption.trim()) height += 18;
  if (typeof raw?.caption === "string" && raw.caption.trim()) height += 8;

  return {
    width,
    height: Math.max(NODE_H, Math.ceil(height)),
  };
}

function getEstimatedNodeSize(node: Node<TopoNodeData>): TopologyNodeSize {
  return estimateNodeSizeFromData(node.data);
}

function getNodeWidth(node: Node<TopoNodeData>): number {
  return typeof node.width === "number" ? node.width : getEstimatedNodeSize(node).width;
}

function getNodeHeight(node: Node<TopoNodeData>): number {
  return typeof node.height === "number" ? node.height : getEstimatedNodeSize(node).height;
}

function withEstimatedNodeSize(node: Node<TopoNodeData>): Node<TopoNodeData> {
  const size = getEstimatedNodeSize(node);
  return {
    ...node,
    width: size.width,
    height: size.height,
  };
}

function middleEllipsize(value: string, maxUnits: number): string {
  if (countDisplayUnits(value) <= maxUnits) return value;
  const chars = Array.from(value);
  const keepUnits = Math.max(8, Math.floor((maxUnits - 1) / 2));
  let head = "";
  let tail = "";
  let headUnits = 0;
  let tailUnits = 0;
  for (const char of chars) {
    const units = char.charCodeAt(0) > 255 ? 1.5 : 1;
    if (headUnits + units > keepUnits) break;
    head += char;
    headUnits += units;
  }
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    const units = char.charCodeAt(0) > 255 ? 1.5 : 1;
    if (tailUnits + units > keepUnits) break;
    tail = `${char}${tail}`;
    tailUnits += units;
  }
  return `${head}...${tail}`;
}

function applyDagreLayout(
  nodes: Node<TopoNodeData>[],
  edges: Edge[],
  options?: { nodesep?: number; ranksep?: number; marginx?: number; marginy?: number; rankdir?: "LR" | "TB" },
): Node<TopoNodeData>[] {
  const sizedNodes = nodes.map(withEstimatedNodeSize);
  const nodeIds = new Set(sizedNodes.map((node) => node.id));
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options?.rankdir ?? "LR",
    nodesep: options?.nodesep ?? 60,
    ranksep: options?.ranksep ?? 146,
    marginx: options?.marginx ?? 84,
    marginy: options?.marginy ?? 78,
  });

  sizedNodes.forEach((node) => graph.setNode(node.id, { width: getNodeWidth(node), height: getNodeHeight(node) }));
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  });
  dagre.layout(graph);

  return sizedNodes.map((node) => {
    const position = graph.node(node.id);
    const width = getNodeWidth(node);
    const height = getNodeHeight(node);
    return {
      ...node,
      position: { x: position.x - width / 2, y: position.y - height / 2 },
    };
  });
}

type ComponentLayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  hasSemanticEdges: boolean;
};

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

    members.forEach((member) => graph.setNode(member.id, { width: getNodeWidth(member), height: getNodeHeight(member) }));
    semanticEdges.forEach((edge) => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    members.forEach((member) => {
      const position = graph.node(member.id);
      if (!position) return;
      const width = getNodeWidth(member);
      const height = getNodeHeight(member);
      const x = position.x - width / 2;
      const y = position.y - height / 2;
      positions.set(member.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
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
  const rows = Math.max(1, Math.ceil(members.length / columns));
  const columnWidths = Array.from({ length: columns }, (_, col) =>
    Math.max(...members.filter((_, index) => index % columns === col).map((member) => getNodeWidth(member)), 0),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...members.filter((_, index) => Math.floor(index / columns) === row).map((member) => getNodeHeight(member)), 0),
  );
  const columnOffsets = columnWidths.reduce<number[]>((offsets, width, index) => {
    offsets.push(index === 0 ? 0 : offsets[index - 1] + columnWidths[index - 1] + gapX);
    return offsets;
  }, []);
  const rowOffsets = rowHeights.reduce<number[]>((offsets, height, index) => {
    offsets.push(index === 0 ? 0 : offsets[index - 1] + rowHeights[index - 1] + gapY);
    return offsets;
  }, []);

  members.forEach((member, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    positions.set(member.id, {
      x: paddingX + columnOffsets[col],
      y: paddingY + rowOffsets[row],
    });
  });

  return {
    positions,
    width: paddingX * 2 + columnWidths.reduce((total, width) => total + width, 0) + Math.max(0, columns - 1) * gapX,
    height: paddingY * 2 + rowHeights.reduce((total, height) => total + height, 0) + Math.max(0, rows - 1) * gapY,
    hasSemanticEdges,
  };
}

const EDGE_STYLE: React.CSSProperties = {
  stroke: "var(--topology-overview-edge)",
  strokeWidth: 1.28,
  opacity: 0.66,
};

function sumResourceCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function addSummaryResourceCounts(counts: Map<SourceKey, number>, summary: TopologyNamespaceSummaryItem): void {
  Object.entries(summary.resourceCounts).forEach(([kind, value]) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const gatewayToken = GATEWAY_TOKEN_BY_KIND[kind];
    if (gatewayToken) {
      incrementSourceCount(counts, gatewayToken, value);
      return;
    }
    if (kind === "Deployment") {
      incrementSourceCount(counts, "deployment", value);
      return;
    }
    if (kind === "StatefulSet") {
      incrementSourceCount(counts, "statefulset", value);
      return;
    }
    if (kind === "DaemonSet") {
      incrementSourceCount(counts, "daemonset", value);
      return;
    }
    if (kind === "Pod") {
      incrementSourceCount(counts, "pod", value);
      return;
    }
    const networkToken = resolveNetworkTokenKey(kind);
    if (networkToken !== "networkpolicy" || kind === "NetworkPolicy") {
      incrementSourceCount(counts, networkToken, value);
    }
  });
}

function buildNamespaceSummaryGraph(
  clusterName: string,
  clusterId: string,
  summaries: TopologyNamespaceSummaryItem[],
): { nodes: Node<TopoNodeData>[]; edges: Edge[] } {
  const nodes: Node<TopoNodeData>[] = [
    {
      id: `cluster-${clusterId}`,
      type: "topo",
      position: { x: 0, y: 0 },
      data: {
        label: clusterName,
        typeLabel: "cluster",
        tokenKey: "cluster",
      },
    },
  ];
  const edges: Edge[] = [];
  const activeSummaries = summaries.length > 0 ? summaries : [];

  activeSummaries.forEach((summary) => {
    const namespace = summary.namespace?.trim() || "cluster-scope";
    const namespaceId = `ns-${namespace}`;
    const resourceCount = sumResourceCounts(summary.resourceCounts);
    const readyReplicaCount = Math.max((summary.podCount || 0) - (summary.abnormalCount || 0), 0);
    const pendingReplicaCount = Math.max(summary.abnormalCount || 0, 0);
    nodes.push({
      id: namespaceId,
      type: "topo",
      position: { x: 0, y: 0 },
      data: {
        label: namespace,
        typeLabel: "namespace",
        tokenKey: "namespace",
        caption: "scope boundary",
        raw: {
          namespace,
          clusterId,
          kind: "Namespace",
          name: namespace,
          podCount: resourceCount,
          readyPods: readyReplicaCount,
          pendingPods: pendingReplicaCount,
          networkCount: summary.networkCount + summary.gatewayCount,
          workloadCount: summary.workloadCount,
          podReplicaCount: summary.podCount,
          resourceCounts: summary.resourceCounts,
          statusCounts: summary.statusCounts,
          abnormalCount: summary.abnormalCount,
          mode: "namespace",
        },
      },
    });
    edges.push(
      buildEdge(`cluster-${clusterId}`, namespaceId, {
        style: {
          strokeWidth: 1.06,
          opacity: 0.34,
        },
        data: { topologyRole: "scope" },
        markerEnd: undefined,
      }),
    );
  });

  return { nodes, edges };
}

function buildFlowGraph(
  clusterName: string,
  clusterId: string,
  networkResources: NetworkResource[],
  gatewayResources: GatewayTopologyResource[],
  deployments: WorkloadListItem[],
  statefulsets: WorkloadListItem[],
  daemonsets: WorkloadListItem[],
  pods: WorkloadListItem[],
  groupMode: GroupMode,
  options: { namespaceOverviewOnly?: boolean } = {},
): { nodes: Node<TopoNodeData>[]; edges: Edge[] } {
  const activeNetwork = networkResources.filter((item) => item.state !== "deleted");
  const activeGateways = gatewayResources.filter((item) => item.state !== "deleted");
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
  const activePods = pods.filter((item) => item.state !== "deleted");

  const namespaces = Array.from(
    new Set([
      ...activeNetwork.map((item) => item.namespace),
      ...activeGateways.map((item) => item.namespace).filter(Boolean),
      ...controllers.map((item) => item.namespace),
      ...activePods.map((item) => item.namespace),
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
  const gatewayNodeIdByNamespaceName = new Map<string, string>();
  const gatewayClassNodeIdByName = new Map<string, string>();
  const gatewayNodeIdByResourceId = new Map<string, string>();
  const controllerNodeIdById = new Map<string, string>();
  const controllersByNamespace = new Map<string, WorkloadListItem[]>();
  const podNodeIdByNamespaceName = new Map<string, string>();
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
    const namespaceGateway = activeGateways.filter((item) => item.namespace === namespace);
    const namespaceControllers = controllers.filter((item) => item.namespace === namespace);
    const namespacePods = activePods.filter((item) => item.namespace === namespace);
    const podReplicaCount = namespaceControllers.reduce((total, item) => total + Math.max(item.replicas ?? 0, 0), 0);
    const realPodCount = namespacePods.length;
    const readyPodCount = namespacePods.filter(
      (item) => String(item.podPhase ?? item.statusJson?.phase ?? item.status ?? "").toLowerCase() === "running",
    ).length;
    const readyReplicaCount = namespaceControllers.reduce(
      (total, item) => total + Math.max(item.readyReplicas ?? 0, 0),
      0,
    );
    namespaceSummaries.set(namespace, {
      resourceCount: namespaceNetwork.length + namespaceControllers.length + Math.max(realPodCount, podReplicaCount),
      networkCount: namespaceNetwork.length + namespaceGateway.length,
      workloadCount: namespaceControllers.length,
      podReplicaCount: Math.max(realPodCount, podReplicaCount),
      readyReplicaCount: realPodCount > 0 ? readyPodCount : readyReplicaCount,
      pendingReplicaCount: Math.max((realPodCount > 0 ? realPodCount : podReplicaCount) - (realPodCount > 0 ? readyPodCount : readyReplicaCount), 0),
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
                clusterId,
                kind: "Namespace",
                name: namespace,
                podCount: summary.resourceCount,
                readyPods: summary.readyReplicaCount,
                pendingPods: summary.pendingReplicaCount,
                networkCount: summary.networkCount,
                workloadCount: summary.workloadCount,
                podReplicaCount: summary.podReplicaCount,
                mode: "namespace",
              }
            : { namespace, clusterId, kind: "Namespace", name: namespace, mode: "namespace" },
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
    if (options.namespaceOverviewOnly) {
      return {
        nodes,
        edges,
      };
    }
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

  activeGateways.forEach((resource) => {
    const tokenKey = GATEWAY_TOKEN_BY_KIND[resource.kind];
    if (!tokenKey) return;
    const gatewayNodeId = `gateway-${resource.resource}-${resource.id}`;
    nodes.push({
      id: gatewayNodeId,
      type: "topo",
      position: { x: 0, y: 0 },
      data: {
        label: resource.name,
        typeLabel: resource.kind,
        tokenKey,
        caption: resource.namespace || "cluster-scope",
        raw: resource,
      },
    });
    gatewayNodeIdByResourceId.set(resource.id, gatewayNodeId);
    if (resource.kind === "GatewayClass") {
      gatewayClassNodeIdByName.set(resource.name, gatewayNodeId);
    }
    if (resource.kind === "Gateway") {
      gatewayNodeIdByNamespaceName.set(`${resource.namespace}/${resource.name}`, gatewayNodeId);
    }
  });

  controllers.forEach((controller) => {
    const ownedPods = activePods.filter(
      (pod) => pod.namespace === controller.namespace && controllerOwnsPodName(controller, pod.name),
    );
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

    const podCount = Math.min(ownedPods.length || total || 1, groupMode === "namespace" ? 4 : 6);
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
      const realPod = ownedPods[index];
      const podStatus: TopoNodeData["status"] = realPod ? resolvePodStatus(realPod) : index < ready ? "Running" : "Pending";
      const podReady = podStatus === "Running";
      const podId = realPod ? `pod-${realPod.id}` : `pod-${controller.id}-${index}`;
      const suffix = (controller.id.slice(-4) + index.toString(16)).slice(-5);
      const nodeName =
        realPod && typeof (realPod.nodeName ?? (realPod.spec ?? {}).nodeName) === "string"
          ? String(realPod.nodeName ?? (realPod.spec ?? {}).nodeName)
          : deriveNodeName(controller.namespace, controller.id, index, clusterId);

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
          label: realPod?.name ?? `${controller.name}-${suffix}`,
          typeLabel: "Pod",
          tokenKey: "pod",
          status: podStatus,
          caption: groupMode === "node" ? nodeName : controller.namespace,
          raw: realPod
            ? {
                ...realPod,
                phase: podStatus,
                controller: controller.name,
                nodeName,
              }
            : {
                clusterId,
                namespace: controller.namespace,
                kind: "Pod",
                name: `${controller.name}-${suffix}`,
                phase: podStatus,
                controller: controller.name,
                nodeName,
              },
        },
      });
      if (realPod) {
        podNodeIdByNamespaceName.set(`${realPod.namespace}/${realPod.name}`, podId);
      }

      pushEdge(
        buildEdge(groupMode === "instance" ? instanceGroupId : controllerId, podId, {
          style: {
            opacity: podReady ? 0.34 : 0.2,
            strokeDasharray: podReady ? undefined : "4 3",
          },
          data: {
            topologyRole: groupMode === "instance" ? "group" : "owner",
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

  const registerSemanticLink = (sourceId: string, targetId: string, role: TopologyEdgeRole = "relation", label?: string) => {
    hasSemanticEdge.add(sourceId);
    hasSemanticEdge.add(targetId);
    pushEdge(
      buildEdge(sourceId, targetId, {
        data: { topologyRole: role, ...(label ? { topologyLabel: label } : {}) },
        style: {
          strokeWidth: role === "network-policy" ? 0.95 : 1.04,
          opacity: role === "network-policy" ? 0.46 : 0.58,
          strokeDasharray: role === "network-policy" || role === "selector" ? "4 3" : undefined,
        },
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
        if (serviceNodeId) registerSemanticLink(sourceNodeId, serviceNodeId, "gateway-route");
      });
      return;
    }

    if (kind === "ingressroute") {
      extractIngressRouteServiceNames(resource.spec).forEach((serviceName) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${serviceName}`);
        if (serviceNodeId) registerSemanticLink(sourceNodeId, serviceNodeId, "gateway-route");
      });
      return;
    }

    if (kind === "endpoints") {
      const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${resource.name}`);
      if (serviceNodeId) {
        registerSemanticLink(serviceNodeId, sourceNodeId, "service-endpoint");
        const podNames = extractEndpointTargetPodNames(resource);
        podNames.forEach((podName) => {
          const podNodeId = podNodeIdByNamespaceName.get(`${resource.namespace}/${podName}`);
          if (podNodeId) registerSemanticLink(sourceNodeId, podNodeId, "service-endpoint", "targets");
        });
        const namespaceControllers = controllersByNamespace.get(resource.namespace) ?? [];
        namespaceControllers.forEach((controller) => {
          if (!podNames.some((podName) => controllerOwnsPodName(controller, podName))) return;
          const controllerNodeId = controllerNodeIdById.get(controller.id);
          if (controllerNodeId) registerSemanticLink(serviceNodeId, controllerNodeId, "selector");
        });
      }
      return;
    }

    if (kind === "endpointslice") {
      extractEndpointSliceServiceNames(resource).forEach((serviceName) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(`${resource.namespace}/${serviceName}`);
        if (!serviceNodeId) return;
        registerSemanticLink(serviceNodeId, sourceNodeId, "service-endpoint");
        const podNames = extractEndpointTargetPodNames(resource);
        podNames.forEach((podName) => {
          const podNodeId = podNodeIdByNamespaceName.get(`${resource.namespace}/${podName}`);
          if (podNodeId) registerSemanticLink(sourceNodeId, podNodeId, "service-endpoint", "targets");
        });
        const namespaceControllers = controllersByNamespace.get(resource.namespace) ?? [];
        namespaceControllers.forEach((controller) => {
          if (!podNames.some((podName) => controllerOwnsPodName(controller, podName))) return;
          const controllerNodeId = controllerNodeIdById.get(controller.id);
          if (controllerNodeId) registerSemanticLink(serviceNodeId, controllerNodeId, "selector");
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
        if (controllerNodeId) registerSemanticLink(sourceNodeId, controllerNodeId, "selector");
      });
      return;
    }

    if (kind === "networkpolicy") {
      const selectors = [extractNetworkPolicyPodSelector(resource), ...extractNetworkPolicyPeerSelectors(resource)].filter(
        (selector) => Object.keys(selector).length > 0,
      );
      const selectsAllPods = networkPolicySelectsAllPods(resource);
      if (selectors.length === 0 && !selectsAllPods) return;
      controllers.forEach((controller) => {
        if (controller.namespace !== resource.namespace) return;
        const templateLabels = extractWorkloadTemplateLabels(controller);
        const selectorLabels = extractWorkloadSelectorLabels(controller);
        if (
          !selectsAllPods &&
          !selectors.some(
            (selector) => labelsMatch(selector, templateLabels) || labelsMatch(selector, selectorLabels),
          )
        ) {
          return;
        }
        const controllerNodeId = controllerNodeIdById.get(controller.id);
        if (controllerNodeId) registerSemanticLink(sourceNodeId, controllerNodeId, "network-policy");
      });
    }
  });

  activeGateways.forEach((resource) => {
    const sourceNodeId = gatewayNodeIdByResourceId.get(resource.id);
    if (!sourceNodeId) return;

    if (resource.kind === "Gateway") {
      const className = extractGatewayClassName(resource);
      const classNodeId = className ? gatewayClassNodeIdByName.get(className) : undefined;
      if (classNodeId) registerSemanticLink(classNodeId, sourceNodeId, "gateway-route", "class");
      return;
    }

    if (resource.kind === "HTTPRoute") {
      extractHttpRouteGatewayRefs(resource).forEach((gatewayRef) => {
        const gatewayNodeId = gatewayNodeIdByNamespaceName.get(gatewayRef);
        if (gatewayNodeId) registerSemanticLink(gatewayNodeId, sourceNodeId, "gateway-route", "parent");
      });
      extractHttpRouteBackendRefs(resource).forEach((serviceRef) => {
        const serviceNodeId = serviceNodeIdByNamespaceName.get(serviceRef);
        if (serviceNodeId) registerSemanticLink(sourceNodeId, serviceNodeId, "gateway-route");
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

  activeGateways.forEach((resource) => {
    const gatewayNodeId = gatewayNodeIdByResourceId.get(resource.id);
    if (!gatewayNodeId || hasSemanticEdge.has(gatewayNodeId)) return;
    const namespaceId = resource.namespace ? `ns-${resource.namespace}` : clusterNodeId;
    pushEdge(
      buildEdge(useNamespaceGroups && resource.namespace ? namespaceId : clusterNodeId, gatewayNodeId, {
        style: useNamespaceGroups && resource.namespace
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
    nodes: groupMode === "namespace" ? nodes : applyDagreLayout(nodes, edges),
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
  const maxX = Math.max(...layoutNodes.map((node) => node.position.x + getNodeWidth(node)));
  const maxY = Math.max(...layoutNodes.map((node) => node.position.y + getNodeHeight(node)));

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
  const nodeSize = estimateNodeSizeFromData(data);
  const nodeWidth = nodeSize.width;
  const nodeHeight = nodeSize.height;
  const labelLines = estimateLabelLines(data.label, nodeWidth, data.tokenKey);
  const labelCapacity = Math.max(16, Math.floor(Math.max(72, nodeWidth - 28) / NODE_LABEL_CHAR_W) * labelLines - 2);
  const displayLabel = countDisplayUnits(data.label) > labelCapacity ? middleEllipsize(data.label, labelCapacity) : data.label;
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
      className={`topology-node-card topology-node-card--${data.tokenKey} ${
        selected ? "is-selected" : ""
      } ${isGroupNode ? "is-group" : ""} ${isNamespaceNode ? "is-namespace" : ""}`}
      title={`${data.typeLabel}: ${data.label}${data.caption ? ` (${data.caption})` : ""}`}
      style={{
        width: nodeWidth,
        minHeight: nodeHeight,
        borderRadius: isGroupPanelNode ? 22 : isLaneNode ? 12 : isNamespaceNode ? 16 : 10,
        border: isGroupPanelNode
          ? "1px dashed rgba(191, 219, 254, 0.46)"
          : `1px ${isGroupNode && !isLaneNode ? "dashed" : "solid"} ${selected ? token.border : token.borderAlpha}`,
        background: isGroupPanelNode
          ? "var(--topology-group-panel-bg)"
          : isLaneNode
          ? "var(--topology-lane-bg)"
          : selected
            ? token.bg
            : "var(--topology-card-bg)",
        boxShadow: isGroupPanelNode
          ? "var(--topology-group-panel-shadow)"
          : isLaneNode
          ? "var(--topology-lane-shadow)"
          : selected
            ? `0 0 0 1px ${token.border}33, 0 8px 18px rgba(15, 23, 42, 0.1)`
            : "var(--topology-node-shadow)",
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
            letterSpacing: 0,
            overflowWrap: "anywhere",
            wordBreak: ADAPTIVE_NAME_TOKENS.has(data.tokenKey) ? "break-word" : "normal",
            whiteSpace: "normal",
          }}
          className="topology-node-card__label"
          title={data.label}
        >
          {displayLabel}
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

const TOPO_NODE_TYPES: NodeTypes = { topo: TopoNode };

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
        <OpsIconActionButton className="topology-control-button" size="small" icon={<MinusOutlined />} onClick={onZoomOut} />
      </Tooltip>
      <Tooltip title="放大">
        <OpsIconActionButton className="topology-control-button" size="small" icon={<PlusOutlined />} onClick={onZoomIn} />
      </Tooltip>
      <Tooltip title="适应视图">
        <OpsIconActionButton className="topology-control-button" size="small" icon={<ShrinkOutlined />} onClick={onFitView} />
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
  const nodeTypes = useMemo(() => TOPO_NODE_TYPES, []);
  const edgeTypes = useMemo(() => TOPO_EDGE_TYPES, []);

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
          width: getNodeWidth(node),
          height: getNodeHeight(node),
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
    const width = getNodeWidth(focusedNode);
    const height = getNodeHeight(focusedNode);
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

  const showMiniMap = nodes.length <= LARGE_GRAPH_MINIMAP_NODE_LIMIT && edges.length <= LARGE_GRAPH_MINIMAP_EDGE_LIMIT;

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
      edgeTypes={edgeTypes}
      minZoom={0.08}
      maxZoom={4}
      autoPanOnNodeDrag={false}
      proOptions={REACT_FLOW_PRO_OPTIONS}
      onError={handleTopologyReactFlowError}
      style={{ background: CANVAS_BG }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--topology-overview-grid)" />

      {showMiniMap ? (
        <MiniMap
          nodeColor={minimapNodeColor}
          position="bottom-right"
          style={{
            background: "var(--topology-overview-panel)",
            border: "1px solid var(--topology-overview-border)",
            borderRadius: 16,
            width: 164,
            height: 100,
            pointerEvents: "none",
          }}
          maskColor="var(--topology-overview-mask)"
        />
      ) : null}

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
          title={getFailureCopy(unavailableCategory).title}
          description={
              <div style={{ display: "grid", gap: 8 }}>
                <span>{getFailureCopy(unavailableCategory).description}</span>
                <span style={{ color: "var(--topology-overview-subtle)" }}>{unavailableSummary}</span>
                <div>
                  <OpsIconActionButton size="small" opsTone="primary" icon={<ReloadOutlined />} onClick={onRetry}>
                    重试拉取
                  </OpsIconActionButton>
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
  canOpenResourceDetail,
  canOpenResourceYaml,
  onOpenCurrentResource,
  onOpenResourceDetail,
  onOpenResourceYaml,
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
  canOpenResourceDetail: boolean;
  canOpenResourceYaml: boolean;
  onOpenCurrentResource: () => void;
  onOpenResourceDetail: () => void;
  onOpenResourceYaml: () => void;
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
        <div className="topology-detail-panel__heading">
          <div className="topology-detail-panel__eyebrow">{nodeData.typeLabel}</div>
          <Title className="topology-detail-panel__title" level={4} style={{ margin: "4px 0 0" }} title={nodeData.label}>
            {nodeData.label}
          </Title>
        </div>
        <div className="topology-detail-panel__actions">
          {!isGroupNode && canOpenResourceDetail ? (
            <OpsIconActionButton size="small" opsTone="primary" onClick={onOpenResourceDetail}>
              打开详情
            </OpsIconActionButton>
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
          {canOpenResourceYaml ? (
            <OpsIconActionButton size="small" icon={<FileTextOutlined />} onClick={onOpenResourceYaml}>
              YAML
            </OpsIconActionButton>
          ) : null}
          {isGroupNode ? (
            <OpsIconActionButton size="small" onClick={onToggleGroup}>
              {isGroupExpanded ? "收起" : "展开"}
            </OpsIconActionButton>
          ) : null}
          <OpsIconActionButton size="small" onClick={onClear}>
            清空
          </OpsIconActionButton>
        </div>
      </div>

      <div className="topology-detail-panel__badges">
        <OpsFilterChip
          tone="info"
          style={{
            margin: 0,
            background: `${token.border}18`,
            color: token.text,
          }}
        >
          {token.icon} {TOKEN[nodeData.tokenKey].label}
        </OpsFilterChip>
        {nodeData.status ? <RuntimeStatusPill status={nodeData.status} /> : null}
        {nodeData.replicas ? (
          <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
            {nodeData.replicas}
          </OpsFilterChip>
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
                          <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
                            组内
                          </OpsFilterChip>
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
                  <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
                    {isGroupNode ? "组内" : "相邻"}
                  </OpsFilterChip>
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
            <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
              0
            </OpsFilterChip>
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
          <OpsIconActionButton
            className={`topology-quick-actions__item ${activeQuickAction === "abnormal" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("abnormal")}
          >
            异常聚焦
          </OpsIconActionButton>
          <OpsIconActionButton
            className={`topology-quick-actions__item ${activeQuickAction === "highRisk" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("highRisk")}
          >
            高风险链路
          </OpsIconActionButton>
          <OpsIconActionButton
            className={`topology-quick-actions__item ${activeQuickAction === "group" ? "is-active" : ""}`}
            onClick={() => onApplyQuickFilter("group")}
          >
            异常组
          </OpsIconActionButton>
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
  const [yamlTarget, setYamlTarget] = useState<TopologyYamlTarget | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [heavyTopologyRequested, setHeavyTopologyRequested] = useState(false);
  const fitViewRef = useRef<(() => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const userExpandedGroupsRef = useRef(false);
  const [userExpandedGroups, setUserExpandedGroups] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<TopoNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    document.body.classList.add("topology-overview-active");
    return () => {
      document.body.classList.remove("topology-overview-active");
    };
  }, []);

  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ["clusters"],
    queryFn: ({ signal }) => getClusters({ state: "active", selectableOnly: true }, token!, { signal }),
    enabled: !!token,
  });

  const clusterItems = clustersData?.items ?? EMPTY_CLUSTERS;
  const effectiveClusterId = selectedClusterId ?? clusterItems[0]?.id ?? null;
  const selectedCluster = useMemo(
    () => clusterItems.find((item) => item.id === effectiveClusterId),
    [clusterItems, effectiveClusterId],
  );
  const queryEnabled = !!token && !!effectiveClusterId;
  const topologyRequestNamespace = selectedNamespace === ALL_NAMESPACE ? undefined : selectedNamespace;
  const topologyNamespaceQueryKey = topologyRequestNamespace ?? ALL_NAMESPACE;
  const topologyNamespaceSummaryRequest = useMemo(
    () => (effectiveClusterId ? { clusterId: effectiveClusterId } : null),
    [effectiveClusterId],
  );
  const topologyNetworkRequest = useMemo(
    () =>
      effectiveClusterId
        ? { clusterId: effectiveClusterId, namespace: topologyRequestNamespace, pageSize: 200 }
        : null,
    [effectiveClusterId, topologyRequestNamespace],
  );
  const topologyWorkloadRequest = useMemo(
    () =>
      effectiveClusterId
        ? { clusterId: effectiveClusterId, namespace: topologyRequestNamespace, pageSize: 200, projection: "topology" as const }
        : null,
    [effectiveClusterId, topologyRequestNamespace],
  );
  const topologyPodRequest = useMemo(
    () =>
      effectiveClusterId
        ? { clusterId: effectiveClusterId, namespace: topologyRequestNamespace, pageSize: 400, projection: "topology" as const }
        : null,
    [effectiveClusterId, topologyRequestNamespace],
  );
  const shouldLoadHeavyTopology =
    heavyTopologyRequested ||
    selectedNamespace !== ALL_NAMESPACE ||
    groupMode !== "namespace" ||
    Boolean(focusedNodeId) ||
    resourceFilter !== "all" ||
    Boolean(activeQuickAction) ||
    userExpandedGroups;
  const {
    data: topologyNamespaceSummaryData,
    isLoading: topologyNamespaceSummaryLoading,
    error: topologyNamespaceSummaryError,
    refetch: refetchTopologyNamespaceSummary,
  } = useQuery({
    queryKey: ["topology-namespace-summary", effectiveClusterId],
    queryFn: ({ signal }) => getTopologyNamespaceSummaries(topologyNamespaceSummaryRequest!, token!, { signal }),
    enabled: queryEnabled,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });
  const shouldFallbackToResourceTopology =
    !topologyNamespaceSummaryLoading &&
    !topologyNamespaceSummaryError &&
    Boolean(topologyNamespaceSummaryData) &&
    (topologyNamespaceSummaryData?.items.length ?? 0) === 0;
  const shouldLoadResourceTopology = shouldLoadHeavyTopology || shouldFallbackToResourceTopology;

  const { data: networkData, isLoading: networkLoading, error: networkError, refetch } = useQuery({
    queryKey: ["topology-network", effectiveClusterId, topologyNamespaceQueryKey],
    queryFn: ({ signal }) => getNetworkResources(topologyNetworkRequest!, token!, { signal }),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const {
    data: gatewayTopologyData,
    isLoading: gatewayTopologyLoading,
    error: gatewayTopologyError,
    refetch: refetchGatewayTopology,
  } = useQuery({
    queryKey: [
      "topology-gateway-api",
      effectiveClusterId,
      topologyNamespaceQueryKey,
      shouldLoadHeavyTopology ? "detail" : "summary",
    ],
    queryFn: ({ signal }) =>
      getGatewayTopologyResources(effectiveClusterId!, token!, {
        signal,
        namespace: topologyRequestNamespace,
        includeDetails: shouldLoadHeavyTopology,
      }),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const { data: deploymentData, isLoading: deploymentLoading, error: deploymentError } = useQuery({
    queryKey: ["topology-deployments", effectiveClusterId, topologyNamespaceQueryKey],
    queryFn: ({ signal }) =>
      getWorkloadsByKind(
        "Deployment",
        topologyWorkloadRequest!,
        token!,
        { signal },
      ),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const { data: statefulSetData, isLoading: statefulSetLoading, error: statefulSetError } = useQuery({
    queryKey: ["topology-statefulsets", effectiveClusterId, topologyNamespaceQueryKey],
    queryFn: ({ signal }) =>
      getWorkloadsByKind(
        "StatefulSet",
        topologyWorkloadRequest!,
        token!,
        { signal },
      ),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const { data: daemonSetData, isLoading: daemonSetLoading, error: daemonSetError } = useQuery({
    queryKey: ["topology-daemonsets", effectiveClusterId, topologyNamespaceQueryKey],
    queryFn: ({ signal }) =>
      getWorkloadsByKind(
        "DaemonSet",
        topologyWorkloadRequest!,
        token!,
        { signal },
      ),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const { data: podData, isLoading: podLoading, error: podError } = useQuery({
    queryKey: ["topology-pods", effectiveClusterId, topologyNamespaceQueryKey, shouldLoadHeavyTopology ? "detail" : "idle"],
    queryFn: ({ signal }) =>
      getWorkloadsByKind(
        "Pod",
        topologyPodRequest!,
        token!,
        { signal },
      ),
    enabled: queryEnabled && shouldLoadResourceTopology,
    ...TOPOLOGY_RESOURCE_QUERY_OPTIONS,
  });

  const isLoading =
    clustersLoading ||
    (!shouldLoadResourceTopology && topologyNamespaceSummaryLoading) ||
    (shouldLoadResourceTopology &&
      (networkLoading ||
        gatewayTopologyLoading ||
        deploymentLoading ||
        statefulSetLoading ||
        daemonSetLoading ||
        podLoading));
  const clusterDataUnavailable =
    !isLoading &&
    !!effectiveClusterId &&
    (shouldLoadResourceTopology
      ? !!networkError || !!gatewayTopologyError || !!deploymentError || !!statefulSetError || !!daemonSetError || !!podError
      : !!topologyNamespaceSummaryError);
  const topologyErrors = useMemo(() => {
    const errors = shouldLoadResourceTopology
      ? [networkError, gatewayTopologyError, deploymentError, statefulSetError, daemonSetError, podError]
      : [topologyNamespaceSummaryError];
    return errors.filter(Boolean);
  }, [
    daemonSetError,
    deploymentError,
    gatewayTopologyError,
    networkError,
    podError,
    shouldLoadResourceTopology,
    statefulSetError,
    topologyNamespaceSummaryError,
  ]);
  const unavailableCategory = useMemo(() => resolveFailureCategory(topologyErrors), [topologyErrors]);
  const unavailableSummary = useMemo(() => topologyErrors.map(resolveErrorMessage).join(" | "), [topologyErrors]);
  const partialCoverageSummary = useMemo(() => {
    const unavailableKinds = gatewayTopologyData?.unavailableKinds ?? EMPTY_GATEWAY_UNAVAILABLE_KINDS;
    if (unavailableKinds.length === 0) return null;
    return `Gateway API 部分资源不可用：${unavailableKinds.join(", ")}。拓扑已保留其他资源与关系。`;
  }, [gatewayTopologyData?.unavailableKinds]);
  const topologyNamespaceSummaryItems = topologyNamespaceSummaryData?.items ?? EMPTY_TOPOLOGY_NAMESPACE_SUMMARIES;
  const networkItems = networkData?.items ?? EMPTY_NETWORK_RESOURCES;
  const gatewayTopologyItems = gatewayTopologyData?.items ?? EMPTY_GATEWAY_TOPOLOGY_RESOURCES;
  const deploymentItems = deploymentData?.items ?? EMPTY_WORKLOAD_ITEMS;
  const statefulSetItems = statefulSetData?.items ?? EMPTY_WORKLOAD_ITEMS;
  const daemonSetItems = daemonSetData?.items ?? EMPTY_WORKLOAD_ITEMS;
  const podItems = podData?.items ?? EMPTY_WORKLOAD_ITEMS;
  const hasPodItems = Boolean(podData?.items);

  const namespaceOptions = useMemo(() => {
    const values = new Set<string>();
    topologyNamespaceSummaryItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    networkItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    gatewayTopologyItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    deploymentItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    statefulSetItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    daemonSetItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });
    podItems.forEach((item) => {
      if (item.namespace) values.add(item.namespace);
    });

    return [
      { value: ALL_NAMESPACE, label: "全部名称空间" },
      ...Array.from(values)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ];
  }, [
    daemonSetItems,
    deploymentItems,
    gatewayTopologyItems,
    networkItems,
    podItems,
    statefulSetItems,
    topologyNamespaceSummaryItems,
  ]);

  const namespaceFilteredNetwork = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? networkItems
        : networkItems.filter((item) => item.namespace === selectedNamespace),
    [networkItems, selectedNamespace],
  );
  const namespaceFilteredGatewayTopology = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? gatewayTopologyItems
        : gatewayTopologyItems.filter((item) => !item.namespace || item.namespace === selectedNamespace),
    [gatewayTopologyItems, selectedNamespace],
  );
  const namespaceFilteredDeployments = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? deploymentItems
        : deploymentItems.filter((item) => item.namespace === selectedNamespace),
    [deploymentItems, selectedNamespace],
  );
  const namespaceFilteredStatefulSets = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? statefulSetItems
        : statefulSetItems.filter((item) => item.namespace === selectedNamespace),
    [selectedNamespace, statefulSetItems],
  );
  const namespaceFilteredDaemonSets = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? daemonSetItems
        : daemonSetItems.filter((item) => item.namespace === selectedNamespace),
    [daemonSetItems, selectedNamespace],
  );
  const namespaceFilteredPods = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? podItems
        : podItems.filter((item) => item.namespace === selectedNamespace),
    [podItems, selectedNamespace],
  );
  const namespaceFilteredSummaries = useMemo(
    () =>
      selectedNamespace === ALL_NAMESPACE
        ? topologyNamespaceSummaryItems
        : topologyNamespaceSummaryItems.filter((item) => item.namespace === selectedNamespace),
    [selectedNamespace, topologyNamespaceSummaryItems],
  );
  const sourceResourceCounts = useMemo(() => {
    const counts = new Map<SourceKey, number>();
    if (!shouldLoadResourceTopology && namespaceFilteredSummaries.length > 0) {
      namespaceFilteredSummaries.forEach((summary) => addSummaryResourceCounts(counts, summary));
      return counts;
    }
    namespaceFilteredNetwork.forEach((item) => incrementSourceCount(counts, resolveNetworkTokenKey(String(item.kind))));
    namespaceFilteredGatewayTopology.forEach((item) => {
      const tokenKey = GATEWAY_TOKEN_BY_KIND[item.kind];
      if (tokenKey) incrementSourceCount(counts, tokenKey);
    });
    incrementSourceCount(counts, "deployment", namespaceFilteredDeployments.length);
    incrementSourceCount(counts, "statefulset", namespaceFilteredStatefulSets.length);
    incrementSourceCount(counts, "daemonset", namespaceFilteredDaemonSets.length);
    let estimatedPodCount = namespaceFilteredPods.length;
    if (!hasPodItems) {
      estimatedPodCount = 0;
      namespaceFilteredDeployments.forEach((item) => {
        estimatedPodCount += Math.max(item.replicas ?? item.readyReplicas ?? 0, 0);
      });
      namespaceFilteredStatefulSets.forEach((item) => {
        estimatedPodCount += Math.max(item.replicas ?? item.readyReplicas ?? 0, 0);
      });
      namespaceFilteredDaemonSets.forEach((item) => {
        estimatedPodCount += Math.max(item.replicas ?? item.readyReplicas ?? 0, 0);
      });
    }
    incrementSourceCount(counts, "pod", estimatedPodCount);
    return counts;
  }, [
    namespaceFilteredDaemonSets,
    namespaceFilteredDeployments,
    namespaceFilteredGatewayTopology,
    namespaceFilteredNetwork,
    namespaceFilteredPods,
    namespaceFilteredStatefulSets,
    namespaceFilteredSummaries,
    hasPodItems,
    shouldLoadResourceTopology,
  ]);
  const deferredSelectedCluster = useDeferredValue(selectedCluster);
  const deferredNamespaceFilteredNetwork = useDeferredValue(namespaceFilteredNetwork);
  const deferredNamespaceFilteredGatewayTopology = useDeferredValue(namespaceFilteredGatewayTopology);
  const deferredNamespaceFilteredDeployments = useDeferredValue(namespaceFilteredDeployments);
  const deferredNamespaceFilteredStatefulSets = useDeferredValue(namespaceFilteredStatefulSets);
  const deferredNamespaceFilteredDaemonSets = useDeferredValue(namespaceFilteredDaemonSets);
  const deferredNamespaceFilteredPods = useDeferredValue(namespaceFilteredPods);
  const deferredNamespaceFilteredSummaries = useDeferredValue(namespaceFilteredSummaries);
  const namespaceOverviewOnly =
    selectedNamespace === ALL_NAMESPACE &&
    groupMode === "namespace" &&
    !focusedNodeId &&
    resourceFilter === "all" &&
    !activeQuickAction &&
    !userExpandedGroups;
  const useNamespaceSummaryGraph = namespaceOverviewOnly && !shouldLoadResourceTopology;

  useEffect(() => {
    if (!deferredSelectedCluster) return;
    let cancelled = false;

    const cancelWork = scheduleTopologyWork(() => {
      if (cancelled) return;
      const graph = useNamespaceSummaryGraph
        ? buildNamespaceSummaryGraph(
            deferredSelectedCluster.name,
            deferredSelectedCluster.id,
            deferredNamespaceFilteredSummaries,
          )
        : buildFlowGraph(
            deferredSelectedCluster.name,
            deferredSelectedCluster.id,
            deferredNamespaceFilteredNetwork,
            deferredNamespaceFilteredGatewayTopology,
            deferredNamespaceFilteredDeployments,
            deferredNamespaceFilteredStatefulSets,
            deferredNamespaceFilteredDaemonSets,
            deferredNamespaceFilteredPods,
            groupMode,
            { namespaceOverviewOnly },
          );
      if (cancelled) return;
      startTransition(() => {
        if (cancelled) return;
        setNodes(graph.nodes);
        setEdges(graph.edges);
      });
    });

    return () => {
      cancelled = true;
      cancelWork();
    };
  }, [
    deferredSelectedCluster,
    deferredNamespaceFilteredNetwork,
    deferredNamespaceFilteredGatewayTopology,
    deferredNamespaceFilteredDeployments,
    deferredNamespaceFilteredStatefulSets,
    deferredNamespaceFilteredDaemonSets,
    deferredNamespaceFilteredPods,
    deferredNamespaceFilteredSummaries,
    groupMode,
    namespaceOverviewOnly,
    useNamespaceSummaryGraph,
    setNodes,
    setEdges,
  ]);

  const baseHasNodes = nodes.length > 0;

  const graphNodeMap = useMemo(() => {
    const map = new Map<string, Node<TopoNodeData>>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const availableResourceTypeKeys = useMemo(() => {
    return RESOURCE_DOMAIN_KEYS.flatMap((domain) =>
      RESOURCE_DOMAIN_META[domain].keys.filter((key) => (sourceResourceCounts.get(key) ?? 0) > 0),
    );
  }, [sourceResourceCounts]);

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
    () => (focusedNodeId && filteredNodeIds.has(focusedNodeId) ? graphNodeMap.get(focusedNodeId) ?? null : null),
    [filteredNodeIds, focusedNodeId, graphNodeMap],
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
  const focusedResourceYamlTarget = useMemo(
    () => resolveResourceYamlTarget(focusedNode),
    [focusedNode],
  );


  const resourceFocusCounts = useMemo(() => {
    if (namespaceOverviewOnly) {
      return sourceResourceCounts;
    }
    const counts = new Map<SourceKey, number>();
    nodes.forEach((node) => {
      if (!baseFilteredNodeIds.has(node.id)) return;
      if (!isSourceKey(node.data.tokenKey)) return;
      counts.set(node.data.tokenKey, (counts.get(node.data.tokenKey) ?? 0) + 1);
    });

    return counts;
  }, [baseFilteredNodeIds, namespaceOverviewOnly, nodes, sourceResourceCounts]);

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
      { key: "service", label: "前往 Service 列表", path: "/network/services" },
      { key: "endpoints", label: "前往 Endpoints 列表", path: "/network/endpoints" },
      { key: "endpointslice", label: "前往 EndpointSlice 列表", path: "/network/endpointslices" },
      { key: "ingress", label: "前往 Ingress 列表", path: "/network/ingress" },
      { key: "ingressroute", label: "前往 IngressRoute 列表", path: "/network/ingressroute" },
      { key: "networkpolicy", label: "前往 NetworkPolicy 列表", path: "/network/networkpolicy" },
      { key: "gatewayclass", label: "前往 Gateway API 列表", path: "/network/gateway-api?kind=gatewayclass" },
      { key: "gateway", label: "前往 Gateway API 列表", path: "/network/gateway-api?kind=gateway" },
      { key: "httproute", label: "前往 Gateway API 列表", path: "/network/gateway-api?kind=httproute" },
      { key: "deployment", label: "前往 Deployment 列表", path: "/workloads/deployments" },
      { key: "statefulset", label: "前往 StatefulSet 列表", path: "/workloads/statefulsets" },
      { key: "daemonset", label: "前往 DaemonSet 列表", path: "/workloads/daemonsets" },
      { key: "pod", label: "前往 Pod 列表", path: "/workloads/pods" },
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
      if (nextNode && isGroupTokenKey(nextNode.data.tokenKey)) {
        setHeavyTopologyRequested(true);
      }
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
        const joiner = target.path.includes("?") ? "&" : "?";
        router.push(query ? `${target.path}${joiner}${query}` : target.path);
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
    refetchTopologyNamespaceSummary();
    if (shouldLoadResourceTopology) {
      refetch();
      refetchGatewayTopology();
    }
    setHeavyTopologyRequested(false);
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setDetailRequest(null);
    setYamlTarget(null);
    setViewportVersion((current) => current + 1);
  }, [refetch, refetchGatewayTopology, refetchTopologyNamespaceSummary, shouldLoadResourceTopology]);

  const handleClusterChange = useCallback(
    (value: string) => {
      userExpandedGroupsRef.current = false;
      setUserExpandedGroups(false);
      setHeavyTopologyRequested(false);
      setSelectedClusterId(value);
      setSelectedNamespace(ALL_NAMESPACE);
      setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
      setSelectedGroupSection(null);
      setFocusedNodeId(null);
      setExpandedGroupIds([]);
      setDetailRequest(null);
      setYamlTarget(null);
      setResourceFocusPanelOpen(false);
      setClusterPanelOpen(false);
      setViewportVersion((current) => current + 1);
    },
    [],
  );

  const handleNamespaceChange = useCallback((value: string) => {
    userExpandedGroupsRef.current = value !== ALL_NAMESPACE;
    setUserExpandedGroups(value !== ALL_NAMESPACE);
    setHeavyTopologyRequested(value !== ALL_NAMESPACE);
    setSelectedNamespace(value);
    setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setExpandedGroupIds(value === ALL_NAMESPACE ? [] : [`ns-${value}`]);
    setDetailRequest(null);
    setYamlTarget(null);
    setResourceFocusPanelOpen(false);
    setNamespacePanelOpen(false);
    setViewportVersion((current) => current + 1);
  }, []);

  const handleClusterPanelOpenChange = useCallback((open: boolean) => {
    setClusterPanelOpen(open);
    if (!open) return;
    setNamespacePanelOpen(false);
    setResourceFocusPanelOpen(false);
    setGroupModePanelOpen(false);
  }, []);

  const handleNamespacePanelOpenChange = useCallback((open: boolean) => {
    setNamespacePanelOpen(open);
    if (!open) return;
    setClusterPanelOpen(false);
    setResourceFocusPanelOpen(false);
    setGroupModePanelOpen(false);
  }, []);

  const handleResourceFocusPanelOpenChange = useCallback((open: boolean) => {
    setResourceFocusPanelOpen(open);
    if (open) {
      setHeavyTopologyRequested(true);
      setClusterPanelOpen(false);
      setNamespacePanelOpen(false);
      setGroupModePanelOpen(false);
    }
  }, []);

  const handleGroupModePanelOpenChange = useCallback((open: boolean) => {
    setGroupModePanelOpen(open);
    if (!open) return;
    setClusterPanelOpen(false);
    setNamespacePanelOpen(false);
    setResourceFocusPanelOpen(false);
  }, []);

  const handleSelectAllResourceTypes = useCallback(() => {
    setHeavyTopologyRequested(true);
    setSelectedResourceTypes(
      availableResourceTypeKeys.length > 0 ? [...availableResourceTypeKeys] : [...SOURCE_TOKEN_KEYS],
    );
    setSelectedGroupSection(null);
    setDetailRequest(null);
    setYamlTarget(null);
  }, [availableResourceTypeKeys]);

  const handleResetResourceTypesToDefault = useCallback(() => {
    setHeavyTopologyRequested(true);
    setSelectedResourceTypes([...availableResourceTypeKeys]);
    setSelectedGroupSection(null);
    setDetailRequest(null);
    setYamlTarget(null);
  }, [availableResourceTypeKeys]);

  const handleToggleResourceDomain = useCallback((domain: ResourceDomainKey) => {
    setExpandedResourceDomains((current) =>
      current.includes(domain)
        ? current.filter((item) => item !== domain)
        : [...current, domain],
    );
  }, []);

  const handleToggleResourceDomainSelection = useCallback((domain: ResourceDomainKey) => {
    setHeavyTopologyRequested(true);
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
    setFocusedNodeId(null);
    setDetailRequest(null);
    setYamlTarget(null);
  }, [effectiveSelectedResourceTypes]);

  const handleToggleResourceType = useCallback((value: SourceKey) => {
    setHeavyTopologyRequested(true);
    setSelectedResourceTypes((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value);
        return next.length > 0 ? next : current;
      }
      return [...current, value];
    });
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setDetailRequest(null);
    setYamlTarget(null);
  }, []);

  const handleGroupModeChange = useCallback((value: GroupMode) => {
    userExpandedGroupsRef.current = false;
    setUserExpandedGroups(false);
    setHeavyTopologyRequested(value !== "namespace");
    setGroupMode(value);
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setExpandedGroupIds([]);
    setDetailRequest(null);
    setYamlTarget(null);
    setGroupModePanelOpen(false);
    setViewportVersion((current) => current + 1);
  }, []);

  const handleAbnormalFocusToggle = useCallback(() => {
    setHeavyTopologyRequested(true);
    setResourceFilter((current) => (current === "abnormal" ? "all" : "abnormal"));
    setSelectedGroupSection(null);
    setFocusedNodeId(null);
    setDetailRequest(null);
    setYamlTarget(null);
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
    setHeavyTopologyRequested(false);
    setFocusedNodeId(null);
    setSelectedGroupSection(null);
    setSelectedResourceTypes([...SOURCE_TOKEN_KEYS]);
    setGroupMode("namespace");
    setResourceFilter("all");
    setActiveQuickAction(null);
    setExpandedGroupIds([]);
    setDetailRequest(null);
    setYamlTarget(null);
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
      setHeavyTopologyRequested(true);
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
    <OpsPopoverPanel
      title="资源类型"
      subtitle="按资源域筛选图谱"
      className="topology-popover-panel topology-popover-panel--resource-focus"
    >
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
            <OpsIconActionButton className="topology-resource-tree__toolbar-action" onClick={handleSelectAllResourceTypes}>
              全选
            </OpsIconActionButton>
            <OpsIconActionButton className="topology-resource-tree__toolbar-action" onClick={handleResetResourceTypesToDefault}>
              默认
            </OpsIconActionButton>
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
              <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
                当前范围无资源
              </OpsFilterChip>
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
    </OpsPopoverPanel>
  );
  const selectedClusterLabel = selectedCluster?.name ?? "选择集群";
  const selectedNamespaceLabel =
    namespaceOptions.find((item) => item.value === selectedNamespace)?.label ?? "全部名称空间";
  const selectedGroupModeLabel =
    GROUP_MODE_ITEMS.find((item) => item.value === groupMode)?.label ?? "名称空间";
  const toolbarShellStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--topology-toolbar-shell-border)",
    background: "var(--topology-toolbar-shell-bg)",
    boxShadow: "var(--topology-toolbar-shell-shadow)",
    backdropFilter: "blur(14px)",
  };
  const toolbarPillBaseStyle: React.CSSProperties = {
    minHeight: 52,
    minWidth: 168,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--topology-toolbar-pill-border)",
    background: "var(--topology-toolbar-pill-bg)",
    boxShadow: "var(--topology-toolbar-pill-shadow)",
  };
  const toolbarWidePillStyle: React.CSSProperties = {
    ...toolbarPillBaseStyle,
    minWidth: 236,
  };
  const toolbarToggleStyle: React.CSSProperties = {
    ...toolbarPillBaseStyle,
    minWidth: 174,
    background: "var(--topology-toolbar-toggle-bg)",
  };

  const clusterPanel = (
    <OpsPopoverPanel title="集群" subtitle="切换拓扑范围" className="topology-popover-panel topology-popover-panel--compact">
      {clusterItems.map((item) => (
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
    </OpsPopoverPanel>
  );

  const namespacePanel = (
    <OpsPopoverPanel
      title="名称空间"
      subtitle="按 namespace 过滤"
      className="topology-popover-panel topology-popover-panel--compact topology-popover-panel--scroll"
    >
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
    </OpsPopoverPanel>
  );

  const groupModePanel = (
    <OpsPopoverPanel title="分组方式" subtitle="调整聚类维度" className="topology-popover-panel topology-popover-panel--narrow">
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
    </OpsPopoverPanel>
  );

  return (
    <div className="topology-overview-page ops-workbench-shell ops-workbench-shell--topology">
      <section className="topology-map-shell">
        <div className="topology-toolbar-stack" style={toolbarShellStyle}>
          <div className="topology-toolbar-row">
            <div className="topology-toolbar-section">
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={clusterPanelOpen}
                onOpenChange={handleClusterPanelOpenChange}
                content={clusterPanel}
                overlayStyle={{ width: "var(--topology-popover-width-compact)", maxWidth: "calc(100vw - 24px)" }}
              >
                <TopologyFilterPill
                  active={clusterPanelOpen}
                  disabled={clustersLoading}
                  icon={<RadarChartOutlined />}
                  label="集群"
                  value={selectedClusterLabel}
                  style={{ ...toolbarPillBaseStyle, opacity: clustersLoading ? 0.6 : 1 }}
                />
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={namespacePanelOpen}
                onOpenChange={handleNamespacePanelOpenChange}
                content={namespacePanel}
                overlayStyle={{ width: "var(--topology-popover-width-compact)", maxWidth: "calc(100vw - 24px)" }}
              >
                <TopologyFilterPill
                  active={namespacePanelOpen}
                  icon={<BranchesOutlined />}
                  label="名称空间"
                  value={selectedNamespaceLabel}
                  style={toolbarPillBaseStyle}
                />
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={resourceFocusPanelOpen}
                onOpenChange={handleResourceFocusPanelOpenChange}
                content={resourceFocusPanel}
                overlayStyle={{ width: "var(--topology-popover-width-resource)", maxWidth: "calc(100vw - 24px)" }}
              >
                <TopologyFilterPill
                  active={resourceFocusPanelOpen}
                  icon={<FilterOutlined />}
                  label="资源类型"
                  meta={
                    <>
                      <span className="topology-filter-pill__count">{effectiveSelectedResourceTypes.length}</span>
                      <DownOutlined className="topology-filter-pill__arrow" />
                    </>
                  }
                  style={toolbarWidePillStyle}
                  value={selectedResourceFocusSummary}
                  wide
                />
              </Popover>
              <Popover
                trigger="click"
                placement="bottomLeft"
                open={groupModePanelOpen}
                onOpenChange={handleGroupModePanelOpenChange}
                content={groupModePanel}
                overlayStyle={{ width: "var(--topology-popover-width-narrow)", maxWidth: "calc(100vw - 24px)" }}
              >
                <TopologyFilterPill
                  active={groupModePanelOpen}
                  icon={<BranchesOutlined />}
                  label="分组"
                  value={selectedGroupModeLabel}
                  style={toolbarPillBaseStyle}
                />
              </Popover>
              <TopologyFilterPill
                active={isAbnormalFocusActive}
                icon={<WarningOutlined />}
                label="异常链路"
                meta={<WarningOutlined className="topology-filter-pill__toggle-icon" />}
                onClick={handleAbnormalFocusToggle}
                style={toolbarToggleStyle}
                toggle
                value="聚焦告警"
                warning
              />
            </div>

            <div className="topology-toolbar-section topology-toolbar-section--compact">
              <OpsIconActionButton size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={isLoading}>
                刷新数据
              </OpsIconActionButton>
              <OpsIconActionButton size="small" onClick={handleResetView}>回到全局</OpsIconActionButton>
              <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitView={handleFitView} />
            </div>
          </div>

        </div>

        <div className={`topology-workbench ${focusedNode ? "has-detail" : "is-canvas-only"}`}>
          <section className="topology-canvas-stage">
            <div className="topology-canvas-stage__body">
              <div className="topology-canvas-stage__breadcrumbs">
                {breadcrumbItems.length === 0 ? (
                  <OpsFilterChip tone="neutral" style={{ margin: 0 }}>
                    Global
                  </OpsFilterChip>
                ) : (
                  breadcrumbItems.map((item, index) => (
                    <OpsIconActionButton
                      key={item.id}
                      size="small"
                      opsTone={index === breadcrumbItems.length - 1 ? "primary" : "default"}
                      disabled={!item.nodeId}
                      onClick={() => {
                        const targetNodeId = item.nodeId;
                        if (!targetNodeId) return;
                        focusNodeById(targetNodeId);
                      }}
                    >
                      {item.typeLabel} / {item.label}
                    </OpsIconActionButton>
                  ))
                )}
              </div>
              {partialCoverageSummary ? (
                <Alert
                  type="warning"
                  showIcon
                  className="topology-partial-coverage-alert"
                  title="拓扑覆盖不完整"
                  description={partialCoverageSummary}
                />
              ) : null}
              <div className="topology-canvas-surface">
                <ReactFlowProvider>
                  <TopologyReactFlowErrorHandler>
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
                  </TopologyReactFlowErrorHandler>
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
              canOpenResourceDetail={!detailInteractionsDisabled && Boolean(focusedResourceDetailRequest)}
              canOpenResourceYaml={!detailInteractionsDisabled && Boolean(focusedResourceYamlTarget)}
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
              onOpenResourceYaml={() => {
                if (detailInteractionsDisabled) return;
                if (focusedResourceYamlTarget) {
                  setYamlTarget(focusedResourceYamlTarget);
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
                setYamlTarget(null);
              }}
            />
          ) : null}
        </div>
        <ResourceDetailDrawer
          open={Boolean(detailRequest)}
          onClose={() => setDetailRequest(null)}
          token={token}
          request={detailRequest}
          onNavigateRequest={(request) => setDetailRequest(request)}
        />
        <ResourceYamlDrawer
          open={Boolean(yamlTarget)}
          onClose={() => setYamlTarget(null)}
          token={token}
          identity={yamlTarget?.identity ?? null}
          dynamicIdentity={yamlTarget?.dynamicIdentity ?? null}
          onUpdated={handleRefresh}
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
          border-radius: 8px;
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
          border-radius: 6px;
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
          border-radius: 7px;
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

        .topology-partial-coverage-alert {
          margin: 0 14px 12px;
          border-color: rgba(245, 158, 11, 0.32);
          background: color-mix(in srgb, var(--topology-overview-panel) 88%, #f59e0b 12%);
        }
      `}</style>
    </div>
  );
}
