"use client";

import { useState } from "react";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { resolveWorkspaceClusterId } from "@/lib/cluster-workspace";

type ClusterNamespaceFilterState = {
  clusterId: string;
  namespace: string;
  namespaceDisabled: boolean;
  namespacePlaceholder: string;
  onClusterChange: (nextClusterId: string) => void;
  onNamespaceChange: (nextNamespace: string) => void;
  onScopeChange: (nextClusterId: string, nextNamespace: string) => void;
};

export function useClusterNamespaceFilter(initialClusterId = "", initialNamespace = ""): ClusterNamespaceFilterState {
  const workspace = useOptionalClusterWorkspace();
  const [selectedClusterId, setSelectedClusterId] = useState(initialClusterId);
  const [namespace, setNamespace] = useState(initialNamespace);
  const clusterId = resolveWorkspaceClusterId(workspace?.clusterId, selectedClusterId);
  const hasConcreteCluster = clusterId.trim().length > 0;

  const onClusterChange = (nextClusterId: string) => {
    if (workspace) return;
    setSelectedClusterId(nextClusterId);
    setNamespace("");
  };

  const onNamespaceChange = (nextNamespace: string) => {
    setNamespace(nextNamespace);
  };

  const onScopeChange = (nextClusterId: string, nextNamespace: string) => {
    if (!workspace) setSelectedClusterId(nextClusterId);
    setNamespace(workspace || nextClusterId ? nextNamespace : "");
  };

  return {
    clusterId,
    namespace,
    namespaceDisabled: !hasConcreteCluster,
    namespacePlaceholder: hasConcreteCluster ? "全部名称空间" : "请先选择具体集群",
    onClusterChange,
    onNamespaceChange,
    onScopeChange,
  };
}
