import type {
  TopologyGraph,
  TopologyGroup,
  TopologyGroupBy,
  TopologyGroupResolver,
  TopologyRelation,
  TopologyRelationRole,
  TopologyResource,
  TopologyStatus,
  TopologyView,
  TopologyViewNode,
  TopologyViewRelation,
} from "./contract";

export interface AggregateRelation<TData = unknown> {
  id: string;
  source: string;
  target: string;
  role: TopologyRelationRole;
  label?: string;
  relationIds: readonly string[];
  count: number;
  data?: TData;
}

export interface BuildTopologyViewOptions<TNodeData = unknown> {
  groupBy?: TopologyGroupBy;
  groupResolver?: TopologyGroupResolver<TNodeData>;
  collapsedGroupIds?: ReadonlySet<string>;
  focusedResourceIds?: ReadonlySet<string>;
}

const STATUS_SEVERITY: Record<TopologyStatus, number> = {
  critical: 3,
  warning: 2,
  unknown: 1,
  healthy: 0,
};

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en");
}

function compareResources<TData>(left: TopologyResource<TData>, right: TopologyResource<TData>) {
  return (right.weight ?? 0) - (left.weight ?? 0) || compareText(left.label, right.label) || compareText(left.id, right.id);
}

function escapeGroupKey(key: string) {
  return encodeURIComponent(key);
}

function normalizeLabel(labels: readonly string[]) {
  const unique = Array.from(new Set(labels.filter(Boolean))).sort(compareText);
  return unique.length === 1 ? unique[0] : undefined;
}

export function getTopologyGroupResolver<TData>(
  groupBy: Exclude<TopologyGroupBy, "custom"> = "namespace",
): TopologyGroupResolver<TData> {
  const defaults: Record<Exclude<TopologyGroupBy, "custom">, Omit<TopologyGroupResolver<TData>, "getKey">> = {
    namespace: { id: "namespace", label: "Namespace" },
    source: { id: "source", label: "Source" },
    kind: { id: "kind", label: "Kind" },
  };
  const definition = defaults[groupBy];
  return {
    ...definition,
    getKey: (resource) => {
      if (groupBy === "namespace") return resource.namespace || "cluster";
      if (groupBy === "source") return resource.source || "unknown";
      return resource.kind || "unknown";
    },
  };
}

export function aggregateTopologyRelations<TData>(
  relations: readonly TopologyRelation<TData>[],
): readonly AggregateRelation<TData>[] {
  const buckets = new Map<string, TopologyRelation<TData>[]>();
  [...relations]
    .sort((left, right) => compareText(left.id, right.id))
    .forEach((relation) => {
      const key = `${relation.source}\u0000${relation.target}\u0000${relation.role}`;
      const existing = buckets.get(key);
      if (existing) existing.push(relation);
      else buckets.set(key, [relation]);
    });

  return Array.from(buckets.entries())
    .sort(([left], [right]) => compareText(left, right))
    .map(([, bucket]) => {
      const first = bucket[0];
      const relationIds = bucket.map((relation) => relation.id).sort(compareText);
      return {
        id: `aggregate:${first.role}:${first.source}->${first.target}`,
        source: first.source,
        target: first.target,
        role: first.role,
        label: normalizeLabel(bucket.map((relation) => relation.label ?? "")),
        relationIds,
        count: relationIds.length,
        data: first.data,
      };
    });
}

export function getTopologyGroups<TData>(
  resources: readonly TopologyResource<TData>[],
  resolver: TopologyGroupResolver<TData>,
): readonly TopologyGroup[] {
  const grouped = new Map<string, TopologyResource<TData>[]>();
  resources.forEach((resource) => {
    const key = resolver.getKey(resource);
    const entries = grouped.get(key);
    if (entries) entries.push(resource);
    else grouped.set(key, [resource]);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entries]) => ({
      id: `group:${resolver.id}:${escapeGroupKey(key)}`,
      key,
      label: resolver.getLabel?.(key) ?? key,
      resourceIds: [...entries].sort(compareResources).map((resource) => resource.id),
    }));
}

function getWorstStatus<TData>(resources: readonly TopologyResource<TData>[]): TopologyStatus {
  return resources.reduce<TopologyStatus>(
    (worst, resource) => (STATUS_SEVERITY[resource.status] > STATUS_SEVERITY[worst] ? resource.status : worst),
    "healthy",
  );
}

export function buildTopologyView<TNodeData, TRelationData>(
  graph: TopologyGraph<TNodeData, TRelationData>,
  options: BuildTopologyViewOptions<TNodeData> = {},
): TopologyView<TNodeData, TRelationData> {
  const resolver = options.groupResolver ?? getTopologyGroupResolver<TNodeData>(options.groupBy === "custom" ? "namespace" : options.groupBy);
  const resourceById = new Map(graph.resources.map((resource) => [resource.id, resource]));
  const groups = getTopologyGroups(graph.resources, resolver);
  const groupByResourceId = new Map(groups.flatMap((group) => group.resourceIds.map((resourceId) => [resourceId, group.id] as const)));
  const collapsedGroupIds = options.collapsedGroupIds ?? new Set<string>();
  const focusedResourceIds = options.focusedResourceIds ?? new Set<string>();
  const actuallyCollapsedGroupIds = new Set(
    groups
      .filter((group) => collapsedGroupIds.has(group.id) && !group.resourceIds.some((resourceId) => focusedResourceIds.has(resourceId)))
      .map((group) => group.id),
  );
  const visibleNodes: TopologyViewNode<TNodeData>[] = [];

  groups.forEach((group) => {
    const groupResources = group.resourceIds.flatMap((resourceId) => {
      const resource = resourceById.get(resourceId);
      return resource ? [resource] : [];
    });
    const isCollapsed = actuallyCollapsedGroupIds.has(group.id);
    if (isCollapsed) {
      visibleNodes.push({
        id: group.id,
        type: "group",
        label: group.label,
        subtitle: resolver.label,
        status: getWorstStatus(groupResources),
        group,
        hiddenChildCount: group.resourceIds.length,
      });
      return;
    }
    groupResources.forEach((resource) => {
      visibleNodes.push({
        id: resource.id,
        type: "resource",
        label: resource.label,
        subtitle: resource.subtitle,
        status: resource.status,
        resource,
      });
    });
  });

  const projectedRelations: TopologyRelation<TRelationData>[] = [];
  graph.relations.forEach((relation) => {
    if (!resourceById.has(relation.source) || !resourceById.has(relation.target)) return;
    const sourceGroupId = groupByResourceId.get(relation.source);
    const targetGroupId = groupByResourceId.get(relation.target);
    const source = sourceGroupId && actuallyCollapsedGroupIds.has(sourceGroupId) ? sourceGroupId : relation.source;
    const target = targetGroupId && actuallyCollapsedGroupIds.has(targetGroupId) ? targetGroupId : relation.target;
    if (source === target) return;
    projectedRelations.push({ ...relation, source, target });
  });

  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const relations: TopologyViewRelation<TRelationData>[] = aggregateTopologyRelations(projectedRelations)
    .filter((relation) => visibleNodeIds.has(relation.source) && visibleNodeIds.has(relation.target))
    .map((relation) => ({ ...relation }));

  return {
    nodes: visibleNodes.sort((left, right) => compareText(left.id, right.id)),
    relations,
    groups,
    focusedResourceIds: Array.from(focusedResourceIds).filter((id) => resourceById.has(id)).sort(compareText),
  };
}

export function getCollapsedGroupIds(groups: readonly TopologyGroup[]): ReadonlySet<string> {
  return new Set(groups.map((group) => group.id));
}
