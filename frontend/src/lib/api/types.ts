import type {
  ApiErrorModel,
  BatchResult,
  ClusterListModel,
  ClusterModel,
  ClusterQueryParams,
  HttpMethod,
  ListModel,
  ListQueryParams,
  PaginationMeta,
  QueryParams,
  QueryPrimitive,
  QueryValue,
  ResourceState,
} from "@/lib/contracts";

export type { HttpMethod, QueryPrimitive, QueryValue, QueryParams, PaginationMeta, ResourceState };
export type { ApiErrorModel, BatchResult, ListModel, ListQueryParams };

export interface ApiRequestOptions<TBody = unknown> {
  method?: HttpMethod;
  token?: string;
  query?: QueryParams;
  body?: TBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
  suppressAuthExpiryBroadcast?: boolean;
}

// Backward-compatible export aliases used by existing pages/api modules.
export type Cluster = ClusterModel;
export type ClusterListResponse = ClusterListModel;
export type GetClustersParams = ClusterQueryParams;

// Preferred names for incremental migration.
export type ClusterList = ListModel<ClusterModel>;

// Preferred query params for list APIs in api modules.
export type ListRequestParams = ListQueryParams;
