"use client";

import { createContext, useContext, useMemo } from "react";
import { resolveWorkspaceResourceHref } from "@/lib/cluster-workspace";

type ClusterWorkspaceContextValue = {
  clusterId: string;
};

const ClusterWorkspaceContext = createContext<ClusterWorkspaceContextValue | null>(null);

export function ClusterWorkspaceProvider({
  clusterId,
  children,
}: ClusterWorkspaceContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ clusterId }), [clusterId]);
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
