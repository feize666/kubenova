import { isResourceAccessDenied } from "@/lib/query/visible-resource-data";

export type ResourceTableState = "idle" | "loading" | "empty" | "filtered-empty" | "error" | "degraded" | "permission";
export interface ResourceTableQueryState {
  data?: unknown;
  error?: unknown;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
}

export function deriveResourceTableState(query?: ResourceTableQueryState, fallback: ResourceTableState = "idle"): ResourceTableState {
  if (!query) return fallback;
  if (isResourceAccessDenied(query.error)) return "permission";
  if (query.isError) return query.data == null ? "error" : "degraded";
  if (query.isLoading && query.data == null) return "loading";
  return fallback;
}
