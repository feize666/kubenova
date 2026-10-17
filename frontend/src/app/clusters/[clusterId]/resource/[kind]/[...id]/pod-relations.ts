import type { WorkloadListItem, WorkloadListResponse } from "@/lib/api/workloads";

type RelationItem = Partial<WorkloadListItem> & {
  kind?: string;
  name?: string;
  namespace?: string;
  clusterId?: string;
  uid?: string;
  labels?: Record<string, string>;
  statusJson?: Record<string, unknown>;
  ownerRefs?: unknown[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function refs(item: RelationItem): Record<string, unknown>[] {
  const status = object(item.statusJson);
  const values = item.ownerRefs ?? status.ownerRefs ?? status.ownerReferences ?? object(status.metadata).ownerReferences;
  const valuesAsObjects = Array.isArray(values) ? values.map(object) : [];
  const controllers = valuesAsObjects.filter(ref => ref.controller === true);
  return controllers.length ? controllers : valuesAsObjects;
}

function uid(item: RelationItem): string {
  return String(item.uid ?? object(item.statusJson).uid ?? "");
}

function sameScope(left: RelationItem, right: RelationItem): boolean {
  return left.namespace === right.namespace && (!left.clusterId || !right.clusterId || left.clusterId === right.clusterId);
}

function refMatches(ref: Record<string, unknown>, target: RelationItem): boolean {
  if (String(ref.kind ?? "").toLowerCase() !== String(target.kind ?? "").toLowerCase()) return false;
  if (String(ref.name ?? "") !== String(target.name ?? "")) return false;
  const refUid = String(ref.uid ?? "");
  return !refUid || !uid(target) || refUid === uid(target);
}

export function selectorMatches(labels: Record<string, string>, selector: unknown): boolean {
  const raw = object(selector);
  const matchLabels = object(raw.matchLabels ?? ("matchExpressions" in raw ? {} : raw));
  const expressions = Array.isArray(raw.matchExpressions) ? raw.matchExpressions.map(object) : [];
  if (!Object.keys(matchLabels).length && !expressions.length) return false;
  if (!Object.entries(matchLabels).every(([key, value]) => typeof value === "string" && labels[key] === value)) return false;
  return expressions.every((expression) => {
    const key = String(expression.key ?? "");
    const values = Array.isArray(expression.values) ? expression.values.map(String) : [];
    switch (expression.operator) {
      case "In": return key in labels && values.includes(labels[key]);
      case "NotIn": return !values.includes(labels[key]);
      case "Exists": return key in labels;
      case "DoesNotExist": return !(key in labels);
      default: return false;
    }
  });
}

export function belongsToOwner(pod: RelationItem, owner: RelationItem, resources: RelationItem[]): boolean {
  if (!sameScope(pod, owner)) return false;
  const visited = new Set<string>();
  const visit = (item: RelationItem): boolean => {
    const itemKey = `${item.kind}:${item.namespace}:${item.name}:${uid(item)}`;
    if (visited.has(itemKey)) return false;
    visited.add(itemKey);
    for (const ref of refs(item)) {
      if (refMatches(ref, owner)) return true;
      const next = resources.find(candidate => sameScope(candidate, item) && refMatches(ref, candidate));
      if (next && visit(next)) return true;
    }
    return false;
  };
  return visit(pod);
}

export async function collectPaginatedWorkloads(
  fetchPage: (page: number) => Promise<WorkloadListResponse>,
): Promise<WorkloadListItem[]> {
  const first = await fetchPage(1);
  const items = [...(first.items ?? [])];
  const pageSize = Math.max(1, first.pageSize || first.items?.length || 1);
  const pages = Math.max(1, Math.ceil((first.total || items.length) / pageSize));
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPage(page);
    items.push(...(next.items ?? []));
  }
  return items;
}
