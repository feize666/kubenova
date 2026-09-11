/**
 * Canonical, single-cluster workspace routes. Resource pages can share these
 * helpers while the legacy global routes are migrated incrementally.
 */
export type ClusterWorkspaceSection =
  "overview" | "workloads" | "network" | "storage" | "configs" | "topology";

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

export const CLUSTER_WORKSPACE_RESOURCE_PATHS = [
  "nodes",
  "namespaces",
  "workloads/deployments",
  "workloads/statefulsets",
  "workloads/daemonsets",
  "workloads/pods",
  "workloads/jobs",
  "workloads/cronjobs",
  "workloads/replicasets",
  "workloads/autoscaling",
  "workloads/autoscaling/hpa",
  "workloads/autoscaling/vpa",
  "workloads/create",
  "network/services",
  "network/ingress",
  "network/endpoints",
  "network/endpointslices",
  "network/networkpolicy",
  "network/gateway-api",
  "network/topology",
  "storage/pv",
  "storage/pvc",
  "storage/sc",
  "configs/configmaps",
  "configs/secrets",
  "configs/serviceaccounts",
  "configs/limitranges",
  "configs/resourcequotas",
  "observability",
  "inspection",
  "aiops",
  "logs",
  "terminal",
] as const;

export type ClusterWorkspaceResourcePath =
  (typeof CLUSTER_WORKSPACE_RESOURCE_PATHS)[number];

const clusterWorkspaceResourcePathSet = new Set<string>(
  CLUSTER_WORKSPACE_RESOURCE_PATHS,
);

export function isSupportedClusterWorkspaceResource(
  path: string,
): path is ClusterWorkspaceResourcePath {
  return clusterWorkspaceResourcePathSet.has(path);
}

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

export function buildClusterResourceHref(
  clusterId: string,
  resourcePath: string,
) {
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

/** Keep the workspace resource navigation as a single-open accordion. */
export function resolveAccordionOpenKeys(
  nextKeys: readonly string[],
  currentKeys: readonly string[] = [],
): string[] {
  const newlyOpenedKey = currentKeys.length
    ? nextKeys.find((key) => !currentKeys.includes(key))
    : undefined;
  const fallbackKey = nextKeys[nextKeys.length - 1];
  const key = newlyOpenedKey ?? fallbackKey;
  return key ? [key] : [];
}

export function resolveWorkspaceClusterId(
  workspaceClusterId: string | null | undefined,
  legacyClusterId: string,
) {
  return workspaceClusterId?.trim() || legacyClusterId.trim();
}

/**
 * Form controls may receive a stale or user-selected cluster value while a
 * resource page is mounted in a locked workspace. Always prefer the
 * workspace identity so the visible field and submitted payload agree.
 */
export function resolveWorkspaceClusterFieldValue(
  workspaceClusterId: string | null | undefined,
  requestedClusterId: string | null | undefined,
) {
  return workspaceClusterId?.trim() || requestedClusterId?.trim() || "";
}

export function resolveResourceFilterBasePath(
  workspaceClusterId: string | null | undefined,
  pathname: string,
  legacyPath?: string,
) {
  return workspaceClusterId?.trim() ? pathname : (legacyPath ?? pathname);
}

export function resolveWorkspaceResourceHref(
  workspaceClusterId: string | null | undefined,
  legacyHref: string,
) {
  if (!workspaceClusterId?.trim()) return legacyHref;
  const queryIndex = legacyHref.search(/[?#]/);
  const path = queryIndex >= 0 ? legacyHref.slice(0, queryIndex) : legacyHref;
  const suffix = queryIndex >= 0 ? legacyHref.slice(queryIndex) : "";
  return `${buildClusterResourceHref(workspaceClusterId, path)}${suffix}`;
}

export function scopeWorkspaceClusterValues<T>(
  workspaceClusterId: string | null | undefined,
  value: T,
): T {
  const fixedClusterId = workspaceClusterId?.trim();
  if (!fixedClusterId || value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      scopeWorkspaceClusterValues(fixedClusterId, item),
    ) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "clusterId"
        ? fixedClusterId
        : scopeWorkspaceClusterValues(fixedClusterId, item),
    ]),
  ) as T;
}

export function scopeWorkspaceClusterFormData(
  workspaceClusterId: string | null | undefined,
  value: FormData,
) {
  const fixedClusterId = workspaceClusterId?.trim();
  if (!fixedClusterId || !value.has("clusterId")) return value;

  const scoped = new FormData();
  value.forEach((item, key) => {
    scoped.append(key, key === "clusterId" ? fixedClusterId : item);
  });
  return scoped;
}

/**
 * A cluster column adds no information once a resource page is locked to one
 * cluster. Keep the column on legacy/global pages, but omit it from the
 * canonical workspace without mutating the caller's column definition.
 */
export function filterClusterScopedColumns<T extends object>(
  workspaceClusterId: string | null | undefined,
  columns: readonly T[],
): T[] {
  if (!workspaceClusterId?.trim()) return [...columns];

  const isClusterColumn = (column: T) => {
    const value = column as T & {
      key?: unknown;
      title?: unknown;
      children?: readonly T[];
    };
    const key = String(value.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    const title = typeof value.title === "string" ? value.title.trim() : "";
    return (
      key === "clusterid" ||
      key === "cluster" ||
      title === "集群" ||
      title === "集群名称"
    );
  };

  return columns.flatMap((column) => {
    if (isClusterColumn(column)) return [];
    const value = column as T & { children?: readonly T[] };
    if (!Array.isArray(value.children)) return [column];
    const children = filterClusterScopedColumns(
      workspaceClusterId,
      value.children,
    );
    if (!children.length) return [];
    return [{ ...value, children } as T];
  });
}

export function getClusterWorkspaceNavigation(
  clusterId: string,
): ClusterWorkspaceNavigationSection[] {
  const item = (
    key: string,
    label: string,
    path: string,
  ): ClusterWorkspaceNavigationItem => ({
    key,
    label,
    href: buildClusterResourceHref(clusterId, path),
  });

  return [
    {
      key: "overview",
      label: "集群信息",
      items: [item("overview", "集群信息", "overview")],
    },
    {
      key: "base-resources",
      label: "基础资源",
      items: [
        item("nodes", "Node", "nodes"),
        item("namespaces", "Namespace", "namespaces"),
      ],
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
      items: [
        item("pv", "PersistentVolume", "storage/pv"),
        item("pvc", "PersistentVolumeClaim", "storage/pvc"),
        item("sc", "StorageClass", "storage/sc"),
      ],
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
        item("logs", "日志", "logs"),
        item("terminal", "终端", "terminal"),
      ],
    },
  ];
}
