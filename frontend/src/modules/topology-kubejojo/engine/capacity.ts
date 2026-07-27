export const TOPOLOGY_CAPACITY_LIMITS = {
  backend: { nodes: 10_000, edges: 30_000 },
  expanded: { nodes: 1_500, edges: 5_000 },
  defaultCanvas: { nodes: 600, edges: 2_000 },
  neighborhood: { nodes: 300, edges: 1_000 },
} as const;

export type TopologyCapacityMode = keyof typeof TOPOLOGY_CAPACITY_LIMITS;

export type TopologyAggregationLevel =
  | "namespace-instance-kind-component"
  | "namespace-instance-kind"
  | "namespace-instance"
  | "namespace-kind"
  | "namespace"
  | "kind-component"
  | "kind"
  | "component"
  | "cluster";

export interface CapacityResourceAggregation {
  entity: "resource";
  level: TopologyAggregationLevel;
  memberCount: number;
  representativeId: string;
  memberIds: string[];
  membersByKind: Record<string, number>;
  semanticKey: Record<string, string>;
}

export interface CapacityRelationAggregation {
  entity: "relation";
  memberCount: number;
  membersByType: Record<string, number>;
  internal: boolean;
}

export interface TopologyCapacityMetadata {
  mode: TopologyCapacityMode;
  strategy: "none" | "semantic-aggregation";
  complete: boolean;
  limits: { nodes: number; edges: number };
  input: { nodes: number; edges: number };
  visible: { nodes: number; edges: number };
  represented: { nodes: number; edges: number };
  aggregation: {
    level: TopologyAggregationLevel | null;
    resourceGroups: number;
    resourceMembers: number;
    relationGroups: number;
    relationMembers: number;
  };
  omitted: { nodes: number; edges: number; byKind: Record<string, number> };
}

export interface CapacityResource {
  id: string;
  kind?: string;
  namespace?: string | null;
  instanceName?: string | null;
  weight?: number;
  status?: string;
  warnings?: string[] | number;
  aggregation?: CapacityResourceAggregation;
}

export interface CapacityRelation {
  id: string;
  source: string;
  target: string;
  type?: string;
  role?: string;
  label?: string;
  aggregation?: CapacityRelationAggregation;
}

export type ProjectedCapacityResource<TResource extends CapacityResource> = TResource & CapacityResource;
export type ProjectedCapacityRelation<TRelation extends CapacityRelation> = TRelation & CapacityRelation;

export interface TopologyCapacityProjection<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
> {
  resources: ProjectedCapacityResource<TResource>[];
  relations: ProjectedCapacityRelation<TRelation>[];
  capacity: TopologyCapacityMetadata;
}

type SemanticField = "namespace" | "instance" | "kind" | "component";

interface AggregationLevelDefinition {
  level: TopologyAggregationLevel;
  fields: readonly SemanticField[];
}

interface ProjectionCandidate<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
> {
  resources: ProjectedCapacityResource<TResource>[];
  relations: ProjectedCapacityRelation<TRelation>[];
  level: TopologyAggregationLevel;
  resourceGroups: number;
  resourceMembers: number;
  relationGroups: number;
  relationMembers: number;
}

const AGGREGATION_LEVELS: readonly AggregationLevelDefinition[] = [
  { level: "namespace-instance-kind-component", fields: ["namespace", "instance", "kind", "component"] },
  { level: "namespace-instance-kind", fields: ["namespace", "instance", "kind"] },
  { level: "namespace-instance", fields: ["namespace", "instance"] },
  { level: "namespace-kind", fields: ["namespace", "kind"] },
  { level: "namespace", fields: ["namespace"] },
  { level: "kind-component", fields: ["kind", "component"] },
  { level: "kind", fields: ["kind"] },
  { level: "component", fields: ["component"] },
  { level: "cluster", fields: [] },
];

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id, "en");
}

function compareResources(left: CapacityResource, right: CapacityResource): number {
  const weightDelta = (right.weight ?? 0) - (left.weight ?? 0);
  return weightDelta || compareIds(left, right);
}

function normalizedValue(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function resourceKind(resource: CapacityResource): string {
  return normalizedValue(resource.kind, "Unknown");
}

function relationKind(relation: CapacityRelation): string {
  return normalizedValue(relation.type, normalizedValue(relation.role, normalizedValue(relation.label, "Relation")));
}

function countByKind(resources: readonly CapacityResource[]): Record<string, number> {
  return resources.reduce<Record<string, number>>((counts, resource) => {
    const kind = resourceKind(resource);
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
}

function countRelationsByType(relations: readonly CapacityRelation[]): Record<string, number> {
  return relations.reduce<Record<string, number>>((counts, relation) => {
    const type = relationKind(relation);
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
}

type CapacityStatus = "healthy" | "warning" | "critical" | "unknown";

const STATUS_PRIORITY: Record<CapacityStatus, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  critical: 3,
};

function normalizedStatus(resource: CapacityResource): CapacityStatus | undefined {
  const status = resource.status?.trim().toLowerCase();
  const warningCount = Array.isArray(resource.warnings) ? resource.warnings.length : resource.warnings ?? 0;
  if (["error", "failed", "failure", "unhealthy", "critical"].includes(status ?? "")) return "critical";
  if (warningCount > 0 || ["warning", "pending", "degraded"].includes(status ?? "")) return "warning";
  if (["unknown", "unavailable"].includes(status ?? "")) return "unknown";
  return status ? "healthy" : undefined;
}

function aggregateResourceHealth(resources: readonly CapacityResource[]) {
  const statuses = resources.flatMap((resource) => {
    const status = normalizedStatus(resource);
    return status ? [status] : [];
  });
  const status = statuses.sort((left, right) => STATUS_PRIORITY[right] - STATUS_PRIORITY[left])[0];
  const arrayWarnings = resources.flatMap((resource) => Array.isArray(resource.warnings) ? resource.warnings : []);
  const numericWarnings = resources.reduce(
    (total, resource) => total + (typeof resource.warnings === "number" ? resource.warnings : 0),
    0,
  );
  return {
    ...(status ? { status } : {}),
    ...(arrayWarnings.length
      ? { warnings: [...new Set(arrayWarnings)] }
      : numericWarnings > 0
        ? { warnings: numericWarnings }
        : {}),
  };
}

function connectedComponents(
  resources: readonly CapacityResource[],
  relations: readonly CapacityRelation[],
): Map<string, string> {
  const knownIds = new Set(resources.map((resource) => resource.id));
  const adjacent = new Map<string, Set<string>>();
  resources.forEach((resource) => adjacent.set(resource.id, new Set()));
  relations.forEach((relation) => {
    if (!knownIds.has(relation.source) || !knownIds.has(relation.target)) return;
    adjacent.get(relation.source)!.add(relation.target);
    adjacent.get(relation.target)!.add(relation.source);
  });

  const componentById = new Map<string, string>();
  [...resources].sort(compareIds).forEach((start) => {
    if (componentById.has(start.id)) return;
    const members: string[] = [];
    const seen = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      [...(adjacent.get(current) ?? [])].sort((left, right) => left.localeCompare(right, "en")).forEach((next) => {
        if (seen.has(next)) return;
        seen.add(next);
        queue.push(next);
      });
    }
    const componentId = members.sort((left, right) => left.localeCompare(right, "en"))[0];
    members.forEach((id) => componentById.set(id, componentId));
  });
  return componentById;
}

function semanticValues(resource: CapacityResource, componentById: Map<string, string>): Record<SemanticField, string> {
  return {
    namespace: normalizedValue(resource.namespace, "_cluster"),
    instance: normalizedValue(resource.instanceName, "_unassigned"),
    kind: resourceKind(resource),
    component: componentById.get(resource.id) ?? resource.id,
  };
}

function aggregationKey(
  resource: CapacityResource,
  definition: AggregationLevelDefinition,
  componentById: Map<string, string>,
): { key: string; semanticKey: Record<string, string> } {
  const values = semanticValues(resource, componentById);
  const semanticKey = Object.fromEntries(definition.fields.map((field) => [field, values[field]]));
  const key = definition.fields.length
    ? definition.fields.map((field) => `${field}=${values[field]}`).join("|")
    : "cluster=all";
  return { key, semanticKey };
}

function stableAggregateId(entity: "resource" | "relation", level: string, key: string): string {
  return `capacity:${entity}:${level}:${encodeURIComponent(key)}`;
}

function aggregateLabel(level: TopologyAggregationLevel, semanticKey: Record<string, string>, memberCount: number): string {
  const scope = Object.values(semanticKey).filter((value) => !value.startsWith("_")).join(" / ");
  return scope ? `${scope} (${memberCount})` : `${level} (${memberCount})`;
}

function buildCandidate<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
>(
  resources: readonly TResource[],
  relations: readonly TRelation[],
  definition: AggregationLevelDefinition,
  componentById: Map<string, string>,
  pinnedIds: Set<string>,
  preserveRelationSemantics: boolean,
): ProjectionCandidate<TResource, TRelation> {
  const orderedResources = [...resources].sort(compareResources);
  const groups = new Map<string, { semanticKey: Record<string, string>; members: TResource[] }>();
  orderedResources.forEach((resource) => {
    if (pinnedIds.has(resource.id)) return;
    const { key, semanticKey } = aggregationKey(resource, definition, componentById);
    const group = groups.get(key) ?? { semanticKey, members: [] };
    group.members.push(resource);
    groups.set(key, group);
  });

  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const visibleByOriginalId = new Map<string, string>();
  const projectedResources: ProjectedCapacityResource<TResource>[] = orderedResources
    .filter((resource) => pinnedIds.has(resource.id))
    .map((resource) => {
      visibleByOriginalId.set(resource.id, resource.id);
      return resource;
    });
  let resourceGroups = 0;
  let resourceMembers = 0;

  [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).forEach(([key, group]) => {
    if (group.members.length === 1) {
      const resource = group.members[0];
      visibleByOriginalId.set(resource.id, resource.id);
      projectedResources.push(resource);
      return;
    }
    const id = stableAggregateId("resource", definition.level, key);
    const memberCount = group.members.length;
    const representative = [...group.members].sort(compareResources)[0];
    const aggregateHealth = aggregateResourceHealth(group.members);
    const aggregation: CapacityResourceAggregation = {
      entity: "resource",
      level: definition.level,
      memberCount,
      representativeId: representative.id,
      memberIds: group.members.map((resource) => resource.id),
      membersByKind: countByKind(group.members),
      semanticKey: group.semanticKey,
    };
    const aggregate = {
      ...representative,
      ...aggregateHealth,
      id,
      kind: "Aggregate",
      name: aggregateLabel(definition.level, group.semanticKey, memberCount),
      namespace: definition.fields.includes("namespace") ? representative.namespace : null,
      instanceName: definition.fields.includes("instance") ? representative.instanceName : null,
      weight: Math.max(...group.members.map((resource) => resource.weight ?? 0)),
      aggregation,
    } as unknown as TResource;
    group.members.forEach((resource) => visibleByOriginalId.set(resource.id, id));
    projectedResources.push(aggregate);
    resourceGroups += 1;
    resourceMembers += memberCount;
  });

  const relationGroups = new Map<string, { source: string; target: string; members: TRelation[] }>();
  [...relations].sort(compareIds).forEach((relation) => {
    if (!resourcesById.has(relation.source) || !resourcesById.has(relation.target)) return;
    const source = visibleByOriginalId.get(relation.source)!;
    const target = visibleByOriginalId.get(relation.target)!;
    const semantics = preserveRelationSemantics ? relationKind(relation) : "all";
    const key = `${source}->${target}|${semantics}`;
    const group = relationGroups.get(key) ?? { source, target, members: [] };
    group.members.push(relation);
    relationGroups.set(key, group);
  });

  let aggregatedRelationGroups = 0;
  let relationMembers = 0;
  const projectedRelations: ProjectedCapacityRelation<TRelation>[] = [...relationGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, group]) => {
      const original = group.members[0];
      const endpointChanged = original.source !== group.source || original.target !== group.target;
      if (group.members.length === 1 && !endpointChanged) return original;
      const aggregation: CapacityRelationAggregation = {
        entity: "relation",
        memberCount: group.members.length,
        membersByType: countRelationsByType(group.members),
        internal: group.source === group.target,
      };
      aggregatedRelationGroups += 1;
      relationMembers += group.members.length;
      return {
        ...original,
        id: stableAggregateId("relation", definition.level, key),
        source: group.source,
        target: group.target,
        aggregation,
      } as TRelation;
    });

  return {
    resources: projectedResources.sort(compareResources),
    relations: projectedRelations.sort(compareIds),
    level: definition.level,
    resourceGroups,
    resourceMembers,
    relationGroups: aggregatedRelationGroups,
    relationMembers,
  };
}

function capacityMetadata(
  mode: TopologyCapacityMode,
  input: { nodes: number; edges: number },
  visible: { nodes: number; edges: number },
  options: {
    strategy: TopologyCapacityMetadata["strategy"];
    level?: TopologyAggregationLevel;
    resourceGroups?: number;
    resourceMembers?: number;
    relationGroups?: number;
    relationMembers?: number;
    omittedEdges?: number;
  },
): TopologyCapacityMetadata {
  const limits = TOPOLOGY_CAPACITY_LIMITS[mode];
  const omittedEdges = options.omittedEdges ?? 0;
  return {
    mode,
    strategy: options.strategy,
    complete: options.strategy === "none" && omittedEdges === 0,
    limits: { nodes: limits.nodes, edges: limits.edges },
    input,
    visible,
    represented: { nodes: input.nodes, edges: input.edges - omittedEdges },
    aggregation: {
      level: options.level ?? null,
      resourceGroups: options.resourceGroups ?? 0,
      resourceMembers: options.resourceMembers ?? 0,
      relationGroups: options.relationGroups ?? 0,
      relationMembers: options.relationMembers ?? 0,
    },
    omitted: { nodes: 0, edges: omittedEdges, byKind: {} },
  };
}

/**
 * Deterministically projects a graph into a rendering budget. Every valid
 * input resource and relation is represented either directly or by a semantic
 * aggregate. Granularity is reduced only until both capacity limits fit.
 */
export function applyTopologyCapacity<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
>(
  resources: readonly TResource[],
  relations: readonly TRelation[],
  mode: TopologyCapacityMode,
  options: { pinnedIds?: Iterable<string>; maxVisibleNodes?: number } = {},
): TopologyCapacityProjection<TResource, TRelation> {
  const limits = TOPOLOGY_CAPACITY_LIMITS[mode];
  const nodeLimit = Math.max(
    1,
    Math.min(limits.nodes, Math.floor(options.maxVisibleNodes ?? limits.nodes)),
  );
  const pinnedIds = new Set(options.pinnedIds ?? []);
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const validPinnedIds = [...pinnedIds].filter((id) => resourceIds.has(id));
  if (validPinnedIds.length > nodeLimit) {
    throw new RangeError(`Topology capacity cannot preserve ${validPinnedIds.length} pinned resources within the ${nodeLimit}-node ${mode} resource budget.`);
  }

  const orderedResources = [...resources].sort((left, right) => {
    const pinDelta = Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id));
    return pinDelta || compareResources(left, right);
  });
  const validRelations = relations
    .filter((relation) => resourceIds.has(relation.source) && resourceIds.has(relation.target))
    .sort(compareIds);
  const omittedEdges = relations.length - validRelations.length;
  if (orderedResources.length <= nodeLimit && validRelations.length <= limits.edges && omittedEdges === 0) {
    return {
      resources: orderedResources,
      relations: validRelations,
      capacity: capacityMetadata(
        mode,
        { nodes: resources.length, edges: relations.length },
        { nodes: orderedResources.length, edges: validRelations.length },
        { strategy: "none" },
      ),
    };
  }

  const componentById = connectedComponents(resources, validRelations);
  const definitions = AGGREGATION_LEVELS.flatMap((definition) => [
    { definition, preserveRelationSemantics: true },
    ...(definition.level === "cluster" ? [{ definition, preserveRelationSemantics: false }] : []),
  ]);
  for (const { definition, preserveRelationSemantics } of definitions) {
    const candidate = buildCandidate(
      resources,
      validRelations,
      definition,
      componentById,
      pinnedIds,
      preserveRelationSemantics,
    );
    if (candidate.resources.length > nodeLimit || candidate.relations.length > limits.edges) continue;
    return {
      resources: candidate.resources,
      relations: candidate.relations,
      capacity: capacityMetadata(
        mode,
        { nodes: resources.length, edges: relations.length },
        { nodes: candidate.resources.length, edges: candidate.relations.length },
        {
          strategy: "semantic-aggregation",
          level: candidate.level,
          resourceGroups: candidate.resourceGroups,
          resourceMembers: candidate.resourceMembers,
          relationGroups: candidate.relationGroups,
          relationMembers: candidate.relationMembers,
          omittedEdges,
        },
      ),
    };
  }

  throw new RangeError(`Topology capacity cannot preserve the pinned topology within the ${nodeLimit}-resource/${limits.edges}-edge ${mode} budget.`);
}

export function projectTopologyNeighborhood<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
>(
  resources: readonly TResource[],
  relations: readonly TRelation[],
  focusId: string,
  depth = 1,
): TopologyCapacityProjection<TResource, TRelation> {
  const adjacent = new Map<string, Set<string>>();
  relations.forEach((relation) => {
    adjacent.set(relation.source, (adjacent.get(relation.source) ?? new Set()).add(relation.target));
    adjacent.set(relation.target, (adjacent.get(relation.target) ?? new Set()).add(relation.source));
  });
  const selected = new Set([focusId]);
  let frontier = [focusId];
  for (let level = 0; level < Math.max(0, depth); level += 1) {
    const next = new Set<string>();
    frontier.sort((left, right) => left.localeCompare(right, "en")).forEach((id) => {
      [...(adjacent.get(id) ?? [])].sort((left, right) => left.localeCompare(right, "en")).forEach((neighbor) => {
        if (!selected.has(neighbor)) next.add(neighbor);
      });
    });
    next.forEach((id) => selected.add(id));
    frontier = [...next];
  }
  return applyTopologyCapacity(
    resources.filter((resource) => selected.has(resource.id)),
    relations.filter((relation) => selected.has(relation.source) && selected.has(relation.target)),
    "neighborhood",
    { pinnedIds: [focusId] },
  );
}
