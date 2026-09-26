import { applyTopologyCapacity, type CapacityRelation, type CapacityResource, type TopologyCapacityProjection } from "./capacity";

export type ResourceDomain = "workloads" | "storage" | "cluster" | "network" | "security" | "configuration" | "custom";
export const RESOURCE_DOMAINS: readonly ResourceDomain[] = ["workloads", "storage", "cluster", "network", "security", "configuration", "custom"];
const DOMAIN_BY_SOURCE: Record<string, ResourceDomain> = { workloads: "workloads", storage: "storage", cluster: "cluster", network: "network", security: "security", configuration: "configuration" };
export function classifyResourceDomain(resource: { source?: string | null; kind?: string | null }): ResourceDomain {
  return DOMAIN_BY_SOURCE[resource.source ?? ""] ?? (resource.kind === "Namespace" || resource.kind === "Node" ? "cluster" : "custom");
}

export function filterTopologyGraph<
  T extends { id: string; source?: string | null; kind?: string | null },
  R extends { source: string; target: string },
>(resources: readonly T[], relations: readonly R[], domains: ReadonlySet<ResourceDomain>) {
  const visible = resources.filter((resource) => domains.has(classifyResourceDomain(resource)));
  const ids = new Set(visible.map((resource) => resource.id));
  return { resources: visible, relations: relations.filter((relation) => ids.has(relation.source) && ids.has(relation.target)) };
}

export type TopologyUrlState = { namespace?: string; domains: ResourceDomain[]; search?: string; groupBy: "namespace" | "instance" | "node" };
export function parseTopologyUrlState(input: string | URLSearchParams): TopologyUrlState {
  const params = typeof input === "string" ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input) : input;
  const domains = (params.get("domains") ?? "").split(",").filter((domain): domain is ResourceDomain => (RESOURCE_DOMAINS as readonly string[]).includes(domain));
  const groupBy = params.get("groupBy");
  return {
    namespace: params.get("namespace") || undefined,
    domains: domains.length ? domains : [...RESOURCE_DOMAINS],
    search: params.get("search") || undefined,
    groupBy: groupBy === "instance" || groupBy === "node" ? groupBy : "namespace",
  };
}
export function serializeTopologyUrlState(state: TopologyUrlState): string {
  const params = new URLSearchParams();
  if (state.namespace) params.set("namespace", state.namespace);
  if (state.domains.length && state.domains.length < RESOURCE_DOMAINS.length) params.set("domains", state.domains.join(","));
  if (state.search) params.set("search", state.search);
  if (state.groupBy !== "namespace") params.set("groupBy", state.groupBy);
  return params.toString();
}

/** Resources that can start an operator-facing topology scene. */
export const TOPOLOGY_ROOT_KINDS = Object.freeze([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
] as const);

export type TopologyRootKind = (typeof TOPOLOGY_ROOT_KINDS)[number];
export type TopologyDisplayMode = "core" | "full";

const FORWARD_RELATIONS = new Set([
  "OWNS",
  "MOUNTS",
  "BINDS",
  "USES_STORAGE_CLASS",
  "USES_CONFIG",
  "USES_SECRET",
  "USES_SERVICE_ACCOUNT",
]);

const REVERSE_RELATIONS = new Set([
  "SELECTS",
  "PUBLISHES",
  "RESOLVES",
  "ROUTES_TO",
  "GOVERNS",
  "PROVISIONS",
  "ACCEPTS",
]);

const CORE_HIDDEN_KINDS = new Set([
  "PersistentVolumeClaim",
  "PersistentVolume",
  "StorageClass",
  "ConfigMap",
  "Secret",
  "ServiceAccount",
  "NetworkPolicy",
]);

export function isTopologyRootKind(kind?: string | null): kind is TopologyRootKind {
  return Boolean(kind && (TOPOLOGY_ROOT_KINDS as readonly string[]).includes(kind));
}

export function resolveTopologyRoot<TResource extends { id: string; kind?: string | null; name?: string | null; namespace?: string | null }>(
  resources: readonly TResource[],
  rootKind?: string | null,
  rootName?: string | null,
  namespace?: string | null,
): TResource | null {
  if (!isTopologyRootKind(rootKind) || !rootName?.trim()) return null;
  const expectedName = rootName.trim();
  const expectedNamespace = namespace?.trim() || null;
  return resources.find((resource) => (
    resource.kind === rootKind
    && resource.name === expectedName
    && (!expectedNamespace || resource.namespace === expectedNamespace)
  )) ?? null;
}

/**
 * Projects the complete connected resource chain for one workload. Namespace
 * is deliberately not a valid focus here; it remains a filter context only.
 */
export function projectTopologyRoot<
  TResource extends CapacityResource,
  TRelation extends CapacityRelation,
>(
  resources: readonly TResource[],
  relations: readonly TRelation[],
  rootId: string,
): TopologyCapacityProjection<TResource, TRelation> {
  const resourceIds = new Set(resources.map((resource) => resource.id));
  if (!resourceIds.has(rootId)) {
    return applyTopologyCapacity([], [], "neighborhood", { pinnedIds: [] });
  }

  const adjacent = new Map<string, TRelation[]>();
  relations.forEach((relation) => {
    if (!resourceIds.has(relation.source) || !resourceIds.has(relation.target)) return;
    adjacent.set(relation.source, [...(adjacent.get(relation.source) ?? []), relation]);
    adjacent.set(relation.target, [...(adjacent.get(relation.target) ?? []), relation]);
  });

  const selected = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    const linked = [...(adjacent.get(current) ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en"));
    for (const relation of linked) {
      const type = relation.type?.trim() ?? "";
      if (type === "GROUPS") continue;
      if (FORWARD_RELATIONS.has(type) && relation.source !== current) continue;
      if (REVERSE_RELATIONS.has(type) && relation.target !== current) continue;
      const neighbor = relation.source === current ? relation.target : relation.source;
      if (selected.has(neighbor)) continue;
      selected.add(neighbor);
      queue.push(neighbor);
    }
  }

  return applyTopologyCapacity(
    resources.filter((resource) => selected.has(resource.id)),
    relations.filter((relation) => selected.has(relation.source) && selected.has(relation.target)),
    "neighborhood",
    { pinnedIds: [rootId] },
  );
}

export function projectTopologyDisplayMode<
  TResource extends CapacityResource & { kind?: string | null },
  TRelation extends CapacityRelation,
>(
  resources: readonly TResource[],
  relations: readonly TRelation[],
  displayMode: TopologyDisplayMode,
): { resources: TResource[]; relations: TRelation[] } {
  if (displayMode === "full") {
    return { resources: [...resources], relations: [...relations] };
  }
  const visibleResources = resources.filter((resource) => !CORE_HIDDEN_KINDS.has(resource.kind?.trim() ?? ""));
  const visibleIds = new Set(visibleResources.map((resource) => resource.id));
  return {
    resources: visibleResources,
    relations: relations.filter((relation) => visibleIds.has(relation.source) && visibleIds.has(relation.target)),
  };
}
