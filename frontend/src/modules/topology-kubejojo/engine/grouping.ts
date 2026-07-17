import type { GroupByMode, TopologyGraphEdge, TopologyGraphNode, TopologyResource } from "./contracts";
import { collectLeafNodes, forEachNode, getNodeWeight } from "./model";

type GraphLookup<TResource extends TopologyResource> = {
  nodeById: Map<string, TopologyGraphNode<TResource>>;
  outgoing: Map<string, TopologyGraphEdge[]>;
  incoming: Map<string, TopologyGraphEdge[]>;
};

function makeGraphLookup<TResource extends TopologyResource>(
  nodes: TopologyGraphNode<TResource>[],
  edges: TopologyGraphEdge[],
): GraphLookup<TResource> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, TopologyGraphEdge[]>();
  const incoming = new Map<string, TopologyGraphEdge[]>();
  edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  });
  return { nodeById, outgoing, incoming };
}

export function getMainNode<TResource extends TopologyResource>(
  nodes: TopologyGraphNode<TResource>[],
): TopologyGraphNode<TResource> | undefined {
  return nodes.reduce<TopologyGraphNode<TResource> | undefined>(
    (current, node) => (!current || getNodeWeight(node) > getNodeWeight(current) ? node : current),
    undefined,
  );
}

function connectedComponents<TResource extends TopologyResource>(
  nodes: TopologyGraphNode<TResource>[],
  edges: TopologyGraphEdge[],
): TopologyGraphNode<TResource>[] {
  const lookup = makeGraphLookup(nodes, edges);
  const visitedNodes = new Set<string>();
  const visitedEdges = new Set<string>();
  const components: TopologyGraphNode<TResource>[] = [];

  const visit = (
    node: TopologyGraphNode<TResource>,
    componentNodes: TopologyGraphNode<TResource>[],
    componentEdges: TopologyGraphEdge[],
  ) => {
    visitedNodes.add(node.id);
    componentNodes.push(node);
    for (const edge of [...(lookup.outgoing.get(node.id) ?? []), ...(lookup.incoming.get(node.id) ?? [])]) {
      if (!visitedEdges.has(edge.id)) {
        visitedEdges.add(edge.id);
        componentEdges.push(edge);
      }
      const nextId = edge.source === node.id ? edge.target : edge.source;
      const next = lookup.nodeById.get(nextId);
      if (next && !visitedNodes.has(next.id)) visit(next, componentNodes, componentEdges);
    }
  };

  nodes.forEach((node) => {
    if (visitedNodes.has(node.id)) return;
    const componentNodes: TopologyGraphNode<TResource>[] = [];
    const componentEdges: TopologyGraphEdge[] = [];
    visit(node, componentNodes, componentEdges);
    if (componentNodes.length === 1) {
      components.push(componentNodes[0]);
      return;
    }
    components.push({
      id: `group-${getMainNode(componentNodes)?.id ?? "unknown"}`,
      nodes: componentNodes,
      edges: componentEdges,
    });
  });
  return components;
}

function groupByProperty<TResource extends TopologyResource>(
  nodes: TopologyGraphNode<TResource>[],
  accessor: (node: TopologyGraphNode<TResource>) => string | null | undefined,
  label: string,
  allowSingleMemberGroup: boolean,
): TopologyGraphNode<TResource>[] {
  const groups = new Map<string, TopologyGraphNode<TResource>[]>();
  nodes.forEach((node) => {
    const key = accessor(node) ?? "undefined";
    groups.set(key, [...(groups.get(key) ?? []), node]);
  });
  return [...groups.entries()].flatMap(([key, members]) => {
    if (key === "undefined" || (members.length === 1 && !allowSingleMemberGroup)) return members;
    return [{ id: `${label}-${key}`, label: key, subtitle: label, nodes: members, edges: [] }];
  });
}

function findResourceValue<TResource extends TopologyResource>(
  node: TopologyGraphNode<TResource>,
  accessor: (resource: TResource) => string | null | undefined,
): string | null | undefined {
  const leaves = collectLeafNodes(node);
  const candidate = leaves.find((item) => item.resource?.kind === "Pod" && item.resource && accessor(item.resource) != null)
    ?? leaves.find((item) => item.resource && accessor(item.resource) != null);
  return candidate?.resource ? accessor(candidate.resource) : undefined;
}

export function groupGraph<TResource extends TopologyResource>(
  nodes: TopologyGraphNode<TResource>[],
  edges: TopologyGraphEdge[],
  options: { groupBy?: GroupByMode } = {},
): TopologyGraphNode<TResource> {
  let components = connectedComponents(nodes, edges);
  if (options.groupBy === "namespace") {
    components = groupByProperty(components, (node) => findResourceValue(node, (resource) => resource.namespace), "Namespace", true);
  } else if (options.groupBy === "node") {
    components = groupByProperty(components, (node) => findResourceValue(node, (resource) => resource.nodeName), "Node", true);
  } else if (options.groupBy === "instance") {
    components = groupByProperty(components, (node) => getMainNode(collectLeafNodes(node))?.resource?.instanceName, "Instance", false);
  }

  const root: TopologyGraphNode<TResource> = { id: "root", label: "root", nodes: components, edges: [] };
  forEachNode(root, (node) => {
    node.nodes?.sort((left, right) => {
      const weight = (value: TopologyGraphNode<TResource>) => getNodeWeight(value) + (value.edges?.length ? 10000 : 0) + (value.nodes?.length ?? 0) * 10;
      return weight(right) - weight(left);
    });
  });
  return root;
}

export function findGroupContaining<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
  id: string,
  strict = false,
): TopologyGraphNode<TResource> | undefined {
  if (graph.id === id && !strict) return graph;
  if (graph.nodes?.some((node) => node.id === id && (!strict || Boolean(node.nodes)))) return graph;
  for (const node of graph.nodes ?? []) {
    const found = findGroupContaining(node, id, strict);
    if (found) return found;
  }
  return undefined;
}

export function findFocusPath<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
  focusId?: string,
): Set<string> {
  const path = new Set<string>();
  if (!focusId) return path;
  const visit = (node: TopologyGraphNode<TResource>, ancestors: string[]): boolean => {
    if (node.id === focusId) {
      ancestors.forEach((id) => path.add(id));
      path.add(node.id);
      return true;
    }
    return (node.nodes ?? []).some((child) => visit(child, [...ancestors, node.id]));
  };
  visit(graph, []);
  return path;
}

export function collapseGraph<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
  {
    focusId,
    expandAll = false,
    threshold = 10,
    isolateFocus = true,
  }: { focusId?: string; expandAll?: boolean; threshold?: number; isolateFocus?: boolean } = {},
): TopologyGraphNode<TResource> {
  const selectedGroup = focusId ? findGroupContaining(graph, focusId) : undefined;
  const protectedIds = findFocusPath(graph, focusId);
  const initial = isolateFocus && selectedGroup && selectedGroup.id !== "root"
    ? { ...graph, nodes: [selectedGroup] }
    : graph;
  const visit = (node: TopologyGraphNode<TResource>): TopologyGraphNode<TResource> => {
    const isGroup = Boolean(node.nodes?.length);
    const isLarge = (node.nodes?.length ?? 0) > threshold || (node.edges?.length ?? 0) > 0;
    return {
      ...node,
      nodes: node.nodes?.map(visit),
      collapsed: isGroup && node.id !== "root" && !expandAll && isLarge && !protectedIds.has(node.id),
    };
  };
  return visit(initial);
}
