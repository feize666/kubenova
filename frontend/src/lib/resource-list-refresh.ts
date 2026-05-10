export const RESOURCE_LIST_REFRESH_INTERVAL_MS = 5000;

export const RESOURCE_LIST_REFRESH_OPTIONS = {
  refetchInterval: () =>
    typeof document !== "undefined" && !document.hidden
      ? RESOURCE_LIST_REFRESH_INTERVAL_MS
      : false,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
};
