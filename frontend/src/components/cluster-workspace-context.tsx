"use client";

import { createContext, useContext, useMemo } from "react";
import { resolveWorkspaceResourceHref } from "@/lib/cluster-workspace";

type ClusterWorkspaceContextValue = {
  clusterId: string;
  clusterName?: string;
};

const ClusterWorkspaceContext = createContext<ClusterWorkspaceContextValue | null>(null);

export function ClusterWorkspaceProvider({
  clusterId,
  clusterName,
  children,
}: ClusterWorkspaceContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ clusterId, clusterName }), [clusterId,clusterName]);
  return (
    <ClusterWorkspaceContext.Provider value={value}>
      {children}
    </ClusterWorkspaceContext.Provider>
  );
}

export function useOptionalClusterWorkspace() {
  return useContext(ClusterWorkspaceContext);
}

export function useClusterWorkspaceHref(legacyHref: string) {
  const workspace = useOptionalClusterWorkspace();
  return resolveWorkspaceResourceHref(workspace?.clusterId, legacyHref);
}
