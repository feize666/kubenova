import type { ApiErrorModel, ListQueryParams, QueryParams, QueryValue } from "@/lib/contracts";
import { toApiError } from "@/lib/contracts";
import { ApiError, buildListQuery } from "./client";

export interface ExtendedListQueryParams extends ListQueryParams {
  state?: string;
  namespace?: string;
  clusterId?: string;
  provider?: string;
  [key: string]: QueryValue | QueryValue[] | undefined;
}

function compactQueryParams(params: QueryParams): QueryParams {
  const result: QueryParams = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      const list = value.filter((item) => item !== undefined && item !== null && item !== "");
      if (list.length === 0) {
        continue;
      }
      result[key] = list;
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function buildResourceListQuery(params: ExtendedListQueryParams = {}): QueryParams {
  const { page, pageSize, keyword, sortBy, sortOrder, ...filters } = params;
  return compactQueryParams(
    buildListQuery({
      page,
      pageSize,
      sortBy,
      sortOrder,
      keyword,
      filters,
    }),
  );
}

export function adaptRequestError(error: unknown, fallbackCode = "REQUEST_FAILED"): ApiErrorModel {
  if (error instanceof ApiError) {
    return {
      code: error.code ?? fallbackCode,
      message: error.message,
      details: error.details,
      requestId: error.requestId,
      status: error.status,
    };
  }

  return toApiError(error, fallbackCode);
}
