import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  ApiResponseEnvelope,
  ApiResponseMeta,
  PaginationMeta,
} from '../contracts/response.contract';

export type ApiResponseMetaDto = ApiResponseMeta;
export type PaginationMetaDto = PaginationMeta;
export type ApiResponseDto<T> = ApiResponseEnvelope<T>;
export type ApiErrorDto = ApiErrorEnvelope;
export type ApiEnvelopeDto<T> = ApiEnvelope<T>;
