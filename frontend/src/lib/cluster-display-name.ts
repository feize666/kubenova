export function hasKnownCluster(
  clusterMap: Record<string, string>,
  clusterId?: string | null,
) {
  const normalizedClusterId = clusterId?.trim();
  if (!normalizedClusterId) {
    return false;
  }

  const mapped = clusterMap[normalizedClusterId];
  return Boolean(mapped?.trim());
}

const UNKNOWN_CLUSTER_LABEL = "未知集群";

function normalizeClusterLabel(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized || normalized === "-") {
    return "";
  }
  return normalized;
}

function isLikelyRawClusterIdentifier(value: string) {
  return /^[a-z0-9]+$/i.test(value) && value.length >= 18;
}

export function getClusterDisplayName(
  clusterMap: Record<string, string>,
  clusterId?: string | null,
  clusterName?: string | null,
) {
  const normalizedClusterId = clusterId?.trim();
  if (normalizedClusterId && hasKnownCluster(clusterMap, normalizedClusterId)) {
    return normalizeClusterLabel(clusterMap[normalizedClusterId]) || UNKNOWN_CLUSTER_LABEL;
  }

  const fallbackClusterName = normalizeClusterLabel(clusterName);
  if (
    fallbackClusterName &&
    fallbackClusterName !== normalizedClusterId &&
    !isLikelyRawClusterIdentifier(fallbackClusterName)
  ) {
    return fallbackClusterName;
  }

  return UNKNOWN_CLUSTER_LABEL;
}
