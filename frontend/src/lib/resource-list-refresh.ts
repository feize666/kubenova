export const RESOURCE_LIST_REFRESH_INTERVAL_MS = 12_000;

function isRouteTransitionSettling() {
  if (typeof window === "undefined") {
    return false;
  }
  const routeWindow = window as Window & { __KUBENOVA_ROUTE_TRANSITION_UNTIL?: number };
  return (routeWindow.__KUBENOVA_ROUTE_TRANSITION_UNTIL ?? 0) > performance.now();
}

export const RESOURCE_LIST_REFRESH_OPTIONS = {
  refetchInterval: () =>
    typeof document !== "undefined" && !document.hidden && !isRouteTransitionSettling()
      ? RESOURCE_LIST_REFRESH_INTERVAL_MS
      : false,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
};
