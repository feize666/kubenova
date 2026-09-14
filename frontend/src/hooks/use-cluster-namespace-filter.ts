"use client";

import { useEffect, useState } from "react";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { resolveWorkspaceClusterId } from "@/lib/cluster-workspace";
import {
  persistResourceNamespace,
  readStoredResourceNamespace,
  RESOURCE_SCOPE_CHANGE_EVENT,
  type ResourceScopeChangeDetail,
} from "@/lib/resource-scope-events";

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
  const initialScopeClusterId = workspace?.clusterId || initialClusterId;
  const [namespace, setNamespace] = useState(
    () => initialNamespace || readStoredResourceNamespace(initialScopeClusterId),
  );
  const clusterId = resolveWorkspaceClusterId(workspace?.clusterId, selectedClusterId);
  const hasConcreteCluster = clusterId.trim().length > 0;

  useEffect(() => {
    if (typeof window === "undefined" || !clusterId) return;
    const handleScopeChange = (event: Event) => {
      const detail = (event as CustomEvent<ResourceScopeChangeDetail>).detail;
      if (!detail || detail.clusterId !== clusterId || detail.namespace === undefined) return;
      setNamespace(detail.namespace);
    };
    window.addEventListener(RESOURCE_SCOPE_CHANGE_EVENT, handleScopeChange);
    return () => window.removeEventListener(RESOURCE_SCOPE_CHANGE_EVENT, handleScopeChange);
  }, [clusterId]);

  const onClusterChange = (nextClusterId: string) => {
    if (workspace) return;
    setSelectedClusterId(nextClusterId);
    setNamespace(readStoredResourceNamespace(nextClusterId));
  };

  const onNamespaceChange = (nextNamespace: string) => {
    setNamespace(nextNamespace);
    persistResourceNamespace(clusterId, nextNamespace);
  };

  const onScopeChange = (nextClusterId: string, nextNamespace: string) => {
    if (!workspace) setSelectedClusterId(nextClusterId);
    const resolvedClusterId = resolveWorkspaceClusterId(workspace?.clusterId, nextClusterId);
    const resolvedNamespace = workspace || nextClusterId ? nextNamespace : "";
    setNamespace(resolvedNamespace);
    persistResourceNamespace(resolvedClusterId, resolvedNamespace);
  };

  return {
    clusterId,
    namespace,
    namespaceDisabled: !hasConcreteCluster,
    namespacePlaceholder: hasConcreteCluster ? "全部命名空间" : "请先选择具体集群",
    onClusterChange,
    onNamespaceChange,
    onScopeChange,
  };
}
