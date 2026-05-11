"use client";

import { useState } from "react";

type ClusterNamespaceFilterState = {
  clusterId: string;
  namespace: string;
  namespaceDisabled: boolean;
  namespacePlaceholder: string;
  onClusterChange: (nextClusterId: string) => void;
  onNamespaceChange: (nextNamespace: string) => void;
};

export function useClusterNamespaceFilter(initialClusterId = "", initialNamespace = ""): ClusterNamespaceFilterState {
  const [clusterId, setClusterId] = useState(initialClusterId);
  const [namespace, setNamespace] = useState(initialNamespace);
  const hasConcreteCluster = clusterId.trim().length > 0;

  const onClusterChange = (nextClusterId: string) => {
    setClusterId(nextClusterId);
    setNamespace("");
  };

  const onNamespaceChange = (nextNamespace: string) => {
    setNamespace(nextNamespace);
  };

  return {
    clusterId,
    namespace,
    namespaceDisabled: !hasConcreteCluster,
    namespacePlaceholder: hasConcreteCluster ? "全部名称空间" : "请先选择具体集群",
    onClusterChange,
    onNamespaceChange,
  };
}
