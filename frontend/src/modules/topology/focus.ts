import { useCallback, useMemo, useReducer } from "react";
import type { TopologyFocusAction, TopologyFocusState, TopologyGraph } from "./contract";

export const DEFAULT_TOPOLOGY_FOCUS_STATE: TopologyFocusState = {
  focusedNodeId: null,
  depth: 1,
};

function clampDepth(depth: number) {
  return Math.max(0, Math.min(8, Math.floor(depth)));
}

export function topologyFocusReducer(state: TopologyFocusState, action: TopologyFocusAction): TopologyFocusState {
  switch (action.type) {
    case "focus":
      return { focusedNodeId: action.nodeId, depth: clampDepth(action.depth ?? state.depth) };
    case "clear":
      return { ...state, focusedNodeId: null };
    case "set-depth":
      return { ...state, depth: clampDepth(action.depth) };
  }
}

export function getTopologyNeighborhood<TNodeData, TRelationData>(
  graph: TopologyGraph<TNodeData, TRelationData>,
  seedId: string | null,
  depth: number,
): ReadonlySet<string> {
  if (!seedId || !graph.resources.some((resource) => resource.id === seedId)) return new Set();
  const adjacency = new Map<string, Set<string>>();
  graph.relations.forEach((relation) => {
    if (!adjacency.has(relation.source)) adjacency.set(relation.source, new Set());
    if (!adjacency.has(relation.target)) adjacency.set(relation.target, new Set());
    adjacency.get(relation.source)?.add(relation.target);
    adjacency.get(relation.target)?.add(relation.source);
  });
  const seen = new Set<string>([seedId]);
  let frontier = [seedId];
  for (let level = 0; level < clampDepth(depth); level += 1) {
    const next = frontier.flatMap((nodeId) => Array.from(adjacency.get(nodeId) ?? []).sort());
    frontier = next.filter((nodeId) => {
      if (seen.has(nodeId)) return false;
      seen.add(nodeId);
      return true;
    });
    if (!frontier.length) break;
  }
  return seen;
}

export function useTopologyFocus(initialState: TopologyFocusState = DEFAULT_TOPOLOGY_FOCUS_STATE) {
  const [state, dispatch] = useReducer(topologyFocusReducer, initialState);
  const focus = useCallback((nodeId: string, depth?: number) => dispatch({ type: "focus", nodeId, depth }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const setDepth = useCallback((depth: number) => dispatch({ type: "set-depth", depth }), []);
  return useMemo(() => ({ state, focus, clear, setDepth }), [clear, focus, setDepth, state]);
}
