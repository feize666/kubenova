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
