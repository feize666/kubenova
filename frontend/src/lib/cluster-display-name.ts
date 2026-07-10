export function hasKnownCluster(
  clusterMap: Record<string, string>,
  clusterId?: string | null,
) {
  const normalizedClusterId = clusterId?.trim();
  if (!normalizedClusterId) {
    return false;
  }

  const mapped = clusterMap[normalizedClusterId];
  return Boolean(mapped?.trim() || clusterDisplayNameCache.get(normalizedClusterId)?.trim());
}

const UNKNOWN_CLUSTER_LABEL = "未知集群";
const clusterDisplayNameCache = new Map<string, string>();

export function rememberClusterDisplayNames(items: Array<{ id?: string | null; name?: string | null }>) {
  items.forEach((item) => {
    const id = item.id?.trim();
    const name = normalizeClusterLabel(item.name);
    if (id && name) {
      clusterDisplayNameCache.set(id, name);
    }
  });
}

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
    return (
      normalizeClusterLabel(clusterMap[normalizedClusterId]) ||
      normalizeClusterLabel(clusterDisplayNameCache.get(normalizedClusterId)) ||
      UNKNOWN_CLUSTER_LABEL
    );
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
