import type { TopologyGraph, TopologyGraphNode, TopologyGroupBy, TopologyRelation } from "./contracts";
import { collectTopologyLeaves, getTopologyNodeWeight } from "./model";

const ROOT_ID = "topology-root";

function sorted(nodes: TopologyGraphNode[]): TopologyGraphNode[] {
  return [...nodes].sort((left, right) => getGroupSortWeight(right) - getGroupSortWeight(left) || left.id.localeCompare(right.id));
}

function getGroupSortWeight(node: TopologyGraphNode): number {
  const childWeight = Math.max(0, ...(node.children?.map(getGroupSortWeight) ?? []));
  return Math.max(getTopologyNodeWeight(node), childWeight) + (node.children?.length ?? 0) * 10 + (node.edges?.length ? 10_000 : 0);
}

export function getConnectedComponents(graph: TopologyGraph): TopologyGraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }

  const visited = new Set<string>();
  return graph.nodes.map((start) => {
    if (visited.has(start.id)) return undefined;
    const ids = new Set<string>();
    const queue = [start.id];
    visited.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      ids.add(id);
      for (const neighbour of adjacency.get(id) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    const nodes = sorted([...ids].map((id) => byId.get(id)!).filter(Boolean));
    if (nodes.length === 1) return nodes[0];
    const main = nodes[0];
    return { id: `component:${main.id}`, label: main.label, subtitle: "Component", children: nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }).filter((node): node is TopologyGraphNode => Boolean(node));
}

function groupKey(node: TopologyGraphNode, groupBy: TopologyGroupBy): string | undefined {
  const leaves = collectTopologyLeaves(node);
  const preferred = leaves.find((item) => item.resource?.kind === "Pod") ?? leaves[0];
  if (groupBy === "namespace") return preferred?.resource?.namespace ?? undefined;
  if (groupBy === "instance") return leaves[0] ? sorted(leaves)[0].resource?.instance ?? undefined : undefined;
  return preferred?.resource?.nodeName ?? undefined;
}

export function groupTopologyGraph(graph: TopologyGraph, groupBy?: TopologyGroupBy): TopologyGraphNode {
  const components = getConnectedComponents(graph);
  const children = !groupBy ? components : Array.from(components.reduce((groups, component) => {
    const key = groupKey(component, groupBy);
    const entries = groups.get(key ?? "") ?? [];
    entries.push(component);
    groups.set(key ?? "", entries);
    return groups;
  }, new Map<string, TopologyGraphNode[]>()).entries()).flatMap(([key, members]) => {
    if (!key) return members;
    return [{ id: `${groupBy}:${key}`, label: key, subtitle: groupBy, children: sorted(members), edges: [] }];
  });
  return { id: ROOT_ID, label: "Topology", children: sorted(children), edges: [...graph.edges] };
}

export function findTopologyNode(root: TopologyGraphNode, id: string): TopologyGraphNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findTopologyNode(child, id);
    if (found) return found;
  }
  return undefined;
}

export function findTopologyParent(root: TopologyGraphNode, id: string): TopologyGraphNode | undefined {
  if (root.children?.some((child) => child.id === id)) return root;
  for (const child of root.children ?? []) {
    const found = findTopologyParent(child, id);
    if (found) return found;
  }
  return undefined;
}

export function setTopologyGroupCollapsed(root: TopologyGraphNode, id: string, collapsed: boolean): TopologyGraphNode {
  return {
    ...root,
    collapsed: root.id === id && root.children?.length ? collapsed : root.collapsed,
    children: root.children?.map((child) => setTopologyGroupCollapsed(child, id, collapsed)),
  };
}

export function collapseTopologyGraph(root: TopologyGraphNode, options: { focusId?: string; expandAll?: boolean; threshold?: number } = {}): TopologyGraphNode {
  const focusPath = new Set<string>();
  for (let current = options.focusId ? findTopologyNode(root, options.focusId) : undefined; current; current = findTopologyParent(root, current.id)) focusPath.add(current.id);
  const threshold = options.threshold ?? 10;
  const collapse = (node: TopologyGraphNode): TopologyGraphNode => ({
    ...node,
    collapsed: Boolean(node.children?.length) && node.id !== ROOT_ID && !options.expandAll && !focusPath.has(node.id) && (node.children!.length > threshold || Boolean(node.edges?.length)),
    children: node.children?.map(collapse),
  });
  return collapse(root);
}

export function collectVisibleRelations(root: TopologyGraphNode): TopologyRelation[] {
  const relations: TopologyRelation[] = [];
  const seen = new Set<string>();
  const visit = (node: TopologyGraphNode) => {
    for (const edge of node.edges ?? []) if (!seen.has(edge.id)) {
      seen.add(edge.id);
      relations.push(edge);
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return relations;
}
