import { getKubejojoRelationSemantics } from "./relations";
import {
  compareKubejojoNodes,
  getKubejojoWeight,
  leavesKubejojo,
  type KubejojoGraphNode,
  type KubejojoGroupBy,
  type KubejojoRelation,
  type KubejojoResource,
} from "./graph-model";

/** Pods without a scheduled node land in one visible bucket, as in Headlamp. */
export const UNSCHEDULED_NODE_GROUP = "未调度";

/**
 * Structural relationships decide which resources belong to the same workload.
 * Headlamp draws the component boundaries from its own relation types, and this
 * split is the equivalent: a Pod reading a ConfigMap must not merge two
 * otherwise independent workloads into one group.
 */
export function isBackboneRelation(relation: KubejojoRelation): boolean {
  const domain = getKubejojoRelationSemantics(relation.type, relation.role, relation.label).domain;
  return domain === "workload" || domain === "network" || domain === "storage";
}

export function partitionRelations(relations: KubejojoRelation[]): {
  backbone: KubejojoRelation[];
  overlays: KubejojoRelation[];
} {
  const backbone: KubejojoRelation[] = [];
  const overlays: KubejojoRelation[] = [];
  relations.forEach((relation) => {
    (isBackboneRelation(relation) ? backbone : overlays).push(relation);
  });
  const byId = (left: KubejojoRelation, right: KubejojoRelation) => left.id.localeCompare(right.id, "en");
  return { backbone: backbone.sort(byId), overlays: overlays.sort(byId) };
}

/** Builds a stable leaf node for one resource. */
export function makeResourceNode(resource: KubejojoResource): KubejojoGraphNode {
  return {
    id: resource.id,
    label: resource.name,
    subtitle: resource.kind,
    resource,
    weight: resource.weight,
  };
}

function byId(left: KubejojoRelation, right: KubejojoRelation): number {
  return left.id.localeCompare(right.id, "en");
}

/** Relationships with both endpoints inside `ids`. */
function relationsWithin(
  relations: readonly KubejojoRelation[],
  ids: ReadonlySet<string>,
): KubejojoRelation[] {
  return relations
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .sort(byId);
}

/**
 * Weakly connected components over the structural relationships.
 *
 * Every relationship is kept on the resulting node, so a component still draws
 * its storage and configuration dependencies; only the component boundary is
 * derived from structural edges.
 */
function weakComponents(
  nodes: KubejojoGraphNode[],
  backbone: readonly KubejojoRelation[],
  allRelations: readonly KubejojoRelation[],
): KubejojoGraphNode[] {
  const byNodeId = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, string[]>();
  backbone.forEach((edge) => {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  });

  const seen = new Set<string>();
  return nodes.flatMap<KubejojoGraphNode>((start) => {
    if (seen.has(start.id)) return [];
    const ids = new Set<string>();
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      ids.add(id);
      [...(adjacent.get(id) ?? [])]
        .sort((left, right) => left.localeCompare(right, "en"))
        .forEach((next) => {
          if (seen.has(next)) return;
          seen.add(next);
          queue.push(next);
        });
    }
    const members = [...ids]
      .flatMap((id) => (byNodeId.get(id) ? [byNodeId.get(id)!] : []))
      .sort(compareKubejojoNodes);
    const edges = relationsWithin(allRelations, ids);
    if (members.length === 1) return [{ ...members[0], edges }];
    return [{
      id: `component:${members[0].id}`,
      label: members[0].label ?? members[0].resource?.name ?? "关联组件",
      subtitle: `${members.length} 个关联资源`,
      nodes: members,
      edges,
      groupKind: "component" as const,
      weight: getKubejojoWeight(members[0]),
    }];
  });
}

/**
 * The property that decides which group a component belongs to. Grouping by
 * node falls back to a sentinel so pending Pods stay visible instead of
 * silently dropping out of the map.
 */
function componentGroupKey(component: KubejojoGraphNode, groupBy: KubejojoGroupBy): string {
  if (groupBy === "namespace") {
    const named = leavesKubejojo(component)
      .find((leaf) => leaf.resource?.namespace?.trim());
    return named?.resource?.namespace?.trim() ?? "";
  }
  if (groupBy === "node") {
    const scheduled = leavesKubejojo(component)
      .find((leaf) => leaf.resource?.nodeName?.trim());
    return scheduled?.resource?.nodeName?.trim() || UNSCHEDULED_NODE_GROUP;
  }
  const instanced = leavesKubejojo(component)
    .find((leaf) => leaf.resource?.instanceName?.trim());
  return instanced?.resource?.instanceName?.trim() ?? "";
}

function groupSubtitle(groupBy: KubejojoGroupBy): string {
  if (groupBy === "node") return "节点";
  if (groupBy === "namespace") return "命名空间";
  return "实例";
}

function groupLabel(key: string, groupBy: KubejojoGroupBy): string {
  if (key) return key;
  if (groupBy === "node") return UNSCHEDULED_NODE_GROUP;
  if (groupBy === "namespace") return "集群级资源";
  return "未归属实例";
}

/**
 * Builds the resource map: connected components first, then one container per
 * group value. This is Headlamp's `groupGraph` shape, minus the namespace object
 * lookup KubeNova does not need.
 */
export function groupKubejojoGraph(
  resources: readonly KubejojoResource[],
  relations: readonly KubejojoRelation[],
  groupBy: KubejojoGroupBy,
): KubejojoGraphNode {
  const partitioned = partitionRelations([...relations]);
  const nodes = [...resources]
    .sort((left, right) => (left.identityKey ?? left.id).localeCompare(right.identityKey ?? right.id, "en"))
    .map(makeResourceNode);
  const components = weakComponents(nodes, partitioned.backbone, relations);
  // === History ReplicaSet aggregation ===
  // Detect RS with zero members that have active siblings under the same parent
  const historyRsIds = new Set<string>();
  const rsByParent = new Map<string, KubejojoGraphNode[]>();
  const nonHistoryComponents: KubejojoGraphNode[] = [];
  
  for (const component of components) {
    const leaves = leavesKubejojo(component);
    
    for (const leaf of leaves) {
      if (leaf.resource?.kind === "ReplicaSet") {
        const parentKey = leaf.resource?.instanceName ?? leaf.resource?.namespace ?? "";
        const siblings = rsByParent.get(parentKey) ?? [];
        siblings.push(leaf);
        rsByParent.set(parentKey, siblings);
      }
    }
    nonHistoryComponents.push(component);
  }
  
  // Mark zero-member RS as historical when there's an active sibling
  for (const [, siblings] of rsByParent) {
    if (siblings.length <= 1) continue;
    const hasActive = siblings.some((n) => (n.resource?.aggregation?.memberCount ?? 0) > 0);
    if (!hasActive) continue;
    for (const n of siblings) {
      if ((n.resource?.aggregation?.memberCount ?? 0) === 0) historyRsIds.add(n.id);
    }
  }
  
  // Wrap historical RS in a "历史版本" component per parent
  const processedComponents: typeof components = [];
  const historyGroups = new Map<string, KubejojoGraphNode[]>();
  
  // Collect history RS by parent key
  for (const component of nonHistoryComponents) {
    // A disconnected resource is itself a component, not an empty container.
    if (component.resource) {
      processedComponents.push(component);
      continue;
    }
    const activeNodes: KubejojoGraphNode[] = [];
    for (const node of component.nodes ?? []) {
      if (historyRsIds.has(node.id)) {
        const parentKey = node.resource?.instanceName ?? node.resource?.namespace ?? "";
        const group = historyGroups.get(parentKey) ?? [];
        group.push(node);
        historyGroups.set(parentKey, group);
      } else {
        activeNodes.push(node);
      }
    }
    
    if (activeNodes.length) {
      processedComponents.push({
        ...component,
        nodes: activeNodes,
        edges: (component.edges ?? []).filter(
          (e) => !historyRsIds.has(e.source) && !historyRsIds.has(e.target)
        ),
        label: activeNodes[0]?.label ?? component.label,
      });
    }
  }
  
  // Add history groups as components
  for (const [parentKey, nodes] of historyGroups) {
    if (!nodes.length) continue;
    const historyNode: KubejojoGraphNode = {
      id: `history-rs:${parentKey}`,
      label: "历史版本",
      subtitle: `${nodes.length} 个旧 ReplicaSet`,
      nodes: nodes.sort(compareKubejojoNodes),
      edges: [],
      groupKind: "component",
      collapsedPreferred: true,
      weight: 960,
    };
    processedComponents.push(historyNode);
  }
  
  const finalComponents = processedComponents.length ? processedComponents : components;
  
  // === Shared resource dedup ===
  // Track resources seen across components; mark duplicates
  const seenResourceIds = new Set<string>();
  const dedupedComponents = finalComponents.map((component) => {
    if (component.resource) {
      seenResourceIds.add(component.resource.id);
      return component;
    }
    const dedupedNodes = (component.nodes ?? []).filter((node) => {
      if (!node.resource) return true;
      const rid = node.resource.id;
      if (seenResourceIds.has(rid)) {
        // Mark as shared reference
        return false;
      }
      seenResourceIds.add(rid);
      return true;
    });
    
    // Check if this is a shared resource (connected from multiple components)
    const isShared = component.nodes && component.nodes.length === 1 && 
      component.nodes[0].resource && 
      (component.edges ?? []).length > 0;
    
    return {
      ...component,
      nodes: dedupedNodes,
      subtitle: isShared && component.nodes?.[0]?.resource
        ? (component.subtitle ?? "") + " · 共享"
        : component.subtitle,
    };
  }).filter((component) => component.resource || (component.nodes ?? []).length > 0);


  const byGroup = new Map<string, KubejojoGraphNode[]>();
  dedupedComponents.forEach((component) => {
    const key = componentGroupKey(component, groupBy);
    byGroup.set(key, [...(byGroup.get(key) ?? []), component]);
  });

  const root: KubejojoGraphNode = { id: "root", label: "全局拓扑", nodes: [], edges: [] };
  [...byGroup.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .forEach(([key, groupComponents]) => {
      const memberIds = new Set(
        groupComponents.flatMap((component) => leavesKubejojo(component).map((leaf) => leaf.id)),
      );
      root.nodes!.push({
        id: `group:${groupBy}:${encodeURIComponent(key)}`,
        label: groupLabel(key, groupBy),
        subtitle: groupSubtitle(groupBy),
        nodes: groupComponents.sort(compareKubejojoNodes),
        edges: relationsWithin(relations, memberIds),
        groupKind: "scope",
        collapsedPreferred: true,
        weight: Math.max(...groupComponents.map(getKubejojoWeight), 0),
      });
    });

  return root;
}
