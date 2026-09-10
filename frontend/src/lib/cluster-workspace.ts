/**
 * Canonical, single-cluster workspace routes. Resource pages can share these
 * helpers while the legacy global routes are migrated incrementally.
 */
export type ClusterWorkspaceSection =
  | "overview"
  | "workloads"
  | "network"
  | "storage"
  | "configs"
  | "topology";

export type ClusterWorkspaceNavigationItem = {
  key: string;
  label: string;
  href: string;
};

export type ClusterWorkspaceNavigationSection = {
  key: string;
  label: string;
  items: ClusterWorkspaceNavigationItem[];
};

function normalizeClusterId(clusterId: string) {
  const normalized = clusterId.trim();
  if (!normalized) {
    throw new Error("集群标识不能为空");
  }
  return normalized;
}

export function buildClusterWorkspaceHref(
  clusterId: string,
  section: ClusterWorkspaceSection | string = "overview",
) {
  const normalizedClusterId = normalizeClusterId(clusterId);
  const normalizedSection = section.replace(/^\/+|\/+$/g, "") || "overview";
  return `/clusters/${encodeURIComponent(normalizedClusterId)}/${normalizedSection}`;
}

export function buildClusterResourceHref(clusterId: string, resourcePath: string) {
  return buildClusterWorkspaceHref(clusterId, resourcePath);
}

export function getClusterIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/clusters\/([^/?#]+)\//);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function getClusterWorkspaceNavigation(clusterId: string): ClusterWorkspaceNavigationSection[] {
  const item = (key: string, label: string, path: string): ClusterWorkspaceNavigationItem => ({
    key,
    label,
    href: buildClusterResourceHref(clusterId, path),
  });

  return [
    { key: "overview", label: "集群信息", items: [item("overview", "集群信息", "overview")] },
    {
      key: "base-resources",
      label: "基础资源",
      items: [item("nodes", "Node", "nodes"), item("namespaces", "Namespace", "namespaces")],
    },
    {
      key: "workloads",
      label: "工作负载",
      items: [
        item("deployments", "Deployment", "workloads/deployments"),
        item("statefulsets", "StatefulSet", "workloads/statefulsets"),
        item("daemonsets", "DaemonSet", "workloads/daemonsets"),
        item("pods", "Pod", "workloads/pods"),
        item("jobs", "Job", "workloads/jobs"),
        item("cronjobs", "CronJob", "workloads/cronjobs"),
        item("autoscaling", "弹性伸缩", "workloads/autoscaling"),
      ],
    },
    {
      key: "network",
      label: "网络",
      items: [
        item("services", "Service", "network/services"),
        item("ingress", "Ingress", "network/ingress"),
        item("endpoints", "Endpoint", "network/endpoints"),
        item("endpointslices", "EndpointSlice", "network/endpointslices"),
        item("networkpolicy", "NetworkPolicy", "network/networkpolicy"),
        item("gateway-api", "Gateway API", "network/gateway-api"),
      ],
    },
    {
      key: "storage",
      label: "存储",
      items: [item("pv", "PersistentVolume", "storage/pv"), item("pvc", "PersistentVolumeClaim", "storage/pvc"), item("sc", "StorageClass", "storage/sc")],
    },
    {
      key: "configs",
      label: "配置",
      items: [
        item("configmaps", "ConfigMap", "configs/configmaps"),
        item("secrets", "Secret", "configs/secrets"),
        item("serviceaccounts", "ServiceAccount", "configs/serviceaccounts"),
        item("limitranges", "LimitRange", "configs/limitranges"),
        item("resourcequotas", "ResourceQuota", "configs/resourcequotas"),
      ],
    },
    {
      key: "operations",
      label: "运维能力",
      items: [
        item("topology", "资源拓扑", "network/topology"),
        item("observability", "可观测性", "observability"),
        item("inspection", "资源巡检", "inspection"),
        item("aiops", "智能运维", "aiops"),
        item("terminal", "终端", "terminal"),
      ],
    },
  ];
}
