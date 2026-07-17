import type {
  TopologyGraphEdge,
  TopologyGraphNode,
  TopologyRelation,
  TopologyResource,
} from "./contracts";

const DEFAULT_NODE_WEIGHTS: Record<string, number> = {
  HorizontalPodAutoscaler: 1000,
  Deployment: 980,
  StatefulSet: 960,
  DaemonSet: 960,
  CronJob: 960,
  ReplicaSet: 940,
  Job: 920,
  Pod: 820,
  ServiceAccount: 800,
  Service: 790,
  RoleBinding: 790,
  Role: 780,
  NetworkPolicy: 780,
  PersistentVolumeClaim: 780,
  ConfigMap: 770,
  Secret: 770,
  Endpoints: 760,
  EndpointSlice: 760,
  Ingress: 760,
  IngressClass: 750,
  PersistentVolume: 740,
  StorageClass: 730,
};

export function makeTopologyElements<TResource extends TopologyResource>(
  resources: TResource[],
  relations: TopologyRelation[],
): { nodes: TopologyGraphNode<TResource>[]; edges: TopologyGraphEdge[] } {
  return {
    nodes: resources.map((resource) => ({
      id: resource.id,
      label: resource.name,
      subtitle: resource.kind,
      resource,
      weight: resource.weight,
    })),
    edges: relations.map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      label: relation.label,
      data: relation.data,
    })),
  };
}

export function forEachNode<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
  visit: (node: TopologyGraphNode<TResource>) => void,
): void {
  visit(graph);
  graph.nodes?.forEach((node) => forEachNode(node, visit));
}

export function collectLeafNodes<TResource extends TopologyResource>(
  graph: TopologyGraphNode<TResource>,
): TopologyGraphNode<TResource>[] {
  return graph.nodes?.length ? graph.nodes.flatMap(collectLeafNodes) : [graph];
}

export function getNodeWeight<TResource extends TopologyResource>(node: TopologyGraphNode<TResource>): number {
  if (typeof node.weight === "number") return node.weight;
  if (typeof node.resource?.weight === "number") return node.resource.weight;
  return DEFAULT_NODE_WEIGHTS[node.resource?.kind ?? ""] ?? 500;
}
