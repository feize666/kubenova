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

export type ClusterRouteScope = {
  clusterId: string;
  isFixed: boolean;
};

function normalizeClusterId(clusterId: string) {
  const normalized = clusterId.trim();
  if (!normalized) {
    throw new Error("集群标识不能为空");
  }
  return normalized;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A workspace path takes precedence over a legacy query parameter, so a
 * cluster-scoped URL can never be redirected to another cluster by its query.
 */
export function getClusterRouteScope(
  pathname?: string | null,
  searchParams?: Pick<URLSearchParams, "get"> | null,
): ClusterRouteScope {
  const pathMatch = pathname?.match(/^\/clusters\/([^/?#]+)(?:\/|$)/);
  const pathClusterId = pathMatch ? decodePathSegment(pathMatch[1]).trim() : "";
  if (pathClusterId) {
    return { clusterId: pathClusterId, isFixed: true };
  }

  const queryClusterId = (searchParams?.get("clusterId") ?? "").trim();
  if (queryClusterId) {
    return { clusterId: queryClusterId, isFixed: true };
  }

  return { clusterId: "", isFixed: false };
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
