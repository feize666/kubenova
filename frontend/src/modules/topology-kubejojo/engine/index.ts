import type { Edge, Node } from "@xyflow/react";

import type { TopologyRendererEdgeData, TopologyRendererNodeData } from "../renderers";
import { getElkEngine } from "./elk-engine";
import {
  containerRelations,
  getKubejojoCacheKey,
  getPartitionLayer as getKubejojoPartitionLayer,
  toElkGraph,
  toKubejojoLayout,
  type ElkGraph,
  type KubejojoLayout,
} from "./elk-layout";
import {
  KUBEJOJO_LAYOUT_METRICS,
  compareKubejojoNodes,
  eachKubejojo,
  getKubejojoWeight,
  leavesKubejojo,
  type KubejojoGraphNode,
  type KubejojoRelation,
  type KubejojoResource,
  type KubejojoSelectionPathItem,
} from "./graph-model";
import { groupKubejojoGraph, isBackboneRelation } from "./grouping";

export * from "./capacity";
export * from "./relations";
export * from "./topology-entry";
export * from "./viewport";
export * from "./graph-model";
export * from "./elk-layout";
export { groupKubejojoGraph } from "./grouping";
export { getElkEngine } from "./elk-engine";

/** How many children or inner relationships make a group collapse by default. */
export const KUBEJOJO_COLLAPSE_THRESHOLD = 10;

/** Layout results are reused for a short window instead of re-running ELK. */
export const KUBEJOJO_LAYOUT_CACHE_TTL_MS = 60_000;
export const KUBEJOJO_LAYOUT_CACHE_SIZE = 10;

const DEFAULT_ASPECT_RATIO = 1.6;

type CacheEntry = { layout: KubejojoLayout; timestamp: number };

const layoutCache = new Map<string, CacheEntry>();

/**
 * The partition column of a resource, expressed as its layout weight. Higher
 * values are drawn further left, which keeps the operator-facing order
 * Deployment -> ReplicaSet -> Pod -> Service -> Ingress.
 */
export function getKubejojoAccessPathOrder(node: KubejojoGraphNode): number {
  return getKubejojoWeight(node);
}

/**
 * ELK partition of a node. Identical to the access-path order, exposed under
 * the name the layout adapter uses.
 */
export function getKubejojoPartition(node: KubejojoGraphNode): number {
  return getKubejojoPartitionLayer(node);
}

export function getKubejojoLayoutPolicy(hasEdges: boolean, aspectRatio: number): {
  algorithm: "layered" | "rectpacking";
  direction: "UNDEFINED";
  aspectRatio: number;
} {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT_RATIO;
  return {
    algorithm: hasEdges ? "layered" : "rectpacking",
    direction: "UNDEFINED",
    aspectRatio: ratio,
  };
}

export { isBackboneRelation as isKubejojoBackboneRelation };

/** Kept for callers that only need the backbone/overlay split. */
export function partitionKubejojoRelations(relations: KubejojoRelation[]) {
  const backbone: KubejojoRelation[] = [];
  const overlays: KubejojoRelation[] = [];
  relations.forEach((relation) => {
    (isBackboneRelation(relation) ? backbone : overlays).push(relation);
  });
  const byId = (left: KubejojoRelation, right: KubejojoRelation) => left.id.localeCompare(right.id, "en");
  return { backbone: backbone.sort(byId), overlays: overlays.sort(byId) };
}

function findNodePath(
  root: KubejojoGraphNode,
  id?: string | null,
  ancestors: KubejojoGraphNode[] = [],
): KubejojoGraphNode[] | undefined {
  if (!id) return undefined;
  const path = [...ancestors, root];
  if (root.id === id) return path;
  for (const child of root.nodes ?? []) {
    const found = findNodePath(child, id, path);
    if (found) return found;
  }
  return undefined;
}

export function findKubejojoNode(root: KubejojoGraphNode, id?: string | null): KubejojoGraphNode | undefined {
  return findNodePath(root, id)?.at(-1);
}

function representedResourceCount(node: KubejojoGraphNode): number {
  return leavesKubejojo(node).reduce((count, leaf) => {
    if (!leaf.resource) return count;
    return count + (leaf.resource.aggregation?.memberCount ?? 1);
  }, 0);
}

/**
 * Root-to-selection path used by focus navigation and breadcrumbs. Unknown
 * selections resolve to the global root so the breadcrumb is never empty.
 */
export function getKubejojoSelectionPath(
  root: KubejojoGraphNode,
  selectedId?: string | null,
): KubejojoSelectionPathItem[] {
  const path = findNodePath(root, selectedId) ?? [root];
  return path.map((node) => ({
    id: node.id,
    label: node.label ?? node.resource?.name ?? node.id,
    subtitle: node.subtitle,
    kind: node.id === "root" ? "root" : node.groupKind ?? "resource",
    resourceCount: representedResourceCount(node),
  }));
}

/**
 * Applies Headlamp's collapse rule.
 *
 * A group folds when it holds more than ten children or carries its own
 * relationships, unless the operator expanded everything, the group sits on the
 * selected node's ancestor chain, or it is a direct child of the group that was
 * just opened. That last clause is Headlamp's `expandLargeGraph` behaviour: the
 * level an operator just entered renders its content instead of another row of
 * summary cards. Focusing a group promotes it to the canvas root so its members
 * become the visible scene.
 */
export function collapseKubejojoGraph(
  root: KubejojoGraphNode,
  focusedId?: string | null,
  expandAll = false,
): KubejojoGraphNode {
  const resolved = findKubejojoNode(root, focusedId);
  const selected = resolved && resolved.id !== "root" ? resolved : undefined;
  const ancestorIds = new Set(
    (findNodePath(root, selected?.id) ?? []).map((node) => node.id),
  );
  const revealedIds = new Set((selected?.nodes ?? []).map((node) => node.id));

  const clone = (node: KubejojoGraphNode): KubejojoGraphNode => {
    const isGroup = node.id !== "root" && Boolean(node.groupKind);
    const sizeable = (node.nodes?.length ?? 0) > KUBEJOJO_COLLAPSE_THRESHOLD
      || (node.edges?.length ?? 0) > 0;
    const collapsed = Boolean(
      !expandAll
      && isGroup
      && sizeable
      && !ancestorIds.has(node.id)
      && !revealedIds.has(node.id),
    );
    return {
      ...node,
      // Headlamp keeps the children on a collapsed group and treats `collapsed`
      // purely as a flag: the layout and the renderer skip them, but the
      // resource count, the health roll-up and the stacked-card cue still need
      // them. Dropping the array here silently turned every folded group into a
      // single-resource card.
      nodes: node.nodes?.map(clone),
      collapsed,
    };
  };

  const scene = selected && selected.groupKind
    ? { ...root, nodes: selected.nodes, edges: selected.edges, overlayEdges: selected.overlayEdges }
    : null;
  const visible = scene ?? (selected
    ? { ...root, nodes: [selected], edges: root.edges }
    : root);
  return clone(visible);
}

function cleanLayoutCache(now: number): void {
  layoutCache.forEach((entry, key) => {
    if (now - entry.timestamp > KUBEJOJO_LAYOUT_CACHE_TTL_MS) layoutCache.delete(key);
  });
  if (layoutCache.size <= KUBEJOJO_LAYOUT_CACHE_SIZE) return;
  [...layoutCache.entries()]
    .sort((left, right) => left[1].timestamp - right[1].timestamp)
    .slice(0, layoutCache.size - KUBEJOJO_LAYOUT_CACHE_SIZE)
    .forEach(([key]) => layoutCache.delete(key));
}

/** Test hook: cached layouts must never leak between suites. */
export function clearKubejojoLayoutCache(): void {
  layoutCache.clear();
}

/**
 * Runs the layered layout and converts the result for React Flow.
 *
 * The ELK pass is the most expensive step in the pipeline, so a short-lived
 * cache keeps group paging and re-renders instant. The key covers node ids,
 * collapse state, relationships and the canvas aspect ratio, which is
 * everything ELK reads.
 */
export async function layoutKubejojoGraph(
  root: KubejojoGraphNode,
  aspectRatio: number,
): Promise<{ nodes: Node<TopologyRendererNodeData>[]; edges: Edge<TopologyRendererEdgeData>[] }> {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT_RATIO;
  const cacheKey = getKubejojoCacheKey(root, ratio);
  const cached = layoutCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < KUBEJOJO_LAYOUT_CACHE_TTL_MS) {
    return cached.layout;
  }

  const laidOut = await getElkEngine().layout(toElkGraph(root), {
    layoutOptions: { "elk.aspectRatio": String(ratio) },
  });
  const layout = toKubejojoLayout(root, laidOut as ElkGraph);
  layoutCache.set(cacheKey, { layout, timestamp: Date.now() });
  cleanLayoutCache(Date.now());
  return layout;
}

export {
  KUBEJOJO_LAYOUT_METRICS,
  compareKubejojoNodes,
  eachKubejojo,
  getKubejojoWeight,
  leavesKubejojo,
};
export type { KubejojoGraphNode, KubejojoResource, KubejojoSelectionPathItem };
