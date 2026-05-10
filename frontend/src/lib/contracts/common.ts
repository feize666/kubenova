export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryPrimitive = string | number | boolean;

export type QueryValue = QueryPrimitive | null | undefined;

export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

export type SortOrder = "asc" | "desc";

export interface ListQueryParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
}

export type ResourceState =
  | "active"
  | "disabled"
  | "deleted"
  | "suspended"
  | "unknown";
