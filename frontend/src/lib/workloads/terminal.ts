import { buildRuntimeTargetParams, resolveRuntimeContainer, resolveSafeRuntimeReturnTo } from "@/lib/api/runtime";

export type TerminalRouteTarget = {
  clusterId: string;
  clusterName?: string;
  namespace: string;
  pod: string;
  container?: string;
  containerNames?: string[];
  from?: string;
  returnTo?: string;
  returnBackTo?: string;
  returnClusterId?: string;
  returnClusterName?: string;
  returnNamespace?: string;
  returnKeyword?: string;
  returnPhase?: string;
  returnPage?: number;
  returnFallbackTo?: string;
};

export function resolvePreferredContainer(container?: string, containerNames?: string[]): string {
  return resolveRuntimeContainer(container, containerNames);
}

export function buildTerminalRoute(target: TerminalRouteTarget): string {
  const params = buildRuntimeTargetParams({
    clusterId: target.clusterId,
    namespace: target.namespace,
    pod: target.pod,
    container: target.container,
    containerNames: target.containerNames,
  });
  if (target.clusterName) {
    params.set("clusterName", target.clusterName);
  }
  if (target.from) {
    params.set("from", target.from);
  }
  const safeReturnTo = resolveSafeRuntimeReturnTo(target.returnTo);
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  } else if (target.returnBackTo) {
    const safeBackTo = resolveSafeRuntimeReturnTo(target.returnBackTo);
    if (safeBackTo) {
      params.set("returnTo", safeBackTo);
    }
  } else if (target.returnFallbackTo) {
    const safeFallbackTo = resolveSafeRuntimeReturnTo(target.returnFallbackTo);
    if (safeFallbackTo) {
      params.set("returnTo", safeFallbackTo);
    }
  }
  if (target.returnClusterId) params.set("returnClusterId", target.returnClusterId);
  if (target.returnClusterName) params.set("returnClusterName", target.returnClusterName);
  if (target.returnNamespace) params.set("returnNamespace", target.returnNamespace);
  if (target.returnKeyword) params.set("returnKeyword", target.returnKeyword);
  if (target.returnPhase) params.set("returnPhase", target.returnPhase);
  if (typeof target.returnPage === "number" && Number.isFinite(target.returnPage)) {
    params.set("returnPage", String(target.returnPage));
  }
  return `/terminal?${params.toString()}`;
}
