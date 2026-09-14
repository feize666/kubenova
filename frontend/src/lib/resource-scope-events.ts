"use client";

export const RESOURCE_SCOPE_CHANGE_EVENT = "kubenova:resource-scope-change";
const RESOURCE_SCOPE_STORAGE_KEY = "kubenova:resource-scope";

export type ResourceScopeChangeDetail = {
  clusterId: string;
  clusterName?: string;
  namespace?: string;
};

type StoredResourceScope = Record<string, { namespace: string }>;

function readStoredScopes(): StoredResourceScope {
  if (typeof window === "undefined") return {};
  try {
    const value = window.localStorage.getItem(RESOURCE_SCOPE_STORAGE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as StoredResourceScope : {};
  } catch {
    return {};
  }
}

export function readStoredResourceNamespace(clusterId: string): string {
  const key = clusterId.trim();
  if (!key) return "";
  const namespace = readStoredScopes()[key]?.namespace;
  return typeof namespace === "string" ? namespace : "";
}

export function persistResourceNamespace(clusterId: string, namespace?: string) {
  if (typeof window === "undefined") return;
  const key = clusterId.trim();
  if (!key) return;
  const scopes = readStoredScopes();
  scopes[key] = { namespace: namespace?.trim() ?? "" };
  try {
    window.localStorage.setItem(RESOURCE_SCOPE_STORAGE_KEY, JSON.stringify(scopes));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory event
    // still keeps controls on the current page synchronized.
  }
}

export function emitResourceScopeChange(detail: ResourceScopeChangeDetail) {
  if (typeof window === "undefined") {
    return;
  }
  persistResourceNamespace(detail.clusterId, detail.namespace);
  window.dispatchEvent(new CustomEvent<ResourceScopeChangeDetail>(RESOURCE_SCOPE_CHANGE_EVENT, { detail }));
}
