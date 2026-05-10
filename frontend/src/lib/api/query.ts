import type { QueryParams, QueryValue } from "./types";

export interface ListQueryOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string | string[];
  sortOrder?: string | string[];
  filters?: QueryParams;
  [key: string]: unknown;
}

function isQueryPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isQueryValue(value: unknown): value is QueryValue {
  return value === null || value === undefined || isQueryPrimitive(value);
}

function appendQueryValue(searchParams: URLSearchParams, key: string, value: QueryValue): void {
  if (value === null || value === undefined) {
    return;
  }
  searchParams.append(key, String(value));
}

export function toQueryParams(input: Record<string, unknown>): QueryParams {
  const result: QueryParams = {};

  for (const [key, value] of Object.entries(input)) {
    if (isQueryValue(value)) {
      result[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const list = value.filter((item): item is QueryValue => isQueryValue(item));
      if (list.length > 0) {
        result[key] = list;
      }
    }
  }

  return result;
}

export function buildListQuery(options: ListQueryOptions = {}): QueryParams {
  const { page, pageSize, sortBy, sortOrder, filters, ...rest } = options;
  const query = toQueryParams(rest);

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query[key] = value;
    }
  }

  if (page !== undefined) {
    query.page = page;
  }

  if (pageSize !== undefined) {
    query.pageSize = pageSize;
  }

  const sortFields = sortBy === undefined ? [] : Array.isArray(sortBy) ? sortBy : [sortBy];
  const sortOrders = sortOrder === undefined ? [] : Array.isArray(sortOrder) ? sortOrder : [sortOrder];

  if (sortFields.length > 0) {
    const sortValues = sortFields.map((field, index) => {
      const order = sortOrders[index] ?? sortOrders[0];
      return order ? `${field}:${order}` : field;
    });

    query.sort = sortValues.length === 1 ? sortValues[0] : sortValues;
  }

  return query;
}

export function buildQueryString(query?: QueryParams): string {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(searchParams, key, item);
      }
      continue;
    }

    appendQueryValue(searchParams, key, value);
  }

  return searchParams.toString();
}

export function withQuery(path: string, query?: QueryParams): string {
  const queryString = buildQueryString(query);
  if (!queryString) {
    return path;
  }
  return `${path}?${queryString}`;
}
