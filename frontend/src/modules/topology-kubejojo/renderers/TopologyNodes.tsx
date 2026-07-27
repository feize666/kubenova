"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type KeyboardEvent } from "react";

import type { TopologyRendererGraphNode, TopologyRendererNodeData } from "./contracts";

function hiddenHandle(position: Position) {
  return (
    <Handle
      className="topology-kubejojo__handle"
      type={position === Position.Top ? "target" : "source"}
      position={position}
    />
  );
}

function getChildren(node: TopologyRendererGraphNode) {
  return node.nodes ?? node.children ?? [];
}

function getLeafNodes(node: TopologyRendererGraphNode): TopologyRendererGraphNode[] {
  const children = getChildren(node);
  return children.length ? children.flatMap(getLeafNodes) : [node];
}

function representedCount(node: TopologyRendererGraphNode): number {
  const children = getChildren(node);
  if (children.length) return children.reduce((total, child) => total + representedCount(child), 0);
  return Math.max(1, node.resource?.aggregation?.memberCount ?? 1);
}

function statusOf(node: TopologyRendererGraphNode): "healthy" | "warning" | "critical" | "unknown" {
  const status = node.resource?.status;
  if (status === "healthy" || status === "warning" || status === "critical" || status === "unknown") return status;
  const statuses = getLeafNodes(node).map((leaf) => leaf.resource?.status);
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("healthy")) return "healthy";
  return "unknown";
}

const STATUS_META = {
  healthy: { label: "正常", symbol: "✓" },
  warning: { label: "警告", symbol: "!" },
  critical: { label: "严重", symbol: "×" },
  unknown: { label: "未知", symbol: "?" },
} as const;

function activateOnKeyboard(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

function sourceLabel(source?: string) {
  return source ? source.replace(/[-_]/g, " ") : "Kubernetes";
}

function sharedResourceValue(
  node: TopologyRendererGraphNode,
  read: (resource: NonNullable<TopologyRendererGraphNode["resource"]>) => string | null | undefined,
  fallback: string,
) {
  const values = [...new Set(getLeafNodes(node).flatMap((leaf) => {
    const value = leaf.resource ? read(leaf.resource)?.trim() : undefined;
    return value ? [value] : [];
  }))];
  if (!values.length) return fallback;
  return values.length === 1 ? values[0] : `多个（${values.length}）`;
}

function statusCounts(node: TopologyRendererGraphNode) {
  return getLeafNodes(node).reduce<Record<"healthy" | "warning" | "critical" | "unknown", number>>((counts, leaf) => {
    const status = statusOf(leaf);
    counts[status] += representedCount(leaf);
    return counts;
  }, { healthy: 0, warning: 0, critical: 0, unknown: 0 });
}

function statusSummary(node: TopologyRendererGraphNode) {
  const counts = statusCounts(node);
  return (["critical", "warning", "healthy", "unknown"] as const)
    .filter((status) => counts[status] > 0)
    .map((status) => `${STATUS_META[status].label} ${counts[status]}`)
    .join(" · ");
}

function kindSummary(node: TopologyRendererGraphNode) {
  const counts = getLeafNodes(node).reduce<Record<string, number>>((result, leaf) => {
    const aggregatedKinds = leaf.resource?.aggregation?.membersByKind;
    if (aggregatedKinds && Object.keys(aggregatedKinds).length) {
      Object.entries(aggregatedKinds).forEach(([kind, count]) => { result[kind] = (result[kind] ?? 0) + count; });
      return result;
    }
    const kind = leaf.resource?.kind ?? "Unknown";
    result[kind] = (result[kind] ?? 0) + 1;
    return result;
  }, {});
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"));
  const visible = entries.slice(0, 3).map(([kind, count]) => `${kind} ${count}`).join(" · ");
  return entries.length > 3 ? `${visible} · +${entries.length - 3} 类` : visible;
}

function warningSummary(node: TopologyRendererGraphNode) {
  const warnings = getLeafNodes(node).flatMap((leaf) => leaf.resource?.warnings ?? []);
  if (!warnings.length) return undefined;
  return warnings.slice(0, 2).join("；") + (warnings.length > 2 ? `；另有 ${warnings.length - 2} 项` : "");
}

function Glance({ graphNode, grouped = false }: { graphNode: TopologyRendererGraphNode; grouped?: boolean }) {
  const resource = graphNode.resource;
  const leaves = getLeafNodes(graphNode);
  const aggregationCount = leaves.reduce((total, leaf) => {
    const memberCount = leaf.resource?.aggregation?.memberCount ?? 0;
    return total + (memberCount > 1 ? memberCount : 0);
  }, 0);
  const summary = grouped ? graphNode.subtitle : resource?.summary ?? graphNode.subtitle;
  const warning = warningSummary(graphNode);
  return (
    <div className="topology-kubejojo__node-glance" role="tooltip">
      <div className="topology-kubejojo__node-glance-title">
        <strong>{grouped ? "分组概览" : "资源概览"}</strong>
        <span>{statusSummary(graphNode)}</span>
      </div>
      <dl>
        <div><dt>名称空间</dt><dd>{sharedResourceValue(graphNode, (item) => item.namespace, "集群级")}</dd></div>
        <div><dt>来源</dt><dd>{sharedResourceValue(graphNode, (item) => sourceLabel(item.source), "Kubernetes")}</dd></div>
        {summary ? <div><dt>摘要</dt><dd>{summary}</dd></div> : null}
      </dl>
      {grouped || aggregationCount > 0 ? (
        <div className="topology-kubejojo__node-glance-aggregation">
          <strong>{representedCount(graphNode)} 个真实资源</strong>
          <span>{kindSummary(graphNode)}</span>
        </div>
      ) : null}
      {warning ? <div className="topology-kubejojo__node-glance-warning">告警：{warning}</div> : null}
    </div>
  );
}

const KIND_CODE: Record<string, string> = {
  Cluster: "CL",
  Namespace: "NS",
  Deployment: "DP",
  StatefulSet: "SS",
  DaemonSet: "DS",
  ReplicaSet: "RS",
  Pod: "POD",
  Job: "JB",
  CronJob: "CJ",
  Service: "SVC",
  Ingress: "IG",
  IngressRoute: "IR",
  Endpoints: "EP",
  EndpointSlice: "ES",
  NetworkPolicy: "NP",
  GatewayClass: "GC",
  Gateway: "GW",
  HTTPRoute: "HR",
  PersistentVolume: "PV",
  PersistentVolumeClaim: "PVC",
  StorageClass: "SC",
  ConfigMap: "CM",
  Secret: "SEC",
  ServiceAccount: "SA",
  HorizontalPodAutoscaler: "HPA",
  VerticalPodAutoscaler: "VPA",
  Aggregate: "AGG",
  Component: "CMP",
  Isolated: "SET",
  Group: "GR",
};

export function kindCode(kind?: string) {
  const value = kind?.trim() ?? "";
  const fallback = value.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return KIND_CODE[value] ?? (fallback || "RS");
}

function ObjectNode({ data, selected }: NodeProps<Node<TopologyRendererNodeData>>) {
  const graphNode = data.graphNode;
  const children = getChildren(graphNode);
  const isCollapsedGroup = children.length > 0;
  const resource = graphNode.resource;
  const status = statusOf(graphNode);
  const resourceCount = representedCount(graphNode);
  const isScopePreview = graphNode.groupKind === "scope";
  const nodeKind = resource?.kind ?? (isScopePreview
    ? "Namespace"
    : graphNode.groupKind === "component"
      ? "Component"
      : graphNode.groupKind === "isolated"
        ? "Isolated"
        : graphNode.label);
  const title = graphNode.label ?? resource?.name ?? "Unknown resource";
  const viewState = data.viewState ?? "default";
  const groupType = isScopePreview ? "名称空间" : graphNode.groupKind === "component" ? "关联组件" : "资源集合";

  return (
    <div
      className={[
        "topology-kubejojo__node",
        `is-${status}`,
        `is-${viewState}`,
        selected ? "is-selected" : undefined,
        isCollapsedGroup ? "is-collapsed" : undefined,
      ].filter(Boolean).join(" ")}
      role="button"
      tabIndex={0}
      aria-label={`${nodeKind ?? "资源"} ${title}，状态${STATUS_META[status].label}`}
      aria-pressed={selected}
      aria-expanded={isCollapsedGroup ? false : undefined}
      onKeyDown={activateOnKeyboard}
    >
      {isCollapsedGroup ? (
        <>
          <div className="topology-kubejojo__node-stack topology-kubejojo__node-stack--back" />
          <div className="topology-kubejojo__node-stack topology-kubejojo__node-stack--middle" />
        </>
      ) : null}
      <div className="topology-kubejojo__node-card">
        {hiddenHandle(Position.Top)}
        {hiddenHandle(Position.Bottom)}
        <div className="topology-kubejojo__node-icon">
          {kindCode(nodeKind)}
          {isCollapsedGroup ? <span className="topology-kubejojo__node-number">{resourceCount}</span> : null}
        </div>
        <div className="topology-kubejojo__node-copy">
          <div className="topology-kubejojo__node-kind">
            {isCollapsedGroup ? `${groupType} · 已折叠` : nodeKind}
          </div>
          <strong className="topology-kubejojo__node-title" title={title}>{title}</strong>
          <div className="topology-kubejojo__node-meta">
            <span
              className="topology-kubejojo__node-status"
              role="img"
              aria-label={`状态：${STATUS_META[status].label}`}
              title={`状态：${STATUS_META[status].label}`}
            >
              {STATUS_META[status].symbol}
            </span>
            {isCollapsedGroup ? (
              <span className="topology-kubejojo__node-resource-count">{resourceCount} 个资源 · {statusSummary(graphNode)}</span>
            ) : (
              <span className="topology-kubejojo__node-status-label">{STATUS_META[status].label}</span>
            )}
          </div>
        </div>
      </div>
      <Glance graphNode={graphNode} grouped={isCollapsedGroup} />
    </div>
  );
}

function GroupNode({ data }: NodeProps<Node<TopologyRendererNodeData>>) {
  const graphNode = data.graphNode;
  const status = statusOf(graphNode);
  const resourceCount = representedCount(graphNode);
  const viewState = data.viewState ?? "default";
  const title = graphNode.label ?? graphNode.resource?.name ?? "Resource group";
  const subtitle = graphNode.subtitle ?? "Group";
  const isComponent = graphNode.groupKind === "component";

  return (
    <div
      className={[
        "topology-kubejojo__group",
        `is-${status}`,
        `is-${viewState}`,
        isComponent ? "is-component" : undefined,
      ].filter(Boolean).join(" ")}
      role="group"
      aria-label={`${isComponent ? "关联组件" : subtitle} ${title}，${resourceCount} 个资源，状态${STATUS_META[status].label}`}
    >
      {hiddenHandle(Position.Top)}
      {hiddenHandle(Position.Bottom)}
      <div className="topology-kubejojo__group-label">
        <span
          className="topology-kubejojo__group-status"
          role="img"
          aria-label={`状态：${STATUS_META[status].label}`}
          title={`状态：${STATUS_META[status].label}`}
        >
          {STATUS_META[status].symbol}
        </span>
        <span className="topology-kubejojo__group-copy">
          <span className="topology-kubejojo__group-subtitle">{isComponent ? "关联组件" : subtitle} · 已展开</span>
          <strong title={title}>{title}</strong>
        </span>
        <span className="topology-kubejojo__group-metrics">
          <strong>{resourceCount} 个资源</strong>
          <span>{statusSummary(graphNode)}</span>
        </span>
      </div>
      <Glance graphNode={graphNode} grouped />
    </div>
  );
}

export const TopologyObjectNode = memo(ObjectNode);
export const TopologyGroupNode = memo(GroupNode);
