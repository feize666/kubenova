import type { ApiEnvelope, ApiErrorModel, PaginatedEnvelope } from "./api";
import type { PaginationMeta, ResourceState } from "./common";

const STATE_MAP: Record<string, ResourceState> = {
  enabled: "active",
  enable: "active",
  active: "active",
  disabled: "disabled",
  disable: "disabled",
  deleted: "deleted",
  deleting: "deleted",
  suspended: "suspended",
  suspend: "suspended",
};

export function normalizeState(input?: string | null): ResourceState {
  if (!input) {
    return "unknown";
  }
  return STATE_MAP[input.toLowerCase()] ?? "unknown";
}

export function toPaginationMeta(input: Partial<PaginationMeta> = {}): PaginationMeta {
  const page = Number.isFinite(input.page) ? Number(input.page) : 1;
  const pageSize = Number.isFinite(input.pageSize) ? Number(input.pageSize) : 20;
  const total = Number.isFinite(input.total) ? Number(input.total) : 0;
  const fallbackTotalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    page,
    pageSize,
    total,
    totalPages: Number.isFinite(input.totalPages) ? Number(input.totalPages) : fallbackTotalPages,
  };
}

export function unwrapData<TData>(payload: ApiEnvelope<TData> | TData): TData {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as ApiEnvelope<TData>).data;
  }
  return payload as TData;
}

export function unwrapPaginated<TItem>(
  payload: PaginatedEnvelope<TItem> | { items: TItem[]; page: number; pageSize: number; total: number },
): { items: TItem[]; meta: PaginationMeta } {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    const paged = payload as PaginatedEnvelope<TItem>;
    return { items: paged.data, meta: toPaginationMeta(paged.meta) };
  }

  const legacy = payload as { items: TItem[]; page: number; pageSize: number; total: number };
  return {
    items: legacy.items ?? [],
    meta: toPaginationMeta({ page: legacy.page, pageSize: legacy.pageSize, total: legacy.total }),
  };
}

export function toApiError(error: unknown, fallbackCode = "UNKNOWN_ERROR"): ApiErrorModel {
  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    return {
      code: typeof source.code === "string" ? source.code : fallbackCode,
      message: typeof source.message === "string" ? source.message : "Unexpected API error",
      details: source.details,
      requestId: typeof source.requestId === "string" ? source.requestId : undefined,
      status: typeof source.status === "number" ? source.status : undefined,
    };
  }

  return {
    code: fallbackCode,
    message: typeof error === "string" ? error : "Unexpected API error",
  };
}
