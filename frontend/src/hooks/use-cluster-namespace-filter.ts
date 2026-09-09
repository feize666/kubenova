"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getClusterRouteScope, type ClusterRouteScope } from "@/lib/cluster-workspace";

type ClusterNamespaceFilterState = {
  clusterId: string;
  namespace: string;
  namespaceDisabled: boolean;
  namespacePlaceholder: string;
  clusterFixed: boolean;
  onClusterChange: (nextClusterId: string) => void;
  onNamespaceChange: (nextNamespace: string) => void;
  onScopeChange: (nextClusterId: string, nextNamespace: string) => void;
};

export function useRouteClusterScope(): ClusterRouteScope {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useMemo(
    () => getClusterRouteScope(pathname, searchParams),
    [pathname, searchParams],
  );
}

export function useClusterNamespaceFilter(initialClusterId = "", initialNamespace = ""): ClusterNamespaceFilterState {
  const routeScope = useRouteClusterScope();
  const [selectedClusterId, setSelectedClusterId] = useState(initialClusterId);
  const [namespace, setNamespace] = useState(initialNamespace);
  const clusterId = routeScope.isFixed ? routeScope.clusterId : selectedClusterId;
  const hasConcreteCluster = clusterId.trim().length > 0;

  const onClusterChange = (nextClusterId: string) => {
    if (routeScope.isFixed) {
      return;
    }
    setSelectedClusterId(nextClusterId);
    setNamespace("");
  };

  const onNamespaceChange = (nextNamespace: string) => {
    setNamespace(nextNamespace);
  };

  const onScopeChange = (nextClusterId: string, nextNamespace: string) => {
    if (routeScope.isFixed) {
      setNamespace(nextNamespace);
      return;
    }
    setSelectedClusterId(nextClusterId);
    setNamespace(nextClusterId ? nextNamespace : "");
  };

  return {
    clusterId,
    namespace,
    namespaceDisabled: !hasConcreteCluster,
    namespacePlaceholder: hasConcreteCluster ? "全部名称空间" : "请先选择具体集群",
    clusterFixed: routeScope.isFixed,
    onClusterChange,
    onNamespaceChange,
    onScopeChange,
  };
}
