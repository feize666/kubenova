import { isResourceAccessDenied } from "@/lib/query/visible-resource-data";

export type DetailQueryState = "loading" | "permission" | "error" | "degraded" | "ready" | "empty";

export function getResourceDetailQueryState<T>(query: {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
}, readDenied = false): DetailQueryState {
  if (readDenied || isResourceAccessDenied(query.error)) return "permission";
  if (query.isPending && !query.data) return "loading";
  if (query.error && query.data) return "degraded";
  if (query.error) return "error";
  if (query.data) return "ready";
  return "empty";
}

export function visibleDetailData<T>(query: { data: T | undefined; error: unknown }, readDenied = false): T | undefined {
  return readDenied || isResourceAccessDenied(query.error) ? undefined : query.data;
}
