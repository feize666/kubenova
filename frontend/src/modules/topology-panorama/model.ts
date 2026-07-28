import type { TopologyGraph, TopologyGraphNode, TopologyRelation, TopologyResource } from "./contracts";

const DEFAULT_WEIGHT = 500;

export const DEFAULT_KIND_WEIGHTS: Readonly<Record<string, number>> = {
  HorizontalPodAutoscaler: 1000,
  Deployment: 980,
  StatefulSet: 960,
  DaemonSet: 960,
  CronJob: 960,
  ReplicaSet: 940,
  Job: 920,
  Pod: 820,
  Service: 790,
  NetworkPolicy: 780,
  PersistentVolumeClaim: 780,
  ConfigMap: 770,
  Secret: 770,
};

export function makeTopologyGraph(resources: TopologyResource[], edges: TopologyRelation[]): TopologyGraph {
  return {
    nodes: resources.map((resource) => ({
      id: resource.id,
      label: resource.label,
      subtitle: resource.kind,
      resource,
      weight: resource.weight,
    })),
    edges: [...edges],
  };
}

export function forEachTopologyNode(node: TopologyGraphNode, visit: (node: TopologyGraphNode) => void): void {
  visit(node);
  node.children?.forEach((child) => forEachTopologyNode(child, visit));
}

export function collectTopologyLeaves(node: TopologyGraphNode): TopologyGraphNode[] {
  return node.children?.length ? node.children.flatMap(collectTopologyLeaves) : [node];
}

export function getTopologyNodeWeight(node: TopologyGraphNode): number {
  return node.weight ?? node.resource?.weight ?? (node.resource?.kind ? DEFAULT_KIND_WEIGHTS[node.resource.kind] : undefined) ?? DEFAULT_WEIGHT;
}
