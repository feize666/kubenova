"use client";

export const RESOURCE_SCOPE_CHANGE_EVENT = "kubenova:resource-scope-change";

export type ResourceScopeChangeDetail = {
  clusterId: string;
  clusterName?: string;
  namespace?: string;
};

export function emitResourceScopeChange(detail: ResourceScopeChangeDetail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<ResourceScopeChangeDetail>(RESOURCE_SCOPE_CHANGE_EVENT, { detail }));
}
