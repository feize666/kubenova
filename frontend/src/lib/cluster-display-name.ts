export function getClusterDisplayName(
  clusterMap: Record<string, string>,
  clusterId?: string | null,
  clusterName?: string | null,
) {
  const normalizedClusterId = clusterId?.trim();
  if (normalizedClusterId) {
    const mapped = clusterMap[normalizedClusterId];
    if (mapped?.trim()) {
      return mapped.trim();
    }
  }

  const normalizedClusterName = clusterName?.trim();
  if (normalizedClusterName) {
    return normalizedClusterName;
  }

  return "—";
}
