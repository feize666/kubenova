/** Canonical Kubernetes kind labels used throughout the topology UI. */
const CANONICAL_KIND_BY_LOWER: Readonly<Record<string, string>> = {
  cluster: "Cluster",
  namespace: "Namespace",
  deployment: "Deployment",
  statefulset: "StatefulSet",
  daemonset: "DaemonSet",
  replicaset: "ReplicaSet",
  pod: "Pod",
  job: "Job",
  cronjob: "CronJob",
  service: "Service",
  ingress: "Ingress",
  ingressroute: "IngressRoute",
  endpoints: "Endpoints",
  endpointslice: "EndpointSlice",
  networkpolicy: "NetworkPolicy",
  gatewayclass: "GatewayClass",
  gateway: "Gateway",
  httproute: "HTTPRoute",
  grpcroute: "GRPCRoute",
  tcproute: "TCPRoute",
  tlsroute: "TLSRoute",
  udproute: "UDPRoute",
  persistentvolume: "PersistentVolume",
  pv: "PersistentVolume",
  persistentvolumeclaim: "PersistentVolumeClaim",
  pvc: "PersistentVolumeClaim",
  storageclass: "StorageClass",
  sc: "StorageClass",
  configmap: "ConfigMap",
  secret: "Secret",
  serviceaccount: "ServiceAccount",
  horizontalpodautoscaler: "HorizontalPodAutoscaler",
  hpa: "HorizontalPodAutoscaler",
  verticalpodautoscaler: "VerticalPodAutoscaler",
  vpa: "VerticalPodAutoscaler",
};

export function normalizeTopologyKind(kind: string | null | undefined): string {
  const value = kind?.trim() ?? "";
  if (!value) return "Unknown";
  return CANONICAL_KIND_BY_LOWER[value.toLowerCase()]
    ?? `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

