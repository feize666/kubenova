import type { TopologyFlowEdge, TopologyFlowNode, TopologyGraphNode, TopologyRelation, TopologyViewState } from "./contracts";
import { collectVisibleRelations } from "./grouping";

type VisibleNode = { node: TopologyGraphNode; parentId?: string };

function collectVisibleNodes(root: TopologyGraphNode): VisibleNode[] {
  const result: VisibleNode[] = [];
  const visit = (node: TopologyGraphNode, parentId?: string) => {
    if (node.id !== "topology-root") result.push({ node, parentId });
    if (!node.collapsed) node.children?.forEach((child) => visit(child, node.id === "topology-root" ? undefined : node.id));
  };
  root.children?.forEach((node) => visit(node));
  return result;
}

function resolveVisibleEndpoint(root: TopologyGraphNode, id: string): string | undefined {
  let result: string | undefined;
  const visit = (node: TopologyGraphNode) => {
    if (node.id === id) result = node.id;
    if (node.collapsed && node.children?.some((child) => contains(child, id))) result = node.id;
    if (!node.collapsed) node.children?.forEach(visit);
  };
  root.children?.forEach(visit);
  return result;
}

function contains(node: TopologyGraphNode, id: string): boolean {
  return node.id === id || Boolean(node.children?.some((child) => contains(child, id)));
}

export function getTopologyViewStates(root: TopologyGraphNode, focusId?: string): Map<string, TopologyViewState> {
  const states = new Map<string, TopologyViewState>();
  const relations = collectVisibleRelations(root);
  const adjacent = new Set<string>();
  const visibleFocusId = focusId ? resolveVisibleEndpoint(root, focusId) : undefined;
  if (visibleFocusId) for (const edge of relations) {
    const source = resolveVisibleEndpoint(root, edge.source);
    const target = resolveVisibleEndpoint(root, edge.target);
    if (source === visibleFocusId && target) adjacent.add(target);
    if (target === visibleFocusId && source) adjacent.add(source);
  }
  for (const { node } of collectVisibleNodes(root)) states.set(node.id, !visibleFocusId ? "default" : node.id === visibleFocusId ? "focused" : adjacent.has(node.id) ? "context" : "muted");
  return states;
}

export function projectTopologyGraph(root: TopologyGraphNode, focusId?: string): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const states = getTopologyViewStates(root, focusId);
  const nodes = collectVisibleNodes(root).map(({ node, parentId }) => ({
    id: node.id,
    type: node.children?.length && !node.collapsed ? "topologyGroup" : "topologyNode",
    position: { x: 0, y: 0 },
    parentNode: parentId,
    extent: parentId ? "parent" as const : undefined,
    data: { graphNode: node, viewState: states.get(node.id) ?? "default" },
  }));
  const edgesByEndpoints = new Map<string, { source: string; target: string; relations: TopologyRelation[] }>();
  for (const relation of collectVisibleRelations(root)) {
    const source = resolveVisibleEndpoint(root, relation.source);
    const target = resolveVisibleEndpoint(root, relation.target);
    if (!source || !target || source === target) continue;
    const key = `${source}\u0000${target}`;
    const aggregate = edgesByEndpoints.get(key) ?? { source, target, relations: [] };
    aggregate.relations.push(relation);
    edgesByEndpoints.set(key, aggregate);
  }
  const edges: TopologyFlowEdge[] = [...edgesByEndpoints.values()].map(({ source, target, relations }) => {
    const viewState: TopologyViewState = states.get(source) === "focused" || states.get(target) === "focused"
      ? "focused"
      : states.get(source) === "context" || states.get(target) === "context"
        ? "context"
        : states.get(source) === "muted" && states.get(target) === "muted"
          ? "muted"
          : "default";
    return {
      id: `topology:${source}->${target}`,
      source,
      target,
      type: "topologyEdge",
      data: {
        relations,
        aggregated: relations.length > 1 || relations.some((edge) => edge.source !== source || edge.target !== target),
        viewState,
      },
    };
  });
  return { nodes, edges };
}
