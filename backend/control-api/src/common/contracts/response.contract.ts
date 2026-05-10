import type { ApiErrorResponse } from './error.contract';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponseMeta extends Partial<PaginationMeta> {
  [key: string]: unknown;
}

export interface ApiResponseEnvelope<T> {
  data: T;
  meta?: ApiResponseMeta;
  requestId: string;
}

export type ApiErrorEnvelope = ApiErrorResponse;

export type ApiEnvelope<T> = ApiResponseEnvelope<T> | ApiErrorEnvelope;
